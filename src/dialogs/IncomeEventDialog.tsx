import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
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

const TrashButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: ${spacing.xs};
  border-radius: ${border.radius};
  color: ${colors.danger};
  font-size: ${fontSize.xl};
  line-height: 1;
  display: flex;
  align-items: center;

  &:hover {
    color: ${colors.dangerHover};
    background: ${colors.bgMedium};
  }
`;

interface IncomeEventDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  onDelete?: () => void;
  initialType?: IncomeEventType;
  editEvent?: IncomeEvent;
  existingEvents?: IncomeEvent[];
  currentAge: number;
  referenceYear: number;
}

import { eventTypeLabels, eventTypeIcons, generateDefaultIncomeEventName } from '../utils/defaultName';

const getDefaultCOLA = (
  type: IncomeEventType
): 'fixed' | 'inflation_adjusted' => {
  const inflationAdjustedTypes: IncomeEventType[] = [
    'wage_income',
    'social_security',
    'inheritance',
    'rental_income',
    'sale_of_property',
    'work_during_retirement',
    'other_income',
  ];
  return inflationAdjustedTypes.includes(type) ? 'inflation_adjusted' : 'fixed';
};

const makeDefaultFormData = (type: IncomeEventType = 'pension_income') => ({
  type,
  name: '',
  amount: 0,
  startAge: type === 'wage_income' ? 40 : 65,
  endAge: (type === 'wage_income' ? 65 : undefined) as number | undefined,
  isOneTime: false,
  taxStatus: 'before_tax' as 'before_tax' | 'after_tax',
  colaType: getDefaultCOLA(type),
});

const IncomeEventDialog: React.FC<IncomeEventDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  initialType,
  editEvent,
  existingEvents = [],
  currentAge,
  referenceYear,
}) => {
  const isEditing = !!editEvent;
  const [formData, setFormData] = useState(makeDefaultFormData());

  const range = incomeEventAgeRanges[formData.type];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = Math.max(range.min, formData.startAge + 1);
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
      });
    } else if (initialType) {
      const defaults = makeDefaultFormData(initialType);
      defaults.name = generateDefaultIncomeEventName(initialType, existingEvents);
      defaults.startAge = currentAge;
      if (initialType === 'wage_income') {
        defaults.endAge = Math.min(incomeEventAgeRanges['wage_income'].max, currentAge + 20);
      }
      setFormData(defaults);
    } else {
      setFormData(makeDefaultFormData());
    }
  }, [visible, editEvent, initialType, existingEvents, currentAge]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onHide();
  };

  const taxStatusOptions = [
    { label: 'Before Tax', value: 'before_tax' },
    { label: 'After Tax', value: 'after_tax' },
  ];

  const handleDeleteClick = () => {
    confirmDialog({
      message: `Are you sure you want to delete "${formData.name}"?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: onDelete,
    });
  };

  const headerLabel = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <span>
        <i className={eventTypeIcons[formData.type]} style={{ marginRight: spacing.sm, color: colors.primary }} />
        {isEditing ? `Edit ${eventTypeLabels[formData.type]}` : `Add ${eventTypeLabels[formData.type]}`}
      </span>
      {onDelete && (
        <TrashButton onClick={handleDeleteClick} title="Delete">
          <i className="pi pi-trash" />
        </TrashButton>
      )}
    </div>
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
      style={dialogWidth('32rem')}
      onHide={onHide}
      closable={false}
      closeOnEscape={true}
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
            min={0}
            required
          />
        </InputGroup>

        <FieldRow>
          <InputGroup>
            <label>Start Age</label>
            <Dropdown
              value={formData.startAge}
              options={startAgeOptions}
              onChange={(e) => setFormData({
                ...formData,
                startAge: e.value,
                endAge: formData.endAge && formData.endAge <= e.value ? undefined : formData.endAge,
              })}
            />
          </InputGroup>

          {!formData.isOneTime && (
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
          )}
        </FieldRow>

        <CheckboxGroup>
          <Checkbox
            inputId='isOneTime'
            checked={formData.isOneTime}
            onChange={(e) => {
              const checked = e.checked || false;
              setFormData({
                ...formData,
                isOneTime: checked,
                endAge: checked ? undefined : Math.min(range.max, formData.startAge + 10),
              });
            }}
          />
          <label htmlFor='isOneTime'>One-time event (occurs only in start year)</label>
        </CheckboxGroup>

        {formData.type !== 'wage_income' && (
          <InputGroup>
            <label>Tax Status</label>
            <Dropdown
              value={formData.taxStatus}
              options={taxStatusOptions}
              onChange={(e) => setFormData({ ...formData, taxStatus: e.value })}
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
