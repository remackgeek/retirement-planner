import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import { spacing } from '../styles/theme';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-inputtext,
  .p-dropdown,
  .p-inputnumber {
    width: 100%;
  }
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.md};
`;

const CheckboxGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

interface IncomeEventDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  initialType?: IncomeEventType;
  editEvent?: IncomeEvent;
}

export const eventTypeLabels: Record<IncomeEventType, string> = {
  social_security: 'Social Security',
  annuity_income: 'Annuity Income',
  inheritance: 'Inheritance',
  pension_income: 'Pension Income',
  rental_income: 'Rental Income',
  sale_of_property: 'Sale of Property/Downsize',
  work_during_retirement: 'Work During Retirement',
  other_income: 'Other Income',
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
  return inflationAdjustedTypes.includes(type) ? 'inflation_adjusted' : 'fixed';
};

const makeDefaultFormData = (type: IncomeEventType = 'social_security') => ({
  type,
  name: '',
  amount: 0,
  startAge: 65,
  endAge: undefined as number | undefined,
  isOneTime: false,
  taxStatus: 'before_tax' as 'before_tax' | 'after_tax',
  colaType: getDefaultCOLA(type),
  syncWithEstimate: false,
});

const IncomeEventDialog: React.FC<IncomeEventDialogProps> = ({
  visible,
  onHide,
  onSave,
  initialType,
  editEvent,
}) => {
  const isEditing = !!editEvent;
  const [formData, setFormData] = useState(makeDefaultFormData());

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      setFormData({
        type: editEvent.type,
        name: editEvent.name || '',
        amount: editEvent.amount,
        startAge: editEvent.startAge,
        endAge: editEvent.endAge,
        isOneTime: editEvent.isOneTime || false,
        taxStatus: editEvent.taxStatus,
        colaType: editEvent.colaType,
        syncWithEstimate: editEvent.syncWithEstimate || false,
      });
    } else if (initialType) {
      setFormData(makeDefaultFormData(initialType));
    } else {
      setFormData(makeDefaultFormData());
    }
  }, [visible, editEvent, initialType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onHide();
  };

  const handleTypeChange = (type: IncomeEventType) => {
    setFormData({
      ...formData,
      type,
      colaType: getDefaultCOLA(type),
      taxStatus: type === 'social_security' ? 'before_tax' : formData.taxStatus,
    });
  };

  const taxStatusOptions = [
    { label: 'Before Tax', value: 'before_tax' },
    { label: 'After Tax', value: 'after_tax' },
  ];

  const colaOptions = [
    { label: 'Fixed Amount', value: 'fixed' },
    { label: 'Inflation Adjusted', value: 'inflation_adjusted' },
  ];

  const headerLabel = isEditing
    ? `Edit ${eventTypeLabels[formData.type]}`
    : `Add ${eventTypeLabels[formData.type]}`;

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
      <Button
        label={isEditing ? 'Save Changes' : 'Add Event'}
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  return (
    <Dialog
      header={headerLabel}
      visible={visible}
      style={{ width: '32rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <label>Event Type</label>
          <Dropdown
            value={formData.type}
            options={Object.entries(eventTypeLabels).map(([value, label]) => ({
              label,
              value,
            }))}
            onChange={(e) => handleTypeChange(e.value as IncomeEventType)}
          />
        </InputGroup>

        {formData.type === 'other_income' && (
          <InputGroup>
            <label>Event Name</label>
            <InputText
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder='e.g., Part-time consulting'
              required
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Annual Amount</label>
          <InputNumber
            value={formData.amount}
            onValueChange={(e) =>
              setFormData({ ...formData, amount: e.value || 0 })
            }
            mode='currency'
            currency='USD'
            required
          />
        </InputGroup>

        <FieldRow>
          <InputGroup>
            <label>Start Age</label>
            <InputNumber
              value={formData.startAge}
              onValueChange={(e) =>
                setFormData({ ...formData, startAge: e.value || 65 })
              }
              required
            />
          </InputGroup>

          <InputGroup>
            <label>End Age (optional)</label>
            <InputNumber
              value={formData.endAge ?? null}
              onValueChange={(e) =>
                setFormData({ ...formData, endAge: e.value ?? undefined })
              }
            />
          </InputGroup>
        </FieldRow>

        <CheckboxGroup>
          <Checkbox
            inputId='isOneTime'
            checked={formData.isOneTime}
            onChange={(e) =>
              setFormData({ ...formData, isOneTime: e.checked || false })
            }
          />
          <label htmlFor='isOneTime'>One-time event (occurs only in start year)</label>
        </CheckboxGroup>

        {formData.type !== 'social_security' && (
          <InputGroup>
            <label>Tax Status</label>
            <Dropdown
              value={formData.taxStatus}
              options={taxStatusOptions}
              onChange={(e) => setFormData({ ...formData, taxStatus: e.value })}
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Cost of Living Adjustment</label>
          <Dropdown
            value={formData.colaType}
            options={colaOptions}
            onChange={(e) => setFormData({ ...formData, colaType: e.value })}
          />
        </InputGroup>

        {formData.type === 'social_security' && (
          <CheckboxGroup>
            <Checkbox
              inputId='syncWithEstimate'
              checked={formData.syncWithEstimate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  syncWithEstimate: e.checked || false,
                })
              }
            />
            <label htmlFor='syncWithEstimate'>Sync with SSA estimate</label>
          </CheckboxGroup>
        )}
      </Form>
    </Dialog>
  );
};

export default IncomeEventDialog;
