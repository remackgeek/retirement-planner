import type { SpendingGoal, RetirementSpending } from './SpendingGoal';
import type {
  IncomeEvent,
  PortfolioAssumptions,
  PortfolioType,
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
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh'; // Filing status for tax calculation
  spouseAge: number | null; // Spouse age for MFJ filing (null if no spouse)
  state: string; // State for tax calculation
  // Legacy fields for backward compatibility
  monthlyRetirementSpending?: number;
  ssAmount?: number;
  riskLevel?: PortfolioType;
}
