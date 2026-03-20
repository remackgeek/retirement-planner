import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Checkbox } from 'primereact/checkbox';
import type { SpendingGoal } from '../types/SpendingGoal';
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

interface SpendingGoalDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (goal: Omit<SpendingGoal, 'id'>) => void;
  initialType?: SpendingGoal['type'];
  editGoal?: SpendingGoal;
  existingGoals?: SpendingGoal[];
}

import { goalTypeLabels, generateDefaultSpendingGoalName } from '../utils/defaultName';

const makeDefaultFormData = (type: SpendingGoal['type'] = 'charity') => ({
  type,
  name: '',
  amount: 0,
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
  initialType,
  editGoal,
  existingGoals = [],
}) => {
  const isEditing = !!editGoal;
  const [formData, setFormData] = useState(makeDefaultFormData());

  useEffect(() => {
    if (!visible) return;
    if (editGoal) {
      setFormData({
        type: editGoal.type,
        name: editGoal.name,
        amount: editGoal.amount,
        startAge: editGoal.startAge,
        endAge: editGoal.endAge,
        isOneTime: editGoal.isOneTime || false,
        inflationAdjusted: editGoal.inflationAdjusted,
        yearlyDecreasePercent: editGoal.yearlyDecreasePercent,
      });
    } else if (initialType) {
      const defaults = makeDefaultFormData(initialType);
      defaults.name = generateDefaultSpendingGoalName(initialType, existingGoals);
      setFormData(defaults);
    } else {
      setFormData(makeDefaultFormData());
    }
  }, [visible, editGoal, initialType, existingGoals]);

  const isMonthlyRetirement = formData.type === 'monthly_retirement';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const saveData = { ...formData };
    if (!saveData.yearlyDecreasePercent) {
      delete (saveData as any).yearlyDecreasePercent;
    }
    onSave(saveData);
    onHide();
  };

  const headerLabel = isEditing
    ? `Edit ${goalTypeLabels[formData.type]}`
    : `Add ${goalTypeLabels[formData.type]}`;

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
          <label>{isMonthlyRetirement ? 'Monthly Amount' : 'Annual Amount'}</label>
          <InputNumber
            value={isMonthlyRetirement ? formData.amount / 12 : formData.amount}
            onValueChange={(e) =>
              setFormData({
                ...formData,
                amount: isMonthlyRetirement ? (e.value || 0) * 12 : (e.value || 0),
              })
            }
            mode='currency'
            currency='USD'
            required
          />
        </InputGroup>

        {isMonthlyRetirement && (
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
