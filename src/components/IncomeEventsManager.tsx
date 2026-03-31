import React, { useState } from 'react';
import styled from 'styled-components';
import EventTypeSelectionDialog from '../dialogs/EventTypeSelectionDialog';
import IncomeEventDialog from '../dialogs/IncomeEventDialog';
import SocialSecurityDialog from '../dialogs/SocialSecurityDialog';
import PensionIncomeDialog from '../dialogs/PensionIncomeDialog';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import { spacing, colors, border, fontSize } from '../styles/theme';

const Container = styled.div``;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${spacing.sm};
  h3 {
    margin: 0;
  }
`;

const EventItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: ${spacing.sm};
  border: ${border.standard};
  margin-bottom: ${spacing.sm};
  border-radius: ${border.radius};
`;

const EventInfo = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: ${spacing.xs};
  align-self: flex-end;
`;

const Button = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.sm};

  &:hover {
    background: ${colors.primaryHover};
  }
`;

const LargeButton = styled(Button)`
  padding: ${spacing.sm} ${spacing.lg};
  font-size: ${fontSize.xl};
`;

const DeleteButton = styled(Button)`
  background: ${colors.danger};

  &:hover {
    background: ${colors.dangerHover};
  }
`;

const eventTypeSymbols: Record<IncomeEventType, string> = {
  employment_savings: '💰',
  social_security: '🛡',
  annuity_income: '$',
  inheritance: '⬇',
  pension_income: '⚒',
  rental_income: '⌂',
  sale_of_property: '⇄',
  work_during_retirement: '⚙',
  other_income: '●',
};

interface IncomeEventsManagerProps {
  events: IncomeEvent[];
  userData: any;
  onAdd: (event: Omit<IncomeEvent, 'id'>) => void;
  onUpdate: (id: string, event: Partial<IncomeEvent>) => void;
  onDelete: (id: string) => void;
}

export const IncomeEventsManager: React.FC<IncomeEventsManagerProps> = ({
  events,
  userData,
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
        <h3>Income Events</h3>
        <LargeButton onClick={() => setSelectionDialogVisible(true)}>
          Add Event
        </LargeButton>
      </Header>

      {[...events]
        .sort((a, b) => {
          const aAge = (a.owner === 'spouse' && userData.spouseAge !== null) ? userData.spouseAge : userData.currentAge;
          const bAge = (b.owner === 'spouse' && userData.spouseAge !== null) ? userData.spouseAge : userData.currentAge;
          const aStartYear = userData.referenceYear + (a.startAge - aAge);
          const bStartYear = userData.referenceYear + (b.startAge - bAge);
          return aStartYear - bStartYear;
        })
        .map((event) => (
          <EventItem key={event.id}>
            <EventInfo>
              <div style={{ marginBottom: spacing.xs }}>
                <strong>
                  <span
                    style={{
                      marginRight: spacing.xs,
                      color: colors.income,
                      backgroundColor: colors.incomeBg,
                      borderRadius: border.radiusCircle,
                      padding: spacing.xs,
                      fontSize: fontSize.md,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.5rem',
                      height: '1.5rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {eventTypeSymbols[event.type]}
                  </span>
                  {event.name}
                </strong>
              </div>
              ${event.amount.toLocaleString()}
              {event.isOneTime
                ? ' one-time at age '
                : ' annually starting at age '}
              {event.startAge}
              {event.endAge && !event.isOneTime && ` until age ${event.endAge}`}
              {event.isOneTime && ' (one-time event)'}
              <br />
              {event.type === 'social_security'
                ? (event.ssAmountBasis === 'future' ? 'Future dollars' : "Today's dollars")
                : <>
                    {event.taxStatus === 'before_tax' ? 'Before tax' : 'After tax'} •{' '}
                    {event.colaType === 'fixed' ? 'Fixed amount' : 'Inflation adjusted'}
                  </>}
            </EventInfo>
            <Actions>
              <Button onClick={() => startEdit(event)}>Edit</Button>
              <DeleteButton onClick={() => onDelete(event.id)}>
                Delete
              </DeleteButton>
            </Actions>
          </EventItem>
        ))}

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
          editEvent={editingEvent}
          existingEvents={events}
          currentAge={userData.currentAge}
          spouseAge={userData.spouseAge}
          filingStatus={userData.filingStatus}
          referenceYear={userData.referenceYear}
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
