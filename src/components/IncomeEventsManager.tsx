import React, { useState } from 'react';
import styled from 'styled-components';
import { confirmDialog } from 'primereact/confirmdialog';
import EventTypeSelectionDialog from '../dialogs/EventTypeSelectionDialog';
import IncomeEventDialog from '../dialogs/IncomeEventDialog';
import SocialSecurityDialog from '../dialogs/SocialSecurityDialog';
import PensionIncomeDialog from '../dialogs/PensionIncomeDialog';
import RothConversionDialog from '../dialogs/RothConversionDialog';
import RetirementContributionDialog from '../dialogs/RetirementContributionDialog';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import type { Account } from '../types/Account';
import { spacing, colors, border, fontSize } from '../styles/theme';
import { ManagerRow, RightAmount, SlatList, PlusButton, Header, HeaderLeft, HeaderRight } from './ManagerRow';
import { eventTypeIcons } from '../utils/defaultName';

const Container = styled.div``;

const ConversionChip = styled.span`
  padding: 0 ${spacing.xs};
  background: ${colors.chipBg};
  color: ${colors.textSecondary};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  font-weight: normal;
`;

const DetachedChip = styled.span`
  padding: 0 ${spacing.xs};
  background: ${colors.bgMedium};
  color: ${colors.textMuted};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  font-weight: normal;
  margin-left: ${spacing.xs};
`;

const GeneratedChip = styled.span`
  padding: 0 ${spacing.xs};
  background: ${colors.incomeBg};
  color: ${colors.income};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  font-weight: 600;
  margin-left: ${spacing.xs};
`;

const GroupCard = styled.div`
  border: ${border.light};
  border-radius: ${border.radius};
  background: ${colors.bgLight};
  margin-bottom: ${spacing.xs};
  overflow: hidden;
`;

const GroupHeader = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.xs} ${spacing.sm};
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
  &:hover { background: ${colors.bgMedium}; }
`;

const GroupBody = styled.div`
  border-top: ${border.light};
  padding: ${spacing.xs};
  background: ${colors.bgMedium};
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const GroupActions = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: ${spacing.xs};
  border-top: ${border.light};
`;

const DeleteGroupButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  padding: ${spacing.xs} ${spacing.sm};
  background: transparent;
  border: 1px solid transparent;
  border-radius: ${border.radius};
  color: ${colors.danger};
  font-size: ${fontSize.xs};
  font-weight: 500;
  cursor: pointer;
  &:hover {
    background: ${colors.bgHover};
    border-color: ${colors.danger};
  }
`;

const generatorLabel = (g: string): string =>
  g === 'fill_to_bracket' ? 'Fill to bracket'
    : g === 'auto_bracket' ? 'Auto bracket'
      : g === 'optimize' ? 'Optimize'
        : g;

interface IncomeEventsManagerProps {
  events: IncomeEvent[];
  userData: any;
  accounts: Account[];
  onAdd: (event: Omit<IncomeEvent, 'id'>) => void;
  onUpdate: (id: string, event: Partial<IncomeEvent>) => void;
  onDelete: (id: string) => void;
  /** Bulk-delete every event in a generator-tagged batch (one updateScenario
   *  call). Used by the group card's "Delete all generated conversions"
   *  action. Manual/detached rows live outside the group and are unaffected. */
  onDeleteGroup?: (eventIds: string[]) => void;
}

export const IncomeEventsManager: React.FC<IncomeEventsManagerProps> = ({
  events,
  userData,
  accounts,
  onAdd,
  onUpdate,
  onDelete,
  onDeleteGroup,
}) => {
  const [selectionDialogVisible, setSelectionDialogVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<IncomeEventType | null>(null);
  const [editingEvent, setEditingEvent] = useState<IncomeEvent | undefined>(undefined);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleTypeSelect = (type: IncomeEventType) => {
    setSelectedType(type);
    setEditingEvent(undefined);
    setDialogVisible(true);
  };

  const handleSave = (event: Omit<IncomeEvent, 'id'>) => {
    if (editingEvent) {
      onUpdate(editingEvent.id, event);
    } else {
      onAdd(event);
    }
    setDialogVisible(false);
    setSelectedType(null);
    setEditingEvent(undefined);
  };

  const startEdit = (event: IncomeEvent) => {
    setEditingEvent(event);
    setSelectedType(null);
    setDialogVisible(true);
  };

  return (
    <Container>
      <Header>
        <HeaderLeft>
          <h3>Income</h3>
        </HeaderLeft>
        <HeaderRight>
          <PlusButton onClick={() => setSelectionDialogVisible(true)}>
            <i className="pi pi-plus" />
          </PlusButton>
        </HeaderRight>
      </Header>

      <SlatList>
        {(() => {
          // Group generator-tagged roth_conversion events by generatorRunId.
          // Manual events and non-conversion events render individually.
          type Group = { runId: string; generatedBy: string; generatedAt?: string; events: IncomeEvent[] };
          const groupMap = new Map<string, Group>();
          const singles: IncomeEvent[] = [];
          for (const e of events) {
            const gb = e.meta?.generatedBy;
            const isGenerated = e.type === 'roth_conversion' && gb && gb !== 'user';
            const runId = e.meta?.generatorRunId;
            if (isGenerated && runId) {
              if (!groupMap.has(runId)) {
                groupMap.set(runId, { runId, generatedBy: gb!, generatedAt: e.meta?.generatedAt, events: [] });
              }
              groupMap.get(runId)!.events.push(e);
            } else {
              singles.push(e);
            }
          }

          const ownerAge = (e: IncomeEvent) =>
            (e.owner === 'spouse' && userData.spouseAge !== null) ? userData.spouseAge : userData.currentAge;
          const startYearOf = (e: IncomeEvent) =>
            userData.referenceYear + (e.startAge - ownerAge(e));

          type Item =
            | { kind: 'single'; sortKey: number; event: IncomeEvent }
            | { kind: 'group'; sortKey: number; group: Group };

          const items: Item[] = [];
          for (const e of singles) items.push({ kind: 'single', sortKey: startYearOf(e), event: e });
          for (const g of groupMap.values()) {
            const earliest = Math.min(...g.events.map(startYearOf));
            items.push({ kind: 'group', sortKey: earliest, group: g });
          }
          items.sort((a, b) => a.sortKey - b.sortKey);

          const renderRow = (event: IncomeEvent) => (
            <ManagerRow
              key={event.id}
              icon={<i className={eventTypeIcons[event.type]} />}
              iconBg={colors.incomeBg}
              iconColor={colors.income}
              name={event.name}
              badge={event.type === 'roth_conversion' && (
                <>
                  <ConversionChip>Conversion</ConversionChip>
                  {/* Preserve audit signal for events that were generated and
                      then detached by an explicit edit. Grouping treats them
                      as manual (correct), but the badge keeps provenance
                      visible. The original generator name is intentionally
                      not surfaced (it's overwritten on detach) — the
                      generatorRunId in scenario JSON is the audit anchor. */}
                  {event.meta?.generatorRunId && event.meta?.generatedBy === 'user' && (
                    <>
                      <PrimeTooltip target={`.detached-chip-${event.id}`} position='bottom' showDelay={150}>
                        <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                          This event was generated by the wizard, then detached by editing.
                          It will survive future re-runs of the schedule.
                        </div>
                      </PrimeTooltip>
                      <DetachedChip className={`detached-chip-${event.id}`}>Detached</DetachedChip>
                    </>
                  )}
                </>
              )}
              secondary={
                <>
                  <div>
                    Age {event.startAge}
                    {event.endAge && !event.isOneTime && `–${event.endAge}`}
                  </div>
                  <div>
                    {event.type === 'social_security'
                      ? (event.ssAmountBasis === 'future' ? 'Future dollars' : "Today's dollars")
                      : event.type === 'roth_conversion'
                      ? `Trad → Roth • ${event.colaType === 'fixed' ? 'Fixed amount' : 'Inflation adjusted'}`
                      : `${event.taxStatus === 'before_tax' ? 'Before tax' : 'After tax'} • ${event.colaType === 'fixed' ? 'Fixed amount' : 'Inflation adjusted'}`}
                  </div>
                </>
              }
              right={<RightAmount>${event.amount.toLocaleString()}</RightAmount>}
              onEdit={() => startEdit(event)}
            />
          );

          return items.map((item) => {
            if (item.kind === 'single') return renderRow(item.event);
            const { group } = item;
            const total = group.events.reduce((s, e) => s + e.amount, 0);
            // Singleton groups auto-expand: a collapsed card for one row is
            // visual overhead without information density.
            const open = group.events.length === 1 || expandedGroups.has(group.runId);
            return (
              <GroupCard key={group.runId}>
                <GroupHeader
                  type='button'
                  onClick={() => {
                    const next = new Set(expandedGroups);
                    if (open) next.delete(group.runId); else next.add(group.runId);
                    setExpandedGroups(next);
                  }}
                >
                  <i className={`pi pi-chevron-${open ? 'down' : 'right'}`} style={{ fontSize: fontSize.xs }} />
                  <i className={eventTypeIcons['roth_conversion']} style={{ color: colors.income }} />
                  <span style={{ flex: 1 }}>
                    Roth Conversions
                    <GeneratedChip>{generatorLabel(group.generatedBy)}</GeneratedChip>
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>
                    {group.events.length} year{group.events.length === 1 ? '' : 's'} · ${total.toLocaleString()}
                    {group.generatedAt ? ` · ${group.generatedAt}` : ''}
                  </span>
                </GroupHeader>
                {open && (
                  <GroupBody>
                    {group.events
                      .slice()
                      .sort((a, b) => startYearOf(a) - startYearOf(b))
                      .map((e) => renderRow(e))}
                    {onDeleteGroup && (
                      <GroupActions>
                        <DeleteGroupButton
                          type='button'
                          aria-label='Delete all generated conversions in this batch'
                          onClick={() => {
                            const n = group.events.length;
                            confirmDialog({
                              message: n === 1
                                ? 'Delete this generated Roth conversion event?'
                                : `Delete all ${n} generated Roth conversion events in this batch? Manual and detached rows are not affected.`,
                              header: 'Delete generated conversions',
                              icon: 'pi pi-exclamation-triangle',
                              acceptLabel: 'Delete',
                              rejectLabel: 'Cancel',
                              accept: () => onDeleteGroup(group.events.map((e) => e.id)),
                            });
                          }}
                        >
                          <i className='pi pi-trash' />
                          Delete all generated conversions
                        </DeleteGroupButton>
                      </GroupActions>
                    )}
                  </GroupBody>
                )}
              </GroupCard>
            );
          });
        })()}
      </SlatList>

      <EventTypeSelectionDialog
        visible={selectionDialogVisible}
        onHide={() => setSelectionDialogVisible(false)}
        onSelectType={handleTypeSelect}
        filingStatus={userData.filingStatus}
        existingSSEvents={events.filter((e) => e.type === 'social_security')}
      />

      {(selectedType === 'social_security' || editingEvent?.type === 'social_security') ? (
        <SocialSecurityDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingEvent(undefined);
          }}
          onSave={handleSave}
          onDelete={editingEvent ? () => { onDelete(editingEvent.id); setDialogVisible(false); setSelectedType(null); setEditingEvent(undefined); } : undefined}
          editEvent={editingEvent}
          filingStatus={userData.filingStatus}
          existingSSEvents={events.filter((e) => e.type === 'social_security')}
          currentAge={userData.currentAge}
          spouseAge={userData.spouseAge}
          referenceYear={userData.referenceYear}
        />
      ) : (selectedType === 'pension_income' || editingEvent?.type === 'pension_income') ? (
        <PensionIncomeDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingEvent(undefined);
          }}
          onSave={handleSave}
          onDelete={editingEvent ? () => { onDelete(editingEvent.id); setDialogVisible(false); setSelectedType(null); setEditingEvent(undefined); } : undefined}
          editEvent={editingEvent}
          existingEvents={events}
          currentAge={userData.currentAge}
          spouseAge={userData.spouseAge}
          filingStatus={userData.filingStatus}
          referenceYear={userData.referenceYear}
        />
      ) : (selectedType === 'retirement_contribution' || editingEvent?.type === 'retirement_contribution') ? (
        <RetirementContributionDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingEvent(undefined);
          }}
          onSave={handleSave}
          onDelete={editingEvent ? () => { onDelete(editingEvent.id); setDialogVisible(false); setSelectedType(null); setEditingEvent(undefined); } : undefined}
          editEvent={editingEvent}
          existingEvents={events}
          accounts={accounts}
          currentAge={userData.currentAge}
          spouseAge={userData.spouseAge}
          filingStatus={userData.filingStatus}
          referenceYear={userData.referenceYear}
        />
      ) : (selectedType === 'roth_conversion' || editingEvent?.type === 'roth_conversion') ? (
        <RothConversionDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingEvent(undefined);
          }}
          onSave={handleSave}
          onDelete={editingEvent ? () => { onDelete(editingEvent.id); setDialogVisible(false); setSelectedType(null); setEditingEvent(undefined); } : undefined}
          editEvent={editingEvent}
          existingEvents={events}
          userData={userData}
        />
      ) : (
        <IncomeEventDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingEvent(undefined);
          }}
          onSave={handleSave}
          onDelete={editingEvent ? () => { onDelete(editingEvent.id); setDialogVisible(false); setSelectedType(null); setEditingEvent(undefined); } : undefined}
          initialType={selectedType || undefined}
          editEvent={editingEvent}
          existingEvents={events}
          currentAge={userData.currentAge}
          referenceYear={userData.referenceYear}
        />
      )}
    </Container>
  );
};
