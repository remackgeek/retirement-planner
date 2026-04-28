export type IncomeEventType =
  | 'employment_savings'
  | 'social_security'
  | 'annuity_income'
  | 'inheritance'
  | 'pension_income'
  | 'rental_income'
  | 'roth_conversion'
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
  accountId?: string; // employment_savings only — which account contributions land in
}

export type PortfolioType = '80_20' | '60_40' | '50_50';

export type ReturnDistribution = 'lognormal' | 'student_t';

// Selects the top-level return-generation strategy for a scenario.
// 'parametric' uses draws from the configured ReturnDistribution.
// 'historical_single' walks one fixed slice of recorded history.
// 'historical_rolling' iterates one run per valid start year (Trinity-style).
// 'historical_bootstrap' resamples random multi-year blocks from the series.
export type ReturnModel =
  | 'parametric'
  | 'historical_single'
  | 'historical_rolling'
  | 'historical_bootstrap';

export interface BlackSwanEvent {
  year: number;
  stockMultiplier: number; // replaces the drawn stock factor, e.g. 0.60 ⇒ -40% stock return
  bondMultiplier: number;
  groupId?: string; // ties multi-year template events together for grouped deletion
}

export interface PortfolioAssumptions {
  stockReturn: number;     // decimal, e.g. 0.07
  stockStdDev: number;
  bondReturn: number;
  bondStdDev: number;
  stockBondCorrelationEnabled: boolean;
  stockBondCorrelation: number; // -1.0 to 1.0
  returnDistribution: ReturnDistribution;
  degreesOfFreedom: number; // used when returnDistribution === 'student_t' (integer 3–12)
  returnModel?: ReturnModel; // defaults to 'parametric' when absent
  historicalStartYear?: number;    // required when returnModel === 'historical_single'
  historicalWrapEnabled?: boolean; // if true, horizon wraps to series start when data runs out
  historicalBlockSize?: number;    // required when returnModel === 'historical_bootstrap'; valid: 1, 3, 5, 10
  blackSwanEvents?: BlackSwanEvent[];
}
