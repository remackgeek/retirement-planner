import { useContext, useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { runSimulation } from '../../services/SimulationService';
import { clearTaxCalculationCache } from '../../services/TaxCalculator';
import Projections from '../Chart/Chart';
import { SpendingGoalsManager } from '../SpendingGoalsManager';
import { IncomeEventsManager } from '../IncomeEventsManager';
import { AccountsManager } from '../AccountsManager';
import type { SpendingGoal } from '../../types/SpendingGoal';
import type { IncomeEvent } from '../../types/IncomeEvent';
import type { Account } from '../../types/Account';
import { spacing, colors, border, layout } from '../../styles/theme';

const ContentContainer = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ContentBody = styled.div`
  flex: 1;
  padding: ${spacing.lg} ${spacing.xl};
  overflow-y: auto;
`;

const ManagersContainer = styled.div`
  container-type: inline-size;
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.xl};
  margin-top: ${spacing.lg};
  margin-bottom: ${spacing.sm};
`;

const ManagerSection = styled.div`
  flex: 1 1 ${layout.managerMinWidth};
  min-width: 0;
  background: ${colors.bgLight};
  border: ${border.standard};
  border-radius: ${border.radiusRound};
  padding: ${spacing.md};
`;

// Accounts wraps to row 2 when only 2 columns fit (< 3×280px + 2 gaps ≈ 880px).
// Income and Spending stay together on row 1 — they're more likely to be reviewed
// side-by-side; Accounts is secondary context.
const AccountsManagerSection = styled(ManagerSection)`
  @container (max-width: 879px) {
    order: 3;
  }
`;

const Content: React.FC = () => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario, updateScenario } = context;
  const [results, setResults] = useState<any>(null);
  const pendingRun = useRef<number | null>(null);

  // Debounce simulation so rapid edits (each keystroke updates activeScenario)
  // don't fire a full Monte Carlo every time. Keep the previous results visible
  // while a new run is pending to avoid chart flicker.
  useEffect(() => {
    if (!activeScenario) {
      setResults(null);
      return;
    }
    if (pendingRun.current != null) window.clearTimeout(pendingRun.current);
    pendingRun.current = window.setTimeout(() => {
      clearTaxCalculationCache();
      setResults(runSimulation(activeScenario));
      pendingRun.current = null;
    }, 250);
    return () => {
      if (pendingRun.current != null) {
        window.clearTimeout(pendingRun.current);
        pendingRun.current = null;
      }
    };
  }, [activeScenario]);

  const handleAddSpendingGoal = (goal: Omit<SpendingGoal, 'id'>) => {
    if (!activeScenario) return;
    const newGoal: SpendingGoal = { ...goal, id: crypto.randomUUID() };
    const updatedScenario = {
      ...activeScenario,
      spendingGoals: [...activeScenario.spendingGoals, newGoal],
    };
    updateScenario(updatedScenario);
  };

  const handleUpdateSpendingGoal = (
    id: string,
    updates: Partial<SpendingGoal>
  ) => {
    if (!activeScenario) return;
    const updatedGoals = activeScenario.spendingGoals.map((goal) =>
      goal.id === id ? { ...goal, ...updates } : goal
    );
    const updatedScenario = { ...activeScenario, spendingGoals: updatedGoals };
    updateScenario(updatedScenario);
  };

  const handleDeleteSpendingGoal = (id: string) => {
    if (!activeScenario) return;
    const updatedGoals = activeScenario.spendingGoals.filter(
      (goal) => goal.id !== id
    );
    const updatedScenario = { ...activeScenario, spendingGoals: updatedGoals };
    updateScenario(updatedScenario);
  };

  const handleAddIncomeEvent = (event: Omit<IncomeEvent, 'id'>) => {
    if (!activeScenario) return;
    const newEvent: IncomeEvent = { ...event, id: crypto.randomUUID() };
    const updatedScenario = {
      ...activeScenario,
      incomeEvents: [...activeScenario.incomeEvents, newEvent],
    };
    updateScenario(updatedScenario);
  };

  const handleUpdateIncomeEvent = (
    id: string,
    updates: Partial<IncomeEvent>
  ) => {
    if (!activeScenario) return;
    const updatedEvents = activeScenario.incomeEvents.map((event) =>
      event.id === id ? { ...event, ...updates } : event
    );
    const updatedScenario = { ...activeScenario, incomeEvents: updatedEvents };
    updateScenario(updatedScenario);
  };

  const handleDeleteIncomeEvent = (id: string) => {
    if (!activeScenario) return;
    const updatedEvents = activeScenario.incomeEvents.filter(
      (event) => event.id !== id
    );
    const updatedScenario = { ...activeScenario, incomeEvents: updatedEvents };
    updateScenario(updatedScenario);
  };

  const handleAddAccount = (account: Omit<Account, 'id'>) => {
    if (!activeScenario) return;
    const newAccount: Account = { ...account, id: crypto.randomUUID() };
    const updatedScenario = {
      ...activeScenario,
      accounts: [...activeScenario.accounts, newAccount],
    };
    updateScenario(updatedScenario);
  };

  const handleUpdateAccount = (id: string, updates: Partial<Account>) => {
    if (!activeScenario) return;
    const updatedAccounts = activeScenario.accounts.map((acct) =>
      acct.id === id ? { ...acct, ...updates } : acct
    );
    const updatedScenario = { ...activeScenario, accounts: updatedAccounts };
    updateScenario(updatedScenario);
  };

  const handleDeleteAccount = (id: string) => {
    if (!activeScenario) return;
    const updatedAccounts = activeScenario.accounts.filter((acct) => acct.id !== id);
    const updatedScenario = { ...activeScenario, accounts: updatedAccounts };
    updateScenario(updatedScenario);
  };

  return (
    <ContentContainer>
      <ContentBody>
        {!activeScenario && (
          <div style={{ color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
            No scenario selected. Create or import a scenario to get started.
          </div>
        )}
        {results && activeScenario && <Projections results={results} userData={activeScenario} />}
        {activeScenario && (
          <ManagersContainer>
            <AccountsManagerSection>
              <AccountsManager
                accounts={activeScenario.accounts}
                onAdd={handleAddAccount}
                onUpdate={handleUpdateAccount}
                onDelete={handleDeleteAccount}
                spouseAge={activeScenario.spouseAge}
              />
            </AccountsManagerSection>
            <ManagerSection>
              <IncomeEventsManager
                events={activeScenario.incomeEvents}
                userData={activeScenario}
                accounts={activeScenario.accounts}
                onAdd={handleAddIncomeEvent}
                onUpdate={handleUpdateIncomeEvent}
                onDelete={handleDeleteIncomeEvent}
              />
            </ManagerSection>
            <ManagerSection>
              <SpendingGoalsManager
                goals={activeScenario.spendingGoals}
                userData={activeScenario}
                onAdd={handleAddSpendingGoal}
                onUpdate={handleUpdateSpendingGoal}
                onDelete={handleDeleteSpendingGoal}
              />
            </ManagerSection>
          </ManagersContainer>
        )}
      </ContentBody>
    </ContentContainer>
  );
};

export default Content;
