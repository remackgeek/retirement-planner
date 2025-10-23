import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Checkbox } from 'primereact/checkbox';
import type { SpendingGoal } from '../types/SpendingGoal';

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

interface AddSpendingGoalDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (goal: Omit<SpendingGoal, 'id'>) => void;
  initialType?: SpendingGoal['type'];
}

const goalTypeLabels: Record<SpendingGoal['type'], string> = {
  monthly_retirement: 'Monthly Retirement',
  charity: 'Charity/Gift',
  dependent_support: 'Dependent Support',
  healthcare: 'Healthcare',
  home_purchase: 'Home Purchase/Upgrade',
  education: 'Education',
  renovation: 'Renovation',
  vacation: 'Vacation',
  vehicle: 'Vehicle',
  wedding: 'Wedding',
  other: 'Other Expense',
};

const AddSpendingGoalDialog: React.FC<AddSpendingGoalDialogProps> = ({
  visible,
  onHide,
  onSave,
  initialType,
}) => {
  const [formData, setFormData] = useState({
    type: 'charity' as SpendingGoal['type'],
    name: '',
    amount: 0,
    startYear: new Date().getFullYear(),
    endYear: undefined as number | undefined,
    isOneTime: false,
    inflationAdjusted: true,
  });

  // Reset form when dialog opens with initial type
  useEffect(() => {
    if (visible && initialType) {
      setFormData({
        type: initialType,
        name: '',
        amount: 0,
        startYear: new Date().getFullYear(),
        endYear: undefined,
        isOneTime: false,
        inflationAdjusted: true,
      });
    }
  }, [visible, initialType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onHide();
  };

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
      <Button
        label='Add Goal'
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  return (
    <Dialog
      header={`Add ${goalTypeLabels[formData.type]}`}
      visible={visible}
      style={{ width: '50vw' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={handleSubmit}>
        {formData.type === 'other' && (
          <InputGroup>
            <label>Goal Name</label>
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
          <label>Start Year</label>
          <InputNumber
            value={formData.startYear}
            onValueChange={(e) =>
              setFormData({
                ...formData,
                startYear: e.value || new Date().getFullYear(),
              })
            }
            required
          />
        </InputGroup>

        <InputGroup>
          <label>End Year (optional)</label>
          <InputNumber
            value={formData.endYear}
            onValueChange={(e) =>
              setFormData({ ...formData, endYear: e.value || undefined })
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

        <CheckboxGroup>
          <Checkbox
            checked={formData.inflationAdjusted}
            onChange={(e) =>
              setFormData({
                ...formData,
                inflationAdjusted: e.checked ?? true,
              })
            }
          />
          <label>Inflation adjusted</label>
        </CheckboxGroup>
      </Form>
    </Dialog>
  );
};

export default AddSpendingGoalDialog;
