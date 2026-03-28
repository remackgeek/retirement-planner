import type { SpendingGoal } from './SpendingGoal';
import type {
  IncomeEvent,
  PortfolioAssumptions,
} from './IncomeEvent';

export interface StateResidency {
  state: string;
  startYear?: number; // omitted for first entry (= current state)
}

export interface UserData {
  currentAge: number;
  lifeExpectancy: number;
  currentSavings: number;
  spendingGoals: SpendingGoal[];
  incomeEvents: IncomeEvent[];
  portfolioAssumptions: PortfolioAssumptions;
  referenceYear: number;
  inflationRate: number;
  // Tax configuration
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  spouseAge: number | null;
  stateTimeline: StateResidency[];
}
