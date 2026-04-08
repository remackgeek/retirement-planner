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

export type PortfolioType = '80_20' | '60_40' | '50_50';

export interface PortfolioAssumptions {
  portfolioBalance: PortfolioType | 'custom';
  stockAllocation: number; // 0.0–1.0
  stockReturn: number;     // decimal, e.g. 0.07
  stockStdDev: number;
  bondReturn: number;
  bondStdDev: number;
}
