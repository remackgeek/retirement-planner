import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 0;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const CheckboxGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

interface AddIncomeEventDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  initialType?: IncomeEventType;
}

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

const AddIncomeEventDialog: React.FC<AddIncomeEventDialogProps> = ({
  visible,
  onHide,
  onSave,
  initialType,
}) => {
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

  // Reset form when dialog opens with initial type
  useEffect(() => {
    if (visible && initialType) {
      setFormData({
        type: initialType,
        name: '',
        amount: 0,
        startAge: 65,
        endAge: undefined,
        isOneTime: false,
        taxStatus:
          initialType === 'social_security' ? 'before_tax' : 'before_tax',
        colaType: getDefaultCOLA(initialType),
        syncWithEstimate: false,
      });
    }
  }, [visible, initialType]);

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

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
      <Button
        label='Add Event'
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  return (
    <Dialog
      header={`Add ${eventTypeLabels[formData.type]}`}
      visible={visible}
      style={{ width: '50vw' }}
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
            value={formData.endAge}
            onValueChange={(e) =>
              setFormData({ ...formData, endAge: e.value || undefined })
            }
          />
        </InputGroup>

        <CheckboxGroup>
          <Checkbox
            checked={formData.isOneTime}
            onChange={(e) =>
              setFormData({ ...formData, isOneTime: e.checked || false })
            }
          />
          <label>One-time event (occurs only in start year)</label>
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
              checked={formData.syncWithEstimate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  syncWithEstimate: e.checked || false,
                })
              }
            />
            <label>Sync with SSA estimate</label>
          </CheckboxGroup>
        )}
      </Form>
    </Dialog>
  );
};

export default AddIncomeEventDialog;
