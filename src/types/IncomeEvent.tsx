export type IncomeEventType =
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
  name?: string; // For 'other_income' type
  amount: number; // Annual amount in today's dollars
  startAge: number;
  endAge?: number; // Optional for ongoing income
  isOneTime?: boolean; // If true, income occurs only in the start year
  taxStatus: 'before_tax' | 'after_tax'; // Except Social Security is always before_tax
  colaType: 'fixed' | 'inflation_adjusted';
  syncWithEstimate?: boolean; // For Social Security
}

export interface PortfolioAssumptions {
  riskLevel: 'conservative' | 'moderate' | 'high' | 'custom';
  customAllocation?: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  expectedReturn?: number;
  standardDeviation?: number;
}
