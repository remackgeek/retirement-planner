import React, { useState } from 'react';
import styled from 'styled-components';
import SpendingGoalTypeSelectionDialog from '../dialogs/SpendingGoalTypeSelectionDialog';
import SpendingGoalDialog from '../dialogs/SpendingGoalDialog';
import HomePurchaseDialog from '../dialogs/HomePurchaseDialog';
import type { SpendingGoal } from '../types/SpendingGoal';
import { colors, fontSize } from '../styles/theme';
import { goalTypeIcons } from '../utils/defaultName';
import { ManagerRow, SlatList, AddButton, Header, HeaderLeft } from './ManagerRow';

const Container = styled.div``;

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
        <HeaderLeft>
          <h3>Spending</h3>
          <div style={{ fontSize: fontSize.sm, visibility: 'hidden' }}>&nbsp;</div>
        </HeaderLeft>
        <AddButton onClick={() => setSelectionDialogVisible(true)}>Add</AddButton>
      </Header>

      <SlatList>
        {[...goals]
          .sort((a, b) => a.startAge - b.startAge)
          .map((goal) => (
            <ManagerRow
              key={goal.id}
              icon={<i className={goalTypeIcons[goal.type]} />}
              iconBg={colors.spendingBg}
              iconColor={colors.spending}
              name={goal.name}
              secondary={
                goal.type === 'home_purchase' ? (
                  <>
                    ${goal.amount.toLocaleString()}{' '}
                    {goal.amountType === 'down_payment' ? 'down payment' : 'full purchase'}{' '}
                    at age {goal.startAge}
                    {goal.inflationAdjusted && " (today's dollars)"}
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
                )
              }
              onEdit={() => startEdit(goal)}
              onDelete={() => onDelete(goal.id)}
            />
          ))}
      </SlatList>

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
