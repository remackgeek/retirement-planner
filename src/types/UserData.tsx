import type { SpendingGoal } from './SpendingGoal';
import type {
  IncomeEvent,
  PortfolioAssumptions,
} from './IncomeEvent';
import type { Account } from './Account';

export interface StateResidency {
  state: string;
  startYear?: number; // omitted for first entry (= current state)
}

export interface SimulationSettings {
  numSimulations: number;
  // Future: modelType: 'log_normal' | 'historical_sequence'
}

export interface UserData {
  currentAge: number;
  lifeExpectancy: number;
  accounts: Account[];
  spendingGoals: SpendingGoal[];
  incomeEvents: IncomeEvent[];
  portfolioAssumptions: PortfolioAssumptions;
  referenceYear: number;
  inflationRate: number;
  inflationStdDev: number;
  simulationSettings: SimulationSettings;
  // Tax configuration
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  spouseAge: number | null;
  stateTimeline: StateResidency[];
  longTermCapGainsRate: number; // flat rate applied to taxable-brokerage withdrawals
}
