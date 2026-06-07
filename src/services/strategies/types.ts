/**
 * Type definitions for the Roth Conversion generator compute backends
 * (`computeFillToBracketSchedule`, `computeAutoBracketSchedule`,
 * `runOptimization`). These were previously coupled to `UserData.taxStrategy`
 * as a runtime override; that layer is gone, and the types live here so the
 * compute functions stay self-contained.
 *
 * `TaxStrategy` is a configuration bag passed AS A SECOND ARGUMENT into each
 * compute function — never stored on UserData and never consulted by the
 * engine.
 */

export type TaxStrategyName = 'fixed' | 'fill_to_bracket' | 'auto_bracket' | 'optimize';

export type BracketTarget = 'none' | '12_percent' | '22_percent' | '24_percent';

export type StrategyObjective =
  | 'max_median_terminal_wealth'
  | 'max_floor'
  | 'max_lifetime_consumption'
  | 'min_lifetime_tax';

/** Per-year decision vector entry produced by a compute backend. Plain-data
 *  serializable (round-trips through the Web Worker boundary cleanly). */
export interface PerYearStrategyDecision {
  year: number;
  /** Conversion amount the strategy wants this year (today-or-nominal
   *  depending on the backend; Fill-to-bracket emits nominal-for-target-year). */
  conversionAmount: number;
}

/** Default end-age cap for the wizard. Practitioner consensus: past ~80,
 *  the conversion math shifts from owner-lifetime tax arbitrage to estate
 *  planning (heir-rate arbitrage), which is a different objective. Bounding
 *  the window prevents the optimizer from emitting late-life conversions
 *  whose owner-lifetime payoff is near zero. */
export const DEFAULT_END_AGE_CAP = 80;

/** Configuration bag for the compute backends. */
export interface TaxStrategy {
  name: TaxStrategyName;
  /** Fill-to-bracket / Auto-bracket: target federal bracket. */
  bracketTarget?: BracketTarget;
  /** Auto-bracket / Optimize: objective to maximize. */
  objective?: StrategyObjective;
  /** Stop emitting conversions after the owner reaches this age. Per-owner
   *  handling: spouse-owned conversions use spouseAge, self-owned use
   *  currentAge. Years past the cap emit zero-amount entries (vector length
   *  stays totalYears so coordinate descent indexing is uniform). */
  endAgeCap?: number;
}
