import { useContext, useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ProgressSpinner } from 'primereact/progressspinner';
import { RetirementContext } from '../../context/RetirementContext';
import { runSimulation, runFastPreview } from '../../services/SimulationService';
import Projections from '../Chart/Chart';
import { SpendingGoalsManager } from '../SpendingGoalsManager';
import { IncomeEventsManager } from '../IncomeEventsManager';
import { AccountsManager } from '../AccountsManager';
import type { SpendingGoal } from '../../types/SpendingGoal';
import type { IncomeEvent } from '../../types/IncomeEvent';
import type { Account } from '../../types/Account';
import type { Scenario } from '../../types/Scenario';
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

const Content: React.FC<{
  compareScenarioId?: string | null;
  onSetCompare: (id: string | null) => void;
  onRegisterExport?: (fn: (() => void) | null) => void;
  whatIfSnapshot?: Scenario | null;
  whatIfActive?: boolean;
  compareDisabled?: boolean;
  onEnterWhatIf?: () => void;
  onDiscardWhatIf?: () => void;
  onSaveWhatIf?: () => void;
  onSaveWhatIfAsNew?: (name: string) => void;
}> = ({ compareScenarioId, onSetCompare, onRegisterExport, whatIfSnapshot, whatIfActive, compareDisabled, onEnterWhatIf, onDiscardWhatIf, onSaveWhatIf, onSaveWhatIfAsNew }) => {
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
  // Fingerprint of the last simulation-affecting scenario state. Lets us skip
  // re-running when a parent re-render produces a new activeScenario reference
  // without changing any sim input (e.g. renames, sidebar selection churn).
  // name and lastSuccessProbability are display-only — exclude them.
  const lastSimFingerprint = useRef<string | null>(null);

  // Debounce simulation so rapid edits (each keystroke updates activeScenario)
  // don't fire a full Monte Carlo every time. Keep the previous results visible
  // while a new run is pending to avoid chart flicker.
  useEffect(() => {
    if (!activeScenario) {
      setResults(null);
      setIsCalculating(false);
      lastSimFingerprint.current = null;
      return;
    }
    if (skipNextSim.current) {
      skipNextSim.current = false;
      return;
    }
    const { name: _n, lastSuccessProbability: _p, ...simInputs } = activeScenario;
    const fingerprint = `${activeScenario.id}|${JSON.stringify(simInputs)}`;
    if (fingerprint === lastSimFingerprint.current) return;
    lastSimFingerprint.current = fingerprint;
    // Phase 1: fast deterministic preview — paints the Projected line + events
    // immediately so the chart never goes blank when switching scenarios.
    // Historical modes (rolling / bootstrap) have no canonical deterministic
    // baseline and would just show 0s, so skip the preview there.
    const returnModel = activeScenario.portfolioAssumptions?.returnModel ?? 'parametric';
    const supportsFastPreview = returnModel !== 'historical_rolling' && returnModel !== 'historical_bootstrap';
    if (supportsFastPreview) {
      setResults(runFastPreview(activeScenario, activeScenario.lastSuccessProbability));
    }
    setIsCalculating(true);
    // Phase 2: debounced full Monte Carlo.
    if (pendingRun.current != null) window.clearTimeout(pendingRun.current);
    pendingRun.current = window.setTimeout(() => {
      const result = runSimulation(activeScenario);
      setResults(result);
      setIsCalculating(false);
      pendingRun.current = null;
      if (result.probability !== activeScenario.lastSuccessProbability) {
        skipNextSim.current = true;
        updateScenario({ ...activeScenario, lastSuccessProbability: result.probability });
      }
    }, 250);
    // No cleanup here. A cleanup that always cancels the timeout would race
    // with the fingerprint early-return above: a no-op re-render (same
    // sim-input content, new activeScenario reference) would clear the
    // pending sim and then early-return without rescheduling, leaving
    // isCalculating stuck at true. Unmount cleanup is below.
  }, [activeScenario]);

  // Unmount-only: clear any in-flight timeout so it doesn't fire post-unmount.
  useEffect(() => () => {
    if (pendingRun.current != null) {
      window.clearTimeout(pendingRun.current);
      pendingRun.current = null;
    }
  }, []);

  useEffect(() => {
    onSetCompare(null);
  }, [activeScenario?.id]);

  useEffect(() => {
    if (!compareScenario) {
      setCompareResults(null);
      return;
    }
    // Fast preview first so the compared line appears immediately.
    const returnModel = compareScenario.portfolioAssumptions?.returnModel ?? 'parametric';
    if (returnModel !== 'historical_rolling' && returnModel !== 'historical_bootstrap') {
      setCompareResults({
        scenarioId: compareScenario.id,
        results: runFastPreview(compareScenario, compareScenario.lastSuccessProbability),
      });
    }
    const id = setTimeout(() => {
      setCompareResults({
        scenarioId: compareScenario.id,
        results: runSimulation(compareScenario),
      });
    }, 0);
    return () => clearTimeout(id);
  }, [compareScenario?.id]);

  // Snapshot sim is computed once per snapshot identity — frozen original baseline.
  // Deferred to a 0ms setTimeout so React can paint the "Setting up…" loading
  // state before the 5000-run Monte Carlo blocks the main thread.
  const [whatIfSnapshotResults, setWhatIfSnapshotResults] = useState<any>(null);
  useEffect(() => {
    if (!whatIfSnapshot) { setWhatIfSnapshotResults(null); return; }
    // Fast preview first so the Original line appears instantly when entering What If.
    const returnModel = whatIfSnapshot.portfolioAssumptions?.returnModel ?? 'parametric';
    if (returnModel !== 'historical_rolling' && returnModel !== 'historical_bootstrap') {
      setWhatIfSnapshotResults(runFastPreview(whatIfSnapshot, whatIfSnapshot.lastSuccessProbability));
    } else {
      setWhatIfSnapshotResults(null);
    }
    const id = window.setTimeout(() => {
      setWhatIfSnapshotResults(runSimulation(whatIfSnapshot));
    }, 0);
    return () => window.clearTimeout(id);
  }, [whatIfSnapshot]);

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
        {/* Full-screen spinner removed: fast preview paints the chart
            immediately on scenario switch, so we no longer need a blank
            state. Historical rolling/bootstrap modes (which skip the
            preview) momentarily show no chart, but their full MC is the
            same speed regardless. */}
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
            onRegisterExport={onRegisterExport}
            whatIfActive={whatIfActive}
            whatIfSnapshot={whatIfSnapshot}
            whatIfSnapshotResults={whatIfSnapshotResults}
            compareDisabled={compareDisabled}
            onEnterWhatIf={onEnterWhatIf}
            onDiscardWhatIf={onDiscardWhatIf}
            onSaveWhatIf={onSaveWhatIf}
            onSaveWhatIfAsNew={onSaveWhatIfAsNew}
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
