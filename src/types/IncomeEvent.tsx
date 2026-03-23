export type IncomeEventType =
  | 'employment_savings'
  | 'social_security'
  | 'annuity_income'
  | 'inheritance'
  | 'pension_income'
  | 'rental_income'
  | 'sale_of_property'
  | 'work_during_retirement'
  | 'other_income';

export interface IncomeEvent {
  id: string;
  type: IncomeEventType;
  owner?: 'self' | 'spouse';
  name: string;
  amount: number; // Annual amount in today's dollars
  startAge: number;
  endAge?: number; // Optional for ongoing income
  isOneTime?: boolean; // If true, income occurs only in the start year
  taxStatus: 'before_tax' | 'after_tax'; // Except Social Security is always before_tax
  colaType: 'fixed' | 'inflation_adjusted';
  ssHaircutEnabled?: boolean; // SS only — apply trust fund reduction from 2034
  ssHaircutPercent?: number; // SS only — reduction percentage (default 23)
  ssAmountBasis?: 'today' | 'future'; // SS only — today's dollars vs already-inflated (default 'today')
  amountPeriod?: 'monthly' | 'annual'; // UI hint for input/display period (default 'annual')
}

export type PortfolioType = 'conservative' | 'balanced' | 'aggressive';

export interface PortfolioParams {
  mean: number; // Arithmetic mean return (nominal, decimal e.g., 0.045 for 4.5%)
  stdDev: number; // Standard deviation (decimal e.g., 0.08 for 8%)
  mu: number; // For log-normal: mean of ln(1 + r)
  sigma: number; // For log-normal: std dev of ln(1 + r)
}

export interface PortfolioAssumptions {
  riskLevel: PortfolioType | 'custom';
  customAllocation?: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  expectedReturn?: number;
  standardDeviation?: number;
}
