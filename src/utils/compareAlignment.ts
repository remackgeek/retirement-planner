import type { AnnualCashFlowBreakdown } from '../services/SimulationService';

/**
 * Calendar-year alignment for the scenario-compare overlay.
 *
 * Simulation results are indexed from each scenario's own `referenceYear`
 * (index 0 = that scenario's year 0). Two scenarios with different reference
 * years — typically last year's plan kept as a checkpoint vs. this year's —
 * would otherwise be overlaid by index, putting the older plan one column to
 * the left of the calendar year it actually describes.
 *
 * The compared scenario is never mutated or rolled for comparison (it is the
 * record of what was planned then). Instead `alignCompareResults` re-expresses
 * the compared run in the ACTIVE plan's index frame and year-0 dollars, once,
 * so every consumer (chart line, hover popup) reads plain arrays.
 *
 * Convention: `offset = active.referenceYear − compared.referenceYear`, i.e.
 * POSITIVE when the compared plan is older. Active index `i` (calendar year
 * `active.referenceYear + i`) lands on compared index `i + offset`.
 */

export function compareYearOffset(
  active: { referenceYear: number },
  compared: { referenceYear: number },
): number {
  const offset = active.referenceYear - compared.referenceYear;
  return Number.isFinite(offset) ? offset : 0;
}

/**
 * Index into the compared scenario's arrays for the active scenario's
 * `activeIndex`, or `null` when that calendar year lies outside the compared
 * projection (before its start, or past its horizon).
 */
export function compareIndexFor(
  activeIndex: number,
  offset: number,
  compareLength: number,
): number | null {
  const ci = activeIndex + offset;
  if (!Number.isInteger(ci) || ci < 0 || ci >= compareLength) return null;
  return ci;
}

/**
 * Factor that re-expresses the compared run's real (its-year-0) dollars in the
 * active plan's year-0 dollars, taken from the runs' OWN cumulative-inflation
 * arrays (`inflation[i]` = cumulative factor from that run's year 0 to year i,
 * as produced by `simulateOneRun`). Exact for every return model — historical
 * modes deflate by the CPI row and the MC median by its stochastic path, none
 * of which the scalar `inflationRate` describes.
 *
 * - `offset > 0` (compared plan is older): active year 0 is compared index
 *   `offset`, so the factor is `compareInflation[offset]` (> 1 with positive
 *   inflation: an older dollar is worth more of the newer ones).
 * - `offset < 0` (compared plan is newer): compared year 0 is active index
 *   `−offset`, so the factor is `1 / activeInflation[−offset]`.
 * - `offset === 0` or the needed index is missing: 1.
 */
export function realDollarRebaseFactor(
  offset: number,
  compareInflation: readonly number[],
  activeInflation: readonly number[],
): number {
  if (!Number.isFinite(offset) || offset === 0) return 1;
  const f = offset > 0 ? compareInflation[offset] : 1 / (activeInflation[-offset] ?? NaN);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** The compared run re-expressed in the active plan's index frame. */
export interface AlignedCompare {
  /** Real (active-year-0 dollars) balance per active index; `null` = no such year. */
  path: (number | null)[];
  /**
   * Deflator per active index such that `nominal / inflation[i]` is in active
   * year-0 dollars (the compared run's own cumulative inflation divided by the
   * rebase factor). 1 where `path` is null.
   */
  inflation: number[];
  breakdowns: (AnnualCashFlowBreakdown | null)[];
  /** Real-dollar rebase applied (1 when the plans share a reference year). */
  rebase: number;
}

export function alignCompareResults(
  compared: {
    path: readonly number[];
    inflation: readonly number[];
    breakdowns: readonly AnnualCashFlowBreakdown[];
  },
  offset: number,
  activeLength: number,
  activeInflation: readonly number[],
): AlignedCompare {
  const rebase = realDollarRebaseFactor(offset, compared.inflation, activeInflation);
  const path: (number | null)[] = new Array(activeLength);
  const inflation: number[] = new Array(activeLength);
  const breakdowns: (AnnualCashFlowBreakdown | null)[] = new Array(activeLength);
  for (let i = 0; i < activeLength; i++) {
    const ci = compareIndexFor(i, offset, compared.path.length);
    if (ci == null) {
      path[i] = null;
      inflation[i] = 1;
      breakdowns[i] = null;
    } else {
      path[i] = compared.path[ci] * rebase;
      inflation[i] = (compared.inflation[ci] ?? 1) / rebase;
      breakdowns[i] = compared.breakdowns[ci] ?? null;
    }
  }
  return { path, inflation, breakdowns, rebase };
}
