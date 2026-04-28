import { useContext, useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ProgressSpinner } from 'primereact/progressspinner';
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
import { spacing, colors, border, layout, fontSize } from '../../styles/theme';

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

const SpinnerContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 300px;
  gap: ${spacing.md};
`;

const SpinnerLabel = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const Content: React.FC<{ compareScenarioId?: string | null; onSetCompare: (id: string | null) => void }> = ({ compareScenarioId, onSetCompare }) => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario, updateScenario, scenarios } = context;
  const compareScenario = compareScenarioId
    ? (scenarios.find(s => s.id === compareScenarioId) ?? null)
    : null;
  const [results, setResults] = useState<any>(null);
  const [compareResults, setCompareResults] = useState<{ scenarioId: string; results: any } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  // Loading state derived synchronously from id mismatch — avoids one-frame flash of
  // "End comparison" before useEffect fires.
  const currentCompareResults =
    compareResults && compareScenario && compareResults.scenarioId === compareScenario.id
      ? compareResults.results
      : null;
  const isCompareCalculating = !!compareScenario && !currentCompareResults;
  const pendingRun = useRef<number | null>(null);
  // When we write the freshly-computed probability back to the active scenario
  // (sidebar display cache), the resulting activeScenario reference change would
  // re-fire this effect and run MC again. Skip exactly one run after a write-back.
  const skipNextSim = useRef(false);

  // Debounce simulation so rapid edits (each keystroke updates activeScenario)
  // don't fire a full Monte Carlo every time. Keep the previous results visible
  // while a new run is pending to avoid chart flicker.
  useEffect(() => {
    if (!activeScenario) {
      setResults(null);
      setIsCalculating(false);
      return;
    }
    if (skipNextSim.current) {
      skipNextSim.current = false;
      return;
    }
    setIsCalculating(true);
    if (pendingRun.current != null) window.clearTimeout(pendingRun.current);
    pendingRun.current = window.setTimeout(() => {
      clearTaxCalculationCache();
      const result = runSimulation(activeScenario);
      setResults(result);
      setIsCalculating(false);
      pendingRun.current = null;
      if (result.probability !== activeScenario.lastSuccessProbability) {
        skipNextSim.current = true;
        updateScenario({ ...activeScenario, lastSuccessProbability: result.probability });
      }
    }, 250);
    return () => {
      if (pendingRun.current != null) {
        window.clearTimeout(pendingRun.current);
        pendingRun.current = null;
      }
    };
  }, [activeScenario]);

  useEffect(() => {
    onSetCompare(null);
  }, [activeScenario?.id]);

  useEffect(() => {
    if (!compareScenario) {
      setCompareResults(null);
      return;
    }
    const id = setTimeout(() => {
      setCompareResults({
        scenarioId: compareScenario.id,
        results: runSimulation(compareScenario),
      });
    }, 0);
    return () => clearTimeout(id);
  }, [compareScenario?.id]);

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
        {!results && activeScenario && isCalculating && (
          <SpinnerContainer>
            <ProgressSpinner style={{ width: '48px', height: '48px' }} />
            <SpinnerLabel>Running Monte Carlo simulation…</SpinnerLabel>
          </SpinnerContainer>
        )}
        {results && activeScenario && (
          <Projections
            results={results}
            userData={activeScenario}
            isCalculating={isCalculating}
            compareResults={currentCompareResults}
            compareScenario={compareScenario}
            isCompareCalculating={isCompareCalculating}
            onSetCompare={onSetCompare}
          />
        )}
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
