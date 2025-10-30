import type { SpendingGoal, RetirementSpending } from './SpendingGoal';
import type { IncomeEvent, PortfolioAssumptions } from './IncomeEvent';

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
  // Legacy fields for backward compatibility
  monthlyRetirementSpending?: number;
  ssAmount?: number;
  riskLevel?: 'conservative' | 'moderate' | 'high';
}
