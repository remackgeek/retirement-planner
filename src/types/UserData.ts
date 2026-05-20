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
  enableIRMAA?: boolean;        // Medicare IRMAA premium surcharges (default true)
  enableNIIT?: boolean;         // 3.8% Net Investment Income Tax (default true)
  // Power-user override: when `true`, the state-profile's retirement-income exclusion
  // (e.g., NY $20k, PA full, MI 67+) is *not* applied — Traditional withdrawals are
  // fully exposed to state tax. Default `false`/`undefined` = use the profile's rule.
  disableStateRetirementExclusion?: boolean;
  // Your modified AGI in the year before retirement — used for the IRS 2-year
  // IRMAA lookback in the first two retirement years (when the in-sim history
  // doesn't yet exist). Single value, applied to both i=0 and i=1.
  priorWorkingMagi?: number;
  contributionLimits?: ContributionLimits;
  // Spending withdrawal source policy. Controls ONLY where living-expenses cash
  // comes from — does NOT change the conversion gross, conversion-tax sourcing,
  // or any other intent.
  //   'taxable_first' — RMD → Taxable → Trad-above-RMD → Roth (current default
  //     when no conversions exist). Conservative; preserves Traditional.
  //   'bracket_aware' — RMD → Trad up to top-of-12%-federal-bracket headroom
  //     (conv- and SS-inclusive) → Taxable → Trad-above-headroom → Roth. Smart
  //     default when any roth_conversion event exists: pulls Trad cheaply in
  //     low-bracket years to preserve Taxable for high-mt conversion years.
  //     See CLAUDE.md "Cross-year spending source policy" for blind spots
  //     (IRMAA cliffs, NIIT thresholds, state retirement exclusions, etc.).
  // When undefined, resolved at sim start: 'bracket_aware' if conversions exist,
  // else 'taxable_first'.
  spendingWithdrawalOrder?: 'taxable_first' | 'bracket_aware';
}

export interface ContributionLimits {
  elective401k: number;       // 401(k)/403(b)/TSP elective deferral cap (default 23000)
  iraLimit: number;           // IRA cap (default 7000)
  catchUpAge: number;         // age at which catch-up contributions kick in (default 50)
  catchUp401k: number;        // 401(k) catch-up amount (default 7500)
  catchUpIra: number;         // IRA catch-up amount (default 1000)
  inflationAdjusted: boolean; // scale caps by deterministic mean inflation per year
}
