import React, { useState } from 'react';
import styled from 'styled-components';
import SpendingGoalTypeSelectionDialog from '../dialogs/SpendingGoalTypeSelectionDialog';
import AddSpendingGoalDialog from '../dialogs/AddSpendingGoalDialog';
import type { SpendingGoal } from '../types/SpendingGoal';

const Container = styled.div`
  margin: 1rem 0;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
`;

const GoalItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border: 1px solid #ddd;
  margin-bottom: 0.5rem;
  border-radius: 4px;
`;

const GoalInfo = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const Button = styled.button`
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: #007bff;
  color: white;

  &:hover {
    background: #0056b3;
  }
`;

const LargeButton = styled(Button)`
  padding: 0.5rem 1rem;
  font-size: 1.1rem;
`;

const DeleteButton = styled(Button)`
  background: #dc3545;

  &:hover {
    background: #c82333;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const Input = styled.input`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
`;

const Select = styled.select`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
`;

const Checkbox = styled.input`
  margin-right: 0.5rem;
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
    startYear: new Date().getFullYear(),
    endYear: undefined as number | undefined,
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
      startYear: new Date().getFullYear(),
      endYear: undefined,
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
      startYear: goal.startYear,
      endYear: goal.endYear,
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
            placeholder='Start year'
            value={formData.startYear}
            onChange={(e) =>
              setFormData({ ...formData, startYear: Number(e.target.value) })
            }
            required
          />

          <Input
            type='number'
            placeholder='End year (optional)'
            value={formData.endYear || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                endYear: e.target.value ? Number(e.target.value) : undefined,
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
                  startYear: new Date().getFullYear(),
                  endYear: undefined,
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
        .sort((a, b) => a.startYear - b.startYear)
        .map((goal) => (
          <GoalItem key={goal.id}>
            <GoalInfo>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>
                  <span
                    style={{
                      marginRight: '0.5rem',
                      color: '#d2691e',
                      backgroundColor: 'rgba(210, 105, 30, 0.1)',
                      borderRadius: '50%',
                      padding: '0.25rem',
                      fontSize: '0.9rem',
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
              {goal.isOneTime ? ' one-time in ' : ' annually from '}
              {goal.startYear}
              {goal.endYear && !goal.isOneTime && ` to ${goal.endYear}`}
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
