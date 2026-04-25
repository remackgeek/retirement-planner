import React, { useState } from 'react';
import styled from 'styled-components';
import SpendingGoalTypeSelectionDialog from '../dialogs/SpendingGoalTypeSelectionDialog';
import SpendingGoalDialog from '../dialogs/SpendingGoalDialog';
import HomePurchaseDialog from '../dialogs/HomePurchaseDialog';
import type { SpendingGoal } from '../types/SpendingGoal';
import { colors, fontSize } from '../styles/theme';
import { goalTypeIcons } from '../utils/defaultName';
import { ManagerRow, RightAmount, RightLabel, SlatList, AddButton, Header, HeaderLeft } from './ManagerRow';

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
                    <div>
                      {goal.amountType === 'down_payment' ? 'Down payment' : 'Full purchase'} at age {goal.startAge}
                    </div>
                    {goal.inflationAdjusted && <div>Today's dollars</div>}
                  </>
                ) : goal.type === 'living_expenses' ? (
                  <>
                    <div>
                      Age {goal.startAge}{goal.endAge && `–${goal.endAge}`}
                    </div>
                    {(goal.inflationAdjusted || (goal.yearlyDecreasePercent ?? 0) > 0) && (
                      <div>
                        {[
                          goal.inflationAdjusted && 'Inflation adjusted',
                          (goal.yearlyDecreasePercent ?? 0) > 0 && `-${goal.yearlyDecreasePercent}%/yr`,
                        ].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      Age {goal.startAge}{goal.endAge && !goal.isOneTime && `–${goal.endAge}`}
                    </div>
                    {goal.inflationAdjusted && <div>Inflation adjusted</div>}
                  </>
                )
              }
              right={
                goal.type === 'home_purchase' ? (
                  <>
                    <RightAmount>${goal.amount.toLocaleString()}</RightAmount>
                    <RightLabel>one-time</RightLabel>
                  </>
                ) : goal.type === 'living_expenses' ? (
                  <>
                    <RightAmount>
                      ${(goal.amountPeriod ?? 'monthly') === 'monthly'
                        ? Math.round(goal.amount / 12).toLocaleString()
                        : goal.amount.toLocaleString()}
                    </RightAmount>
                    <RightLabel>{(goal.amountPeriod ?? 'monthly') === 'monthly' ? 'monthly' : 'annual'}</RightLabel>
                  </>
                ) : (
                  <>
                    <RightAmount>${goal.amount.toLocaleString()}</RightAmount>
                    <RightLabel>{goal.isOneTime ? 'one-time' : 'annual'}</RightLabel>
                  </>
                )
              }
              onEdit={() => startEdit(goal)}
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
          onDelete={editingGoal ? () => { onDelete(editingGoal.id); setDialogVisible(false); setSelectedType(null); setEditingGoal(undefined); } : undefined}
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
          onDelete={editingGoal ? () => { onDelete(editingGoal.id); setDialogVisible(false); setSelectedType(null); setEditingGoal(undefined); } : undefined}
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
