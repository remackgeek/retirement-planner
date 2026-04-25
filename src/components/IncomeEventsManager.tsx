import React, { useState } from 'react';
import styled from 'styled-components';
import EventTypeSelectionDialog from '../dialogs/EventTypeSelectionDialog';
import IncomeEventDialog from '../dialogs/IncomeEventDialog';
import SocialSecurityDialog from '../dialogs/SocialSecurityDialog';
import PensionIncomeDialog from '../dialogs/PensionIncomeDialog';
import RothConversionDialog from '../dialogs/RothConversionDialog';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import type { Account } from '../types/Account';
import { spacing, colors, border, fontSize } from '../styles/theme';
import { ManagerRow, RightAmount, SlatList, AddButton, Header, HeaderLeft } from './ManagerRow';

const Container = styled.div``;

const ConversionChip = styled.span`
  padding: 0 ${spacing.xs};
  background: ${colors.chipBg};
  color: ${colors.textSecondary};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  font-weight: normal;
`;

const eventTypeSymbols: Record<IncomeEventType, string> = {
  employment_savings: '💰',
  social_security: '🛡',
  annuity_income: '$',
  inheritance: '⬇',
  pension_income: '⚒',
  rental_income: '⌂',
  roth_conversion: '↻',
  sale_of_property: '⇄',
  work_during_retirement: '⚙',
  other_income: '●',
};

interface IncomeEventsManagerProps {
  events: IncomeEvent[];
  userData: any;
  accounts: Account[];
  onAdd: (event: Omit<IncomeEvent, 'id'>) => void;
  onUpdate: (id: string, event: Partial<IncomeEvent>) => void;
  onDelete: (id: string) => void;
}

export const IncomeEventsManager: React.FC<IncomeEventsManagerProps> = ({
  events,
  userData,
  accounts,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [selectionDialogVisible, setSelectionDialogVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<IncomeEventType | null>(null);
  const [editingEvent, setEditingEvent] = useState<IncomeEvent | undefined>(undefined);

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
          <div style={{ fontSize: fontSize.sm, visibility: 'hidden' }}>&nbsp;</div>
        </HeaderLeft>
        <AddButton onClick={() => setSelectionDialogVisible(true)}>Add</AddButton>
      </Header>

      <SlatList>
        {[...events]
          .sort((a, b) => {
            const aAge = (a.owner === 'spouse' && userData.spouseAge !== null) ? userData.spouseAge : userData.currentAge;
            const bAge = (b.owner === 'spouse' && userData.spouseAge !== null) ? userData.spouseAge : userData.currentAge;
            const aStartYear = userData.referenceYear + (a.startAge - aAge);
            const bStartYear = userData.referenceYear + (b.startAge - bAge);
            return aStartYear - bStartYear;
          })
          .map((event) => (
            <ManagerRow
              key={event.id}
              icon={eventTypeSymbols[event.type]}
              iconBg={colors.incomeBg}
              iconColor={colors.income}
              name={event.name}
              badge={event.type === 'roth_conversion' && (
                <ConversionChip>Conversion</ConversionChip>
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
          ))}
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
          accounts={accounts}
          currentAge={userData.currentAge}
          referenceYear={userData.referenceYear}
        />
      )}
    </Container>
  );
};
