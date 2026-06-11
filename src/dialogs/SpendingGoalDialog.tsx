import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import type { SpendingGoal } from '../types/SpendingGoal';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, dialogWidth } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, spendingGoalAgeRanges } from '../utils/ageOptions';
import {
  FormFullWidth as Form,
  InputGroupPlain as InputGroup,
  FieldRowGrid as FieldRow,
  AmountRow,
  CheckboxGroup,
  TrashButton,
} from './SettingsDialogPrimitives';

interface SpendingGoalDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (goal: Omit<SpendingGoal, 'id'>) => void;
  onDelete?: () => void;
  initialType?: SpendingGoal['type'];
  editGoal?: SpendingGoal;
  existingGoals?: SpendingGoal[];
  currentAge: number;
  referenceYear: number;
}

import { goalTypeLabels, goalTypeIcons, generateDefaultSpendingGoalName } from '../utils/defaultName';

const periodOptions = [
  { label: 'Monthly', value: 'monthly' as const },
  { label: 'Annual', value: 'annual' as const },
];

const makeDefaultFormData = (type: SpendingGoal['type'] = 'charity') => ({
  type,
  name: '',
  displayAmount: 0,
  amountPeriod: (type === 'living_expenses' ? 'monthly' : 'annual') as 'monthly' | 'annual',
  startAge: 65,
  endAge: undefined as number | undefined,
  isOneTime: false,
  inflationAdjusted: true,
  yearlyDecreasePercent: undefined as number | undefined,
});

const SpendingGoalDialog: React.FC<SpendingGoalDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  initialType,
  editGoal,
  existingGoals = [],
  currentAge,
  referenceYear,
}) => {
  const isEditing = !!editGoal;
  const [formData, setFormData] = useState(makeDefaultFormData());

  const range = spendingGoalAgeRanges[formData.type];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = Math.max(range.min, formData.startAge + 1);
  const startAgeOptions = buildAgeOptions(referenceYear, currentAge, effectiveMin, range.max);
  const endAgeOptions = buildEndAgeOptions(referenceYear, currentAge, effectiveEndMin, range.max);

  useEffect(() => {
    if (!visible) return;
    if (editGoal) {
      const period = editGoal.amountPeriod ?? (editGoal.type === 'living_expenses' ? 'monthly' : 'annual');
      const displayAmount = period === 'monthly' ? editGoal.amount / 12 : editGoal.amount;
      setFormData({
        type: editGoal.type,
        name: editGoal.name,
        displayAmount,
        amountPeriod: period,
        startAge: editGoal.startAge,
        endAge: editGoal.endAge,
        isOneTime: editGoal.isOneTime || false,
        inflationAdjusted: editGoal.inflationAdjusted,
        yearlyDecreasePercent: editGoal.yearlyDecreasePercent,
      });
    } else if (initialType) {
      const defaults = makeDefaultFormData(initialType);
      defaults.name = generateDefaultSpendingGoalName(initialType, existingGoals);
      defaults.startAge = currentAge;
      setFormData(defaults);
    } else {
      setFormData(makeDefaultFormData());
    }
  }, [visible, editGoal, initialType, existingGoals, currentAge]);

  const isLivingExpenses = formData.type === 'living_expenses';

  const handlePeriodChange = (newPeriod: 'monthly' | 'annual') => {
    if (newPeriod === formData.amountPeriod) return;
    const converted = newPeriod === 'monthly'
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
    const amount = formData.amountPeriod === 'monthly'
      ? formData.displayAmount * 12
      : formData.displayAmount;
    const { displayAmount: _displayAmount, amountPeriod, yearlyDecreasePercent, ...rest } = formData;
    const saveData: Omit<SpendingGoal, 'id'> = {
      ...rest,
      amount,
      ...(isLivingExpenses ? { amountPeriod } : {}),
      ...(yearlyDecreasePercent !== undefined ? { yearlyDecreasePercent } : {}),
    };
    onSave(saveData);
    onHide();
  };

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
        <i className={goalTypeIcons[formData.type]} style={{ marginRight: spacing.sm, color: colors.primary }} />
        {isEditing ? `Edit ${goalTypeLabels[formData.type]}` : `Add ${goalTypeLabels[formData.type]}`}
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
        label={isEditing ? 'Save Changes' : 'Add Goal'}
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
          <label>{isLivingExpenses ? 'Amount' : 'Annual Amount'}</label>
          {isLivingExpenses ? (
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
          ) : (
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
          )}
        </InputGroup>

        {isLivingExpenses && (
          <InputGroup>
            <label>Yearly Spending Decrease (%)</label>
            <InputNumber
              value={formData.yearlyDecreasePercent ?? null}
              onValueChange={(e) =>
                setFormData({
                  ...formData,
                  yearlyDecreasePercent: e.value ?? undefined,
                })
              }
              mode='decimal'
              min={0}
              max={10}
              suffix='%'
              placeholder='Optional — reduces spending each year after inflation'
            />
          </InputGroup>
        )}

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

        <CheckboxGroup>
          <Checkbox
            inputId='inflationAdjusted'
            checked={formData.inflationAdjusted}
            onChange={(e) =>
              setFormData({
                ...formData,
                inflationAdjusted: e.checked ?? true,
              })
            }
          />
          <label htmlFor='inflationAdjusted'>Inflation adjusted</label>
        </CheckboxGroup>
      </Form>
    </Dialog>
  );
};

export default SpendingGoalDialog;
