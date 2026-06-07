import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import type { SpendingGoal } from '../types/SpendingGoal';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import { buildAgeOptions, spendingGoalAgeRanges } from '../utils/ageOptions';
import { generateDefaultSpendingGoalName, goalTypeIcons } from '../utils/defaultName';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-inputtext,
  .p-inputnumber,
  .p-dropdown {
    width: 100%;
  }
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const RadioGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const RadioOption = styled.label`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.sm};
  cursor: pointer;
  font-size: ${fontSize.base};
`;

const RadioDescription = styled.span`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
  display: block;
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

interface HomePurchaseDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (goal: Omit<SpendingGoal, 'id'>) => void;
  onDelete?: () => void;
  editGoal?: SpendingGoal;
  existingGoals?: SpendingGoal[];
  currentAge: number;
  referenceYear: number;
}

const makeDefaultFormData = () => ({
  name: '',
  amount: 0,
  startAge: 65,
  amountType: 'full_price' as 'full_price' | 'down_payment',
  inflationAdjusted: true,
});

const HomePurchaseDialog: React.FC<HomePurchaseDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  editGoal,
  existingGoals = [],
  currentAge,
  referenceYear,
}) => {
  const isEditing = !!editGoal;
  const [formData, setFormData] = useState(makeDefaultFormData());

  useEffect(() => {
    if (!visible) return;
    if (editGoal) {
      setFormData({
        name: editGoal.name,
        amount: editGoal.amount,
        startAge: editGoal.startAge,
        amountType: editGoal.amountType ?? 'full_price',
        inflationAdjusted: editGoal.inflationAdjusted,
      });
    } else {
      setFormData({
        ...makeDefaultFormData(),
        startAge: currentAge,
        name: generateDefaultSpendingGoalName('home_purchase', existingGoals),
      });
    }
  }, [visible, editGoal, existingGoals, currentAge]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      type: 'home_purchase',
      name: formData.name,
      amount: formData.amount,
      startAge: formData.startAge,
      isOneTime: true,
      inflationAdjusted: formData.inflationAdjusted,
      amountType: formData.amountType,
    });
    onHide();
  };

  const amountLabel =
    formData.amountType === 'down_payment' ? 'Down Payment' : 'Purchase Price';

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
            <i className={goalTypeIcons['home_purchase']} style={{ marginRight: spacing.sm, color: colors.primary }} />
            {isEditing ? 'Edit Home Purchase' : 'Add Home Purchase'}
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

        <InputGroup>
          <label>Purchase Age</label>
          <Dropdown
            value={formData.startAge}
            options={buildAgeOptions(
              referenceYear,
              currentAge,
              Math.min(spendingGoalAgeRanges.home_purchase.min, formData.startAge),
              spendingGoalAgeRanges.home_purchase.max,
            )}
            onChange={(e) =>
              setFormData({ ...formData, startAge: e.value })
            }
          />
        </InputGroup>

        <InputGroup>
          <label>Amount Type</label>
          <RadioGroup>
            <RadioOption>
              <input
                type='radio'
                name='amountType'
                value='full_price'
                checked={formData.amountType === 'full_price'}
                onChange={() =>
                  setFormData({ ...formData, amountType: 'full_price' })
                }
              />
              <span>
                Full purchase price
                <RadioDescription>Paying cash — full cost withdrawn from portfolio</RadioDescription>
              </span>
            </RadioOption>
            <RadioOption>
              <input
                type='radio'
                name='amountType'
                value='down_payment'
                checked={formData.amountType === 'down_payment'}
                onChange={() =>
                  setFormData({ ...formData, amountType: 'down_payment' })
                }
              />
              <span>
                Down payment only
                <RadioDescription>Financed — only the down payment is withdrawn</RadioDescription>
              </span>
            </RadioOption>
          </RadioGroup>
        </InputGroup>

        <InputGroup>
          <label>{amountLabel}</label>
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

        <InputGroup>
          <label>Dollar Basis</label>
          <RadioGroup>
            <RadioOption>
              <input
                type='radio'
                name='dollarBasis'
                checked={formData.inflationAdjusted}
                onChange={() =>
                  setFormData({ ...formData, inflationAdjusted: true })
                }
              />
              <span>
                Today's dollars
                <RadioDescription>Enter current market value — will be inflated to purchase year</RadioDescription>
              </span>
            </RadioOption>
            <RadioOption>
              <input
                type='radio'
                name='dollarBasis'
                checked={!formData.inflationAdjusted}
                onChange={() =>
                  setFormData({ ...formData, inflationAdjusted: false })
                }
              />
              <span>
                Future dollars
                <RadioDescription>Enter the price you expect to pay at purchase age</RadioDescription>
              </span>
            </RadioOption>
          </RadioGroup>
        </InputGroup>
      </Form>
    </Dialog>
  );
};

export default HomePurchaseDialog;
