import React, { useState } from 'react';
import styled from 'styled-components';
import SpendingGoalTypeSelectionDialog from '../dialogs/SpendingGoalTypeSelectionDialog';
import SpendingGoalDialog from '../dialogs/SpendingGoalDialog';
import HomePurchaseDialog from '../dialogs/HomePurchaseDialog';
import type { SpendingGoal } from '../types/SpendingGoal';
import { spacing, colors, border, fontSize } from '../styles/theme';

const Container = styled.div``;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${spacing.sm};
  h3 {
    margin: 0;
  }
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
  gap: ${spacing.xs};
`;

const Button = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.sm};

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

const goalTypeIcons: Record<SpendingGoal['type'], string> = {
  living_expenses: 'pi pi-dollar',
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

interface SpendingGoalsManagerProps {
  goals: SpendingGoal[];
  userData: any;
  onAdd: (goal: Omit<SpendingGoal, 'id'>) => void;
  onUpdate: (id: string, goal: Partial<SpendingGoal>) => void;
  onDelete: (id: string) => void;
}

export const SpendingGoalsManager: React.FC<SpendingGoalsManagerProps> = ({
  goals,
  userData,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [selectionDialogVisible, setSelectionDialogVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<SpendingGoal['type'] | null>(null);
  const [editingGoal, setEditingGoal] = useState<SpendingGoal | undefined>(undefined);

  const handleTypeSelect = (type: SpendingGoal['type']) => {
    setSelectedType(type);
    setEditingGoal(undefined);
    setDialogVisible(true);
  };

  const handleSave = (goal: Omit<SpendingGoal, 'id'>) => {
    if (editingGoal) {
      onUpdate(editingGoal.id, goal);
    } else {
      onAdd(goal);
    }
    setDialogVisible(false);
    setSelectedType(null);
    setEditingGoal(undefined);
  };

  const startEdit = (goal: SpendingGoal) => {
    setEditingGoal(goal);
    setSelectedType(null);
    setDialogVisible(true);
  };

  return (
    <Container>
      <Header>
        <h3>Spending Goals</h3>
        <LargeButton onClick={() => setSelectionDialogVisible(true)}>
          Add Goal
        </LargeButton>
      </Header>

      {[...goals]
        .sort((a, b) => a.startAge - b.startAge)
        .map((goal) => (
          <GoalItem key={goal.id}>
            <GoalInfo>
              <div style={{ marginBottom: spacing.xs }}>
                <strong>
                  <span
                    style={{
                      marginRight: spacing.xs,
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
                  {goal.name}
                </strong>
              </div>
              {goal.type === 'home_purchase' ? (
                <>
                  ${goal.amount.toLocaleString()}{' '}
                  {goal.amountType === 'down_payment' ? 'down payment' : 'full purchase'}{' '}
                  at age {goal.startAge}
                  {goal.inflationAdjusted && ' (today\'s dollars)'}
                </>
              ) : goal.type === 'living_expenses' ? (
                <>
                  {(goal.amountPeriod ?? 'monthly') === 'monthly'
                    ? `$${Math.round(goal.amount / 12).toLocaleString()}/mo`
                    : `$${goal.amount.toLocaleString()}/yr`}
                  {' '}starting at age {goal.startAge}
                  {goal.endAge && ` until age ${goal.endAge}`}
                  {goal.inflationAdjusted && ' (inflation adjusted)'}
                  {goal.yearlyDecreasePercent != null && goal.yearlyDecreasePercent > 0 && ` (-${goal.yearlyDecreasePercent}%/yr)`}
                </>
              ) : (
                <>
                  ${goal.amount.toLocaleString()}
                  {goal.isOneTime
                    ? ' one-time at age '
                    : ' annually starting at age '}
                  {goal.startAge}
                  {goal.endAge && !goal.isOneTime && ` until age ${goal.endAge}`}
                  {goal.isOneTime && ' (one-time event)'}
                  {goal.inflationAdjusted && ' (inflation adjusted)'}
                </>
              )}
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

      {editingGoal?.type === 'home_purchase' || selectedType === 'home_purchase' ? (
        <HomePurchaseDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingGoal(undefined);
          }}
          onSave={handleSave}
          editGoal={editingGoal?.type === 'home_purchase' ? editingGoal : undefined}
          existingGoals={goals}
          currentAge={userData.currentAge}
          referenceYear={userData.referenceYear}
        />
      ) : (
        <SpendingGoalDialog
          visible={dialogVisible}
          onHide={() => {
            setDialogVisible(false);
            setSelectedType(null);
            setEditingGoal(undefined);
          }}
          onSave={handleSave}
          initialType={selectedType || undefined}
          editGoal={editingGoal}
          existingGoals={goals}
          currentAge={userData.currentAge}
          referenceYear={userData.referenceYear}
        />
      )}
    </Container>
  );
};
