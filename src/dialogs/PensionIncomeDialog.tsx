import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent } from '../types/IncomeEvent';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges } from '../utils/ageOptions';
import { generateDefaultIncomeEventName, eventTypeIcons } from '../utils/defaultName';
import { resolveOwnerAge } from '../utils/ownerAge';

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

const AmountRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 9rem;
  gap: ${spacing.sm};
  align-items: start;
`;

const CheckboxGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
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

interface PensionIncomeDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  onDelete?: () => void;
  editEvent?: IncomeEvent;
  existingEvents: IncomeEvent[];
  currentAge: number;
  spouseAge: number | null;
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  referenceYear: number;
}

const makeDefaultFormData = () => ({
  name: '',
  owner: 'self' as 'self' | 'spouse',
  displayAmount: 0,
  amountPeriod: 'monthly' as 'monthly' | 'annual',
  startAge: 65,
  endAge: undefined as number | undefined,
  taxStatus: 'before_tax' as 'before_tax' | 'after_tax',
  colaType: 'fixed' as 'fixed' | 'inflation_adjusted',
});

const PensionIncomeDialog: React.FC<PensionIncomeDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  editEvent,
  existingEvents,
  currentAge,
  spouseAge,
  filingStatus,
  referenceYear,
}) => {
  const isEditing = !!editEvent;
  const isMfj = filingStatus === 'mfj';
  const [formData, setFormData] = useState(makeDefaultFormData());

  const ownerAge = resolveOwnerAge(formData.owner, currentAge, spouseAge);
  const range = incomeEventAgeRanges['pension_income'];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = Math.max(range.min, formData.startAge + 1);
  const startAgeOptions = buildAgeOptions(referenceYear, ownerAge, effectiveMin, range.max);
  const endAgeOptions = buildEndAgeOptions(referenceYear, ownerAge, effectiveEndMin, range.max);

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      const period = editEvent.amountPeriod ?? 'annual';
      const displayAmount = period === 'monthly' ? editEvent.amount / 12 : editEvent.amount;
      setFormData({
        name: editEvent.name,
        owner: editEvent.owner ?? 'self',
        displayAmount,
        amountPeriod: period,
        startAge: editEvent.startAge,
        endAge: editEvent.endAge,
        taxStatus: editEvent.taxStatus,
        colaType: editEvent.colaType,
      });
    } else {
      setFormData({
        ...makeDefaultFormData(),
        startAge: Math.max(incomeEventAgeRanges['pension_income'].min, currentAge),
        name: generateDefaultIncomeEventName('pension_income', existingEvents),
      });
    }
  }, [visible, editEvent, existingEvents, currentAge]);

  const handlePeriodChange = (newPeriod: 'monthly' | 'annual') => {
    if (newPeriod === formData.amountPeriod) return;
    const converted =
      newPeriod === 'monthly'
        ? formData.displayAmount / 12
        : formData.displayAmount * 12;
    setFormData({
      ...formData,
      amountPeriod: newPeriod,
      displayAmount: Math.round(converted * 100) / 100,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const annualAmount =
      formData.amountPeriod === 'monthly'
        ? formData.displayAmount * 12
        : formData.displayAmount;
    onSave({
      type: 'pension_income',
      name: formData.name,
      owner: formData.owner,
      amount: annualAmount,
      amountPeriod: formData.amountPeriod,
      startAge: formData.startAge,
      endAge: formData.endAge,
      taxStatus: formData.taxStatus,
      colaType: formData.colaType,
    });
    onHide();
  };

  const periodOptions = [
    { label: 'Monthly', value: 'monthly' },
    { label: 'Annual', value: 'annual' },
  ];

  const ownerOptions = [
    { label: 'Self', value: 'self' },
    { label: 'Spouse', value: 'spouse' },
  ];

  const taxStatusOptions = [
    { label: 'Before Tax', value: 'before_tax' },
    { label: 'After Tax', value: 'after_tax' },
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
        label={isEditing ? 'Save Changes' : 'Add Event'}
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  const handleDeleteClick = () => {
    confirmDialog({
      message: `Are you sure you want to delete "${formData.name}"?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: onDelete,
    });
  };

  return (
    <Dialog
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>
            <i className={eventTypeIcons['pension_income']} style={{ marginRight: spacing.sm, color: colors.primary }} />
            {isEditing ? 'Edit Pension Income' : 'Add Pension Income'}
          </span>
          {onDelete && (
            <TrashButton onClick={handleDeleteClick} title="Delete">
              <i className="pi pi-trash" />
            </TrashButton>
          )}
        </div>
      }
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
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </InputGroup>

        {isMfj && (
          <InputGroup>
            <label>Recipient</label>
            <Dropdown
              value={formData.owner}
              options={ownerOptions}
              onChange={(e) => setFormData({ ...formData, owner: e.value })}
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Pension Amount</label>
          <AmountRow>
            <InputNumber
              value={formData.displayAmount}
              onValueChange={(e) =>
                setFormData({ ...formData, displayAmount: e.value || 0 })
              }
              mode='currency'
              currency='USD'
              min={0}
              required
            />
            <Dropdown
              value={formData.amountPeriod}
              options={periodOptions}
              onChange={(e) => handlePeriodChange(e.value)}
            />
          </AmountRow>
          <CheckboxGroup>
            <Checkbox
              inputId='colaType'
              checked={formData.colaType === 'inflation_adjusted'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  colaType: e.checked ? 'inflation_adjusted' : 'fixed',
                })
              }
            />
            <label htmlFor='colaType'>Inflation adjusted</label>
          </CheckboxGroup>
          <HelpText>
            {formData.colaType === 'inflation_adjusted'
              ? "Amount in today's dollars — adjusted for inflation each year"
              : "Fixed nominal amount — purchasing power decreases over time"}
          </HelpText>
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

        <InputGroup>
          <label>Tax Status</label>
          <Dropdown
            value={formData.taxStatus}
            options={taxStatusOptions}
            onChange={(e) => setFormData({ ...formData, taxStatus: e.value })}
          />
        </InputGroup>
      </Form>
    </Dialog>
  );
};

export default PensionIncomeDialog;
