import type { SpendingGoal, RetirementSpending } from './SpendingGoal';
import type {
  IncomeEvent,
  PortfolioAssumptions,
} from './IncomeEvent';

export interface UserData {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  currentSavings: number;
  annualSavings: number;
  retirementSpending: RetirementSpending;
  spendingGoals: SpendingGoal[];
  incomeEvents: IncomeEvent[];
  portfolioAssumptions: PortfolioAssumptions;
  referenceYear: number;
  inflationRate: number;
  // Tax configuration
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  spouseName: string | null;
  spouseAge: number | null;
  state: string; // State for tax calculation
}
