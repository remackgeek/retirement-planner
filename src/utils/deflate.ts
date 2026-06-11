/**
 * Deflate a nominal-year-i value to year-0 (real) dollars.
 *
 * Used in two places that compute the same formula:
 *  - `conversionImpact.ts` deflates per-year nominal helpers (firstYearTax,
 *    totalTaxOverConversion, rmdReductionAtStart, projectedRothAtEndOfPlan) so
 *    the Impact Preview grid is unit-consistent with the engine path's
 *    real-dollar `netPlanValueImpact`.
 *  - `AutoBracketStrategy.scoreProjection` deflates per-year `totalTax` for
 *    the `'min_lifetime_tax'` objective.
 *
 * The formula is `nominalValue / (1 + inflationRate)^yearIndex`. Defined as
 * a shared utility so the deflation contract has one source of truth — the
 * engine pre-deflates portfolio paths (SimulationService.ts `path.push(
 * startBalance / cumulativeInflation)`), and any downstream computation
 * that mixes nominal-per-year values with those paths must use this helper
 * to bring them to the same unit.
 */
export function deflateToYearZero(
  nominalValue: number,
  yearIndex: number,
  inflationRate: number,
): number {
  return nominalValue / Math.pow(1 + inflationRate, yearIndex);
}
