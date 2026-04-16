import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import type { Account } from '../types/Account';
import { spacing, colors } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges } from '../utils/ageOptions';

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
  existingEvents?: IncomeEvent[];
  accounts?: Account[];
  currentAge: number;
  referenceYear: number;
}

import { eventTypeLabels, eventTypeIcons, generateDefaultIncomeEventName } from '../utils/defaultName';

const getDefaultCOLA = (
  type: IncomeEventType
): 'fixed' | 'inflation_adjusted' => {
  const inflationAdjustedTypes: IncomeEventType[] = [
    'employment_savings',
    'social_security',
    'inheritance',
    'rental_income',
    'sale_of_property',
    'work_during_retirement',
    'other_income',
  ];
  return inflationAdjustedTypes.includes(type) ? 'inflation_adjusted' : 'fixed';
};

const getDefaultTaxStatus = (type: IncomeEventType): 'before_tax' | 'after_tax' => {
  if (type === 'employment_savings') return 'after_tax';
  return 'before_tax';
};

const makeDefaultFormData = (type: IncomeEventType = 'pension_income') => ({
  type,
  name: '',
  amount: 0,
  startAge: type === 'employment_savings' ? 40 : 65,
  endAge: (type === 'employment_savings' ? 65 : undefined) as number | undefined,
  isOneTime: false,
  taxStatus: getDefaultTaxStatus(type),
  colaType: getDefaultCOLA(type),
  accountId: undefined as string | undefined,
});

const IncomeEventDialog: React.FC<IncomeEventDialogProps> = ({
  visible,
  onHide,
  onSave,
  initialType,
  editEvent,
  existingEvents = [],
  accounts = [],
  currentAge,
  referenceYear,
}) => {
  const isEditing = !!editEvent;
  const [formData, setFormData] = useState(makeDefaultFormData());

  const range = incomeEventAgeRanges[formData.type];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = formData.endAge ? Math.min(range.min, formData.endAge) : range.min;
  const startAgeOptions = buildAgeOptions(referenceYear, currentAge, effectiveMin, range.max);
  const endAgeOptions = buildEndAgeOptions(referenceYear, currentAge, effectiveEndMin, range.max);

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      setFormData({
        type: editEvent.type,
        name: editEvent.name,
        amount: editEvent.amount,
        startAge: editEvent.startAge,
        endAge: editEvent.endAge,
        isOneTime: editEvent.isOneTime || false,
        taxStatus: editEvent.taxStatus,
        colaType: editEvent.colaType,
        accountId: editEvent.accountId,
      });
    } else if (initialType) {
      const defaults = makeDefaultFormData(initialType);
      defaults.name = generateDefaultIncomeEventName(initialType, existingEvents);
      setFormData(defaults);
    } else {
      setFormData(makeDefaultFormData());
    }
  }, [visible, editEvent, initialType, existingEvents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onHide();
  };

  const taxStatusOptions = [
    { label: 'Before Tax', value: 'before_tax' },
    { label: 'After Tax', value: 'after_tax' },
  ];

  const headerLabel = (
    <>
      <i className={eventTypeIcons[formData.type]} style={{ marginRight: spacing.sm, color: colors.primary }} />
      {isEditing ? `Edit ${eventTypeLabels[formData.type]}` : `Add ${eventTypeLabels[formData.type]}`}
    </>
  );

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
          <label>Name</label>
          <InputText
            value={formData.name}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
            required
          />
        </InputGroup>

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
            <Dropdown
              value={formData.startAge}
              options={startAgeOptions}
              onChange={(e) =>
                setFormData({ ...formData, startAge: e.value })
              }
            />
          </InputGroup>

          <InputGroup>
            <label>End Age (optional)</label>
            <Dropdown
              value={formData.endAge ?? 0}
              options={endAgeOptions}
              onChange={(e) =>
                setFormData({ ...formData, endAge: e.value === 0 ? undefined : e.value })
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

        {formData.type !== 'employment_savings' && (
          <InputGroup>
            <label>Tax Status</label>
            <Dropdown
              value={formData.taxStatus}
              options={taxStatusOptions}
              onChange={(e) => setFormData({ ...formData, taxStatus: e.value })}
            />
          </InputGroup>
        )}

        {formData.type === 'employment_savings' && accounts.length > 0 && (
          <InputGroup>
            <label>Target Account</label>
            <Dropdown
              value={formData.accountId ?? ''}
              options={[
                { label: 'Default (first Traditional)', value: '' },
                ...accounts.map((a) => ({ label: a.name, value: a.id })),
              ]}
              onChange={(e) =>
                setFormData({ ...formData, accountId: e.value || undefined })
              }
            />
          </InputGroup>
        )}

        <CheckboxGroup>
          <Checkbox
            inputId='colaType'
            checked={formData.colaType === 'inflation_adjusted'}
            onChange={(e) =>
              setFormData({ ...formData, colaType: e.checked ? 'inflation_adjusted' : 'fixed' })
            }
          />
          <label htmlFor='colaType'>Inflation adjusted</label>
        </CheckboxGroup>

      </Form>
    </Dialog>
  );
};

export default IncomeEventDialog;
