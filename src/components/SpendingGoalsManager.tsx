import React, { useState } from 'react';
import styled from 'styled-components';
import SpendingGoalTypeSelectionDialog from '../dialogs/SpendingGoalTypeSelectionDialog';
import AddSpendingGoalDialog from '../dialogs/AddSpendingGoalDialog';
import type { SpendingGoal } from '../types/SpendingGoal';
import { spacing, colors, border, fontSize } from '../styles/theme';

const Container = styled.div`
  margin: ${spacing.sm} 0;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${spacing.sm};
`;

const GoalItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${spacing.sm};
  border: ${border.standard};
  margin-bottom: ${spacing.sm};
  border-radius: ${border.radius};
`;

const GoalInfo = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: ${spacing.sm};
`;

const Button = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;

  &:hover {
    background: ${colors.primaryHover};
  }
`;

const LargeButton = styled(Button)`
  padding: ${spacing.sm} ${spacing.lg};
  font-size: ${fontSize.xl};
`;

const DeleteButton = styled(Button)`
  background: ${colors.danger};

  &:hover {
    background: ${colors.dangerHover};
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  padding: ${spacing.md};
  border: ${border.standard};
  border-radius: ${border.radius};
  margin-bottom: ${spacing.sm};
`;

const Input = styled.input`
  padding: ${spacing.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
`;

const Select = styled.select`
  padding: ${spacing.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
`;

const Checkbox = styled.input`
  margin-right: ${spacing.sm};
`;

interface SpendingGoalsManagerProps {
  goals: SpendingGoal[];
  onAdd: (goal: Omit<SpendingGoal, 'id'>) => void;
  onUpdate: (id: string, goal: Partial<SpendingGoal>) => void;
  onDelete: (id: string) => void;
}

export const SpendingGoalsManager: React.FC<SpendingGoalsManagerProps> = ({
  goals,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [selectionDialogVisible, setSelectionDialogVisible] = useState(false);
  const [addDialogVisible, setAddDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<SpendingGoal['type'] | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'charity' as SpendingGoal['type'],
    name: '',
    amount: 0,
    startAge: 65,
    endAge: undefined as number | undefined,
    isOneTime: false,
    inflationAdjusted: true,
  });

  const handleTypeSelect = (type: SpendingGoal['type']) => {
    setSelectedType(type);
    setAddDialogVisible(true);
  };

  const handleAddGoal = (goal: Omit<SpendingGoal, 'id'>) => {
    onAdd(goal);
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
      type: 'charity',
      name: '',
      amount: 0,
      startAge: 65,
      endAge: undefined,
      isOneTime: false,
      inflationAdjusted: true,
    });
  };

  const startEdit = (goal: SpendingGoal) => {
    setEditingId(goal.id);
    setFormData({
      type: goal.type,
      name: goal.name || '',
      amount: goal.amount,
      startAge: goal.startAge,
      endAge: goal.endAge,
      isOneTime: goal.isOneTime || false,
      inflationAdjusted: goal.inflationAdjusted,
    });
  };

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

  const goalTypeIcons: Record<SpendingGoal['type'], string> = {
    monthly_retirement: 'pi pi-dollar',
    charity: 'pi pi-heart',
    dependent_support: 'pi pi-users',
    healthcare: 'pi pi-heart-fill',
    home_purchase: 'pi pi-home',
    education: 'pi pi-book',
    renovation: 'pi pi-wrench',
    vacation: 'pi pi-plane',
    vehicle: 'pi pi-car',
    wedding: 'pi pi-heart',
    other: 'pi pi-circle',
  };

  return (
    <Container>
      <Header>
        <h3>Spending Goals</h3>
        {!editingId && (
          <LargeButton onClick={() => setSelectionDialogVisible(true)}>
            Add Goal
          </LargeButton>
        )}
      </Header>

      {editingId && (
        <Form onSubmit={handleSubmit}>
          <Select
            value={formData.type}
            onChange={(e) =>
              setFormData({
                ...formData,
                type: e.target.value as SpendingGoal['type'],
              })
            }
          >
            {Object.entries(goalTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          {formData.type === 'other' && (
            <Input
              type='text'
              placeholder='Goal name'
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
            value={formData.endAge ?? ''}
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

          <label>
            <Checkbox
              type='checkbox'
              checked={formData.inflationAdjusted}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  inflationAdjusted: e.target.checked,
                })
              }
            />
            Inflation adjusted
          </label>

          <div>
            <Button type='submit'>{editingId ? 'Update' : 'Add'} Goal</Button>
            <Button
              type='button'
              onClick={() => {
                setEditingId(null);
                setFormData({
                  type: 'charity',
                  name: '',
                  amount: 0,
                  startAge: 65,
                  endAge: undefined,
                  isOneTime: false,
                  inflationAdjusted: true,
                });
              }}
            >
              Cancel
            </Button>
          </div>
        </Form>
      )}

      {[...goals]
        .sort((a, b) => a.startAge - b.startAge)
        .map((goal) => (
          <GoalItem key={goal.id}>
            <GoalInfo>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>
                  <span
                    style={{
                      marginRight: '0.5rem',
                      color: colors.spending,
                      backgroundColor: colors.spendingBg,
                      borderRadius: border.radiusCircle,
                      padding: spacing.xs,
                      fontSize: fontSize.md,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.5rem',
                      height: '1.5rem',
                      fontWeight: 'bold',
                    }}
                  >
                    <i className={goalTypeIcons[goal.type]} />
                  </span>
                  {goalTypeLabels[goal.type]}
                  {goal.name && ` - ${goal.name}`}
                </strong>
              </div>
              ${goal.amount.toLocaleString()}
              {goal.isOneTime
                ? ' one-time at age '
                : ' annually starting at age '}
              {goal.startAge}
              {goal.endAge && !goal.isOneTime && ` until age ${goal.endAge}`}
              {goal.isOneTime && ' (one-time event)'}
              {goal.inflationAdjusted && ' (inflation adjusted)'}
            </GoalInfo>
            <Actions>
              <Button onClick={() => startEdit(goal)}>Edit</Button>
              <DeleteButton onClick={() => onDelete(goal.id)}>
                Delete
              </DeleteButton>
            </Actions>
          </GoalItem>
        ))}

      <SpendingGoalTypeSelectionDialog
        visible={selectionDialogVisible}
        onHide={() => setSelectionDialogVisible(false)}
        onSelectType={handleTypeSelect}
      />

      <AddSpendingGoalDialog
        visible={addDialogVisible}
        onHide={() => {
          setAddDialogVisible(false);
          setSelectedType(null);
        }}
        onSave={handleAddGoal}
        initialType={selectedType || undefined}
      />
    </Container>
  );
};
