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
  // Spouse's life expectancy (death age). Only meaningful when filingStatus === 'mfj'
  // and spouseAge !== null. When set, the engine models the "widow's penalty": at the
  // first spouse's death the survivor's filing status flips MFJ→single for the remaining
  // years (compressed brackets, ~half standard deduction, more SS taxable, lower IRMAA
  // tiers), the survivor keeps the larger of the two Social Security benefits, and all
  // Traditional balances consolidate to the survivor (combined RMD at the survivor's age).
  // The projection runs to the later of the two deaths. When undefined/null (or not MFJ /
  // no spouseAge), no death is modeled and results are bit-identical to before this field.
  // See CLAUDE.md "Survivor / widow's penalty" and MODEL_DETAILS.md.
  spouseLifeExpectancy?: number | null;
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
  // Caps the Roth Conversion wizard's generated per-year conversion so the
  // year's MAGI stays under (a) the next IRMAA tier ceiling — avoiding a
  // higher Medicare surcharge 2 years later — and (b) the NIIT threshold.
  // Conservative: it only ever lowers a conversion. Affects generated
  // schedules only, NOT manually entered conversions and NOT the
  // bracket-aware spending pull (the 12% spending headroom sits below both
  // cliffs and can't trip them). Default ON (undefined or true): practitioner
  // consensus treats IRMAA cliffs as hard caps. Explicit `false` opts out.
  // Exposed in the Roth Conversion wizard, not in the Scenario dialog.
  // See CLAUDE.md "Cross-year spending source policy" and
  // MODEL_DETAILS "respectIrmaaNiitCliffs".
  respectIrmaaNiitCliffs?: boolean;
  // When true, federal long-term capital-gains tax uses 0/15/20% bracket
  // stacking (gains stack on top of ordinary taxable income) instead of the
  // flat `longTermCapGainsRate`. Default (undefined/false) keeps the flat rate,
  // so results are bit-identical to before this option existed. State LTCG is
  // unaffected (it always uses the per-state profile). See MODEL_DETAILS.
  useStackedLtcgBrackets?: boolean;
  // Cash bucket management policy. Governs how cash account balances move
  // year-to-year (refill from surplus when low; sweep to Taxable when high).
  // Does NOT change cash interest, growth, or tax treatment — only mid-year
  // balance management. See CLAUDE.md "Cash bucket policy" and
  // MODEL_DETAILS.md "Cash bucket policy" for full semantics.
  //
  // Months refer to monthly = baseSpendingNet / 12 for the current sim year, so
  // the floor/target/ceiling adapt to the actual spending profile (and inflate
  // naturally as living-expenses goals scale).
  //
  // Refill triggers:
  //   'always'         — refill every year that has surplus available. Conservative.
  //   'gains_only'     — refill only when this year's stockFactor > 1 AND surplus. Bear-aware.
  //   'above_baseline' — refill only when portfolio / deterministic baseline > 1 AND surplus.
  //   'none'           — never auto-refill (manual mode). Equivalent to leaving policy undefined.
  //
  // When undefined OR refillTrigger === 'none': manual mode. The cash account
  // exists but the engine does not auto-refill or auto-sweep. Spending still
  // pulls Cash at priority 0; surplus still deposits to first Taxable as today.
  cashBucketPolicy?: CashBucketPolicy;
}

// Strategy types (TaxStrategy / BracketTarget / StrategyObjective / etc.)
// live in `src/services/strategies/types.ts`. They configure the Roth
// Conversion generator wizard's compute backends and are never read by the
// engine from UserData.

export interface CashBucketPolicy {
  /** Soft floor below which the engine *may* refill (per refillTrigger). Spending
   *  pulls Cash only down to `minMonths × monthly`; below that, spending falls
   *  through to Taxable. Rationale: in reality the user has unmodeled liquid
   *  cash; setting minMonths > 0 reflects how much they're WILLING to drain
   *  this bucket. Set to 0 to allow full drain-to-zero behavior. */
  minMonths: number;
  /** Target balance for refill destination and surplus routing. Refills top up
   *  to this level (capped by available surplus). */
  targetMonths: number;
  /** Hard ceiling. When cash > maxMonths × monthly, the excess is swept to
   *  Taxable in the post-convergence step (tax-free balance transfer). */
  maxMonths: number;
  refillTrigger: 'always' | 'gains_only' | 'above_baseline' | 'none';
}

export interface ContributionLimits {
  elective401k: number;       // 401(k)/403(b)/TSP elective deferral cap (default 23000)
  iraLimit: number;           // IRA cap (default 7000)
  catchUpAge: number;         // age at which catch-up contributions kick in (default 50)
  catchUp401k: number;        // 401(k) catch-up amount (default 7500)
  catchUpIra: number;         // IRA catch-up amount (default 1000)
  inflationAdjusted: boolean; // scale caps by deterministic mean inflation per year
}
