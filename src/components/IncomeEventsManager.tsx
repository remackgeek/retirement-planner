import React, { useState } from 'react';
import styled from 'styled-components';
import EventTypeSelectionDialog from '../dialogs/EventTypeSelectionDialog';
import AddIncomeEventDialog from '../dialogs/AddIncomeEventDialog';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';

const Container = styled.div`
  margin: 1rem 0;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
`;

const EventItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.5rem;
  border: 1px solid #ddd;
  margin-bottom: 0.5rem;
  border-radius: 4px;
  position: relative;
`;

const EventInfo = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  position: absolute;
  bottom: 0.5rem;
  right: 0.5rem;
`;

const Button = styled.button`
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: #007bff;
  color: white;

  &:hover {
    background: #0056b3;
  }
`;

const LargeButton = styled(Button)`
  padding: 0.5rem 1rem;
  font-size: 1.1rem;
`;

const DeleteButton = styled(Button)`
  background: #dc3545;

  &:hover {
    background: #c82333;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const Input = styled.input`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
`;

const Select = styled.select`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
`;

const Checkbox = styled.input`
  margin-right: 0.5rem;
`;

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
  const [addDialogVisible, setAddDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<IncomeEventType | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'social_security' as IncomeEventType,
    name: '',
    amount: 0,
    startAge: 65,
    endAge: undefined as number | undefined,
    isOneTime: false,
    taxStatus: 'before_tax' as 'before_tax' | 'after_tax',
    colaType: 'inflation_adjusted' as 'fixed' | 'inflation_adjusted',
    syncWithEstimate: false,
  });

  const handleTypeSelect = (type: IncomeEventType) => {
    setSelectedType(type);
    setAddDialogVisible(true);
  };

  const handleAddEvent = (event: Omit<IncomeEvent, 'id'>) => {
    onAdd(event);
    setAddDialogVisible(false);
    setSelectedType(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      onUpdate(editingId, formData);
      setEditingId(null);
    }
    setFormData({
      type: 'social_security',
      name: '',
      amount: 0,
      startAge: 65,
      endAge: undefined,
      isOneTime: false,
      taxStatus: 'before_tax',
      colaType: 'inflation_adjusted',
      syncWithEstimate: false,
    });
  };

  const startEdit = (event: IncomeEvent) => {
    setEditingId(event.id);
    setFormData({
      type: event.type,
      name: event.name || '',
      amount: event.amount,
      startAge: event.startAge,
      endAge: event.endAge,
      isOneTime: event.isOneTime || false,
      taxStatus: event.taxStatus,
      colaType: event.colaType,
      syncWithEstimate: event.syncWithEstimate || false,
    });
  };

  const eventTypeLabels: Record<IncomeEventType, string> = {
    social_security: 'Social Security',
    annuity_income: 'Annuity Income',
    inheritance: 'Inheritance',
    pension_income: 'Pension Income',
    rental_income: 'Rental Income',
    sale_of_property: 'Sale of Property/Downsize',
    work_during_retirement: 'Work During Retirement',
    other_income: 'Other Income',
  };

  const eventTypeSymbols: Record<IncomeEventType, string> = {
    social_security: '🛡',
    annuity_income: '$',
    inheritance: '⬇',
    pension_income: '⚒',
    rental_income: '⌂',
    sale_of_property: '⇄',
    work_during_retirement: '⚙',
    other_income: '●',
  };

  const getDefaultCOLA = (
    type: IncomeEventType
  ): 'fixed' | 'inflation_adjusted' => {
    const inflationAdjustedTypes: IncomeEventType[] = [
      'social_security',
      'inheritance',
      'rental_income',
      'sale_of_property',
      'work_during_retirement',
      'other_income',
    ];
    return inflationAdjustedTypes.includes(type)
      ? 'inflation_adjusted'
      : 'fixed';
  };

  const handleTypeChange = (type: IncomeEventType) => {
    setFormData({
      ...formData,
      type,
      colaType: getDefaultCOLA(type),
      taxStatus: type === 'social_security' ? 'before_tax' : formData.taxStatus,
    });
  };

  return (
    <Container>
      <Header>
        <h3>Income Events</h3>
        {!editingId && (
          <LargeButton onClick={() => setSelectionDialogVisible(true)}>
            Add Event
          </LargeButton>
        )}
      </Header>

      {editingId && (
        <Form onSubmit={handleSubmit}>
          <Select
            value={formData.type}
            onChange={(e) =>
              handleTypeChange(e.target.value as IncomeEventType)
            }
          >
            {Object.entries(eventTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          {formData.type === 'other_income' && (
            <Input
              type='text'
              placeholder='Event name'
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
            />
          )}

          <Input
            type='number'
            placeholder='Annual amount'
            value={formData.amount}
            onChange={(e) =>
              setFormData({ ...formData, amount: Number(e.target.value) })
            }
            required
          />

          <Input
            type='number'
            placeholder='Start age'
            value={formData.startAge}
            onChange={(e) =>
              setFormData({ ...formData, startAge: Number(e.target.value) })
            }
            required
          />

          <Input
            type='number'
            placeholder='End age (optional)'
            value={formData.endAge || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                endAge: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />

          <label>
            <Checkbox
              type='checkbox'
              checked={formData.isOneTime}
              onChange={(e) =>
                setFormData({ ...formData, isOneTime: e.target.checked })
              }
            />
            One-time event (occurs only in start year)
          </label>

          {formData.type !== 'social_security' && (
            <Select
              value={formData.taxStatus}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  taxStatus: e.target.value as 'before_tax' | 'after_tax',
                })
              }
            >
              <option value='before_tax'>Before Tax</option>
              <option value='after_tax'>After Tax</option>
            </Select>
          )}

          <Select
            value={formData.colaType}
            onChange={(e) =>
              setFormData({
                ...formData,
                colaType: e.target.value as 'fixed' | 'inflation_adjusted',
              })
            }
          >
            <option value='fixed'>Fixed Amount</option>
            <option value='inflation_adjusted'>Inflation Adjusted</option>
          </Select>

          {formData.type === 'social_security' && (
            <label>
              <Checkbox
                type='checkbox'
                checked={formData.syncWithEstimate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    syncWithEstimate: e.target.checked,
                  })
                }
              />
              Sync with SSA estimate
            </label>
          )}

          <div>
            <Button type='submit'>Update Event</Button>
            <Button
              type='button'
              onClick={() => {
                setEditingId(null);
                setFormData({
                  type: 'social_security',
                  name: '',
                  amount: 0,
                  startAge: 65,
                  endAge: undefined,
                  isOneTime: false,
                  taxStatus: 'before_tax',
                  colaType: 'inflation_adjusted',
                  syncWithEstimate: false,
                });
              }}
            >
              Cancel
            </Button>
          </div>
        </Form>
      )}

      {[...events]
        .sort((a, b) => {
          const aStartYear =
            new Date().getFullYear() + (a.startAge - userData.currentAge);
          const bStartYear =
            new Date().getFullYear() + (b.startAge - userData.currentAge);
          return aStartYear - bStartYear;
        })
        .map((event) => (
          <EventItem key={event.id}>
            <EventInfo>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>
                  <span
                    style={{
                      marginRight: '0.5rem',
                      color: 'green',
                      backgroundColor: 'rgba(0, 128, 0, 0.1)',
                      borderRadius: '50%',
                      padding: '0.25rem',
                      fontSize: '0.9rem',
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
                  {eventTypeLabels[event.type]}
                  {event.name && ` - ${event.name}`}
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
              {event.taxStatus === 'before_tax'
                ? 'Before tax'
                : 'After tax'} •{' '}
              {event.colaType === 'fixed'
                ? 'Fixed amount'
                : 'Inflation adjusted'}
              {event.syncWithEstimate && ' • Synced with estimate'}
            </EventInfo>
            <Actions>
              <DeleteButton onClick={() => onDelete(event.id)}>
                Delete
              </DeleteButton>
              <Button onClick={() => startEdit(event)}>Edit</Button>
            </Actions>
          </EventItem>
        ))}

      <EventTypeSelectionDialog
        visible={selectionDialogVisible}
        onHide={() => setSelectionDialogVisible(false)}
        onSelectType={handleTypeSelect}
      />

      <AddIncomeEventDialog
        visible={addDialogVisible}
        onHide={() => {
          setAddDialogVisible(false);
          setSelectedType(null);
        }}
        onSave={handleAddEvent}
        initialType={selectedType || undefined}
      />
    </Container>
  );
};
