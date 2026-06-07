/**
 * Design B — Auto-bracket strategy.
 *
 * Grid-searches the four candidate bracket targets ('none', '12_percent',
 * '22_percent', '24_percent'), runs the Fill-to-bracket schedule for each
 * against the deterministic projection, scores the result by the configured
 * objective, and returns the per-year schedule of the winning bracket.
 *
 * Cost: 4× a deterministic projection (~20ms). Cached on the scenario's
 * `taxStrategy.cachedVector` so we don't re-grid-search on every render —
 * the cache is computed at save-time in StrategyDialog and validated by
 * fingerprint at sim time.
 *
 * This module imports `runDeterministicProjection` from SimulationService.
 * To avoid the SimulationService → TaxStrategyFramework → AutoBracket cycle,
 * the framework does NOT import this module. Instead the StrategyDialog (UI)
 * calls `computeAutoBracketSchedule` directly when the user picks the
 * strategy, stores the resulting vector on `cachedVector`, and resolveTaxStrategy
 * just reads from the cache.
 */

import type { UserData } from '../../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision, BracketTarget, StrategyObjective } from './types';
import { computeFillToBracketSchedule } from './FillToBracketStrategy';
import { runDeterministicProjection, selectBestSpendingOrder, type ResolvedSpendingOrder } from '../SimulationService';
import { buildStrategyConversionEvents, isGeneratorProducedConversion } from './syntheticEvents';
import { deflateToYearZero } from '../../utils/deflate';

const CANDIDATE_BRACKETS: BracketTarget[] = ['none', '12_percent', '22_percent', '24_percent'];

export interface AutoBracketResult {
  /** The bracket choice that won the grid search. */
  chosenBracket: BracketTarget;
  /** Per-year decision vector for the chosen bracket. */
  perYearDecisions: PerYearStrategyDecision[];
  /** Score of the winner (higher = better; objective-dependent). Useful for
   *  the StrategyRationale panel to show "this beat the runner-up by $X". */
  winnerScore: number;
  /** Per-candidate scores for the rationale panel. The 'none' candidate's
   *  score reflects the user's TRUE baseline (no taxStrategy), while the
   *  bracket candidates use bracket_aware spending — see the special-case
   *  in `computeAutoBracketSchedule`. */
  candidateScores: { bracket: BracketTarget; score: number }[];
}

export function computeAutoBracketSchedule(
  userData: UserData,
  taxStrategy: TaxStrategy,
  /** Optional pin for the spending policy used to score each candidate.
   *  When provided, this is used directly — useful when `runOptimization` (the
   *  primary caller) has already picked the pin and wants to avoid recomputing
   *  it (2 redundant projections per Optimize invocation). When omitted,
   *  AutoBracket picks its own pin via `selectBestSpendingOrder` — preserves
   *  standalone callability for the success-probability MC and other direct
   *  callers. The same userData → same pinned answer, so the parameter is
   *  semantically a hint, not an override. */
  pinnedSpendingOrder?: ResolvedSpendingOrder,
): AutoBracketResult {
  const objective = taxStrategy.objective ?? 'max_median_terminal_wealth';
  const candidateScores: { bracket: BracketTarget; score: number }[] = [];
  let best: AutoBracketResult | null = null;

  // Pin the spending policy once for all 4 candidates. Without pinning, each
  // `runDeterministicProjection` triggers `selectBestSpendingOrder` → 2
  // extra projections per candidate (4×3=12 total instead of 4). Accept an
  // upstream pin to avoid recomputing the same answer when called from
  // runOptimization.
  const policyPin = pinnedSpendingOrder ?? selectBestSpendingOrder(userData);

  for (const bracket of CANDIDATE_BRACKETS) {
    const schedule = computeFillToBracketSchedule(userData, { ...taxStrategy, bracketTarget: bracket });
    // Build the candidate userData for this bracket's projection.
    //  - 'none' = clean status-quo baseline (strips generator-tagged
    //    conversions; keeps manual / user-detached events). Matches
    //    OptimizeStrategy.evaluate()'s frame so the seed score is comparable
    //    to descent scores (Revision 3 MEDIUM-1 fix).
    //  - 12% / 22% / 24% = same survivor base + synthetic events from the
    //    fill-to-bracket schedule.
    // The spending policy is pinned uniformly across all candidates via
    // `_forceSpendingOrder: policyPin` (Revision 3 HIGH-3), so the grid
    // measures conversion-schedule effect on a consistent spending frame.
    const survivors = userData.incomeEvents.filter((e) => !isGeneratorProducedConversion(e));
    const candidateUserData: UserData = bracket === 'none'
      ? { ...userData, incomeEvents: survivors }
      : {
          ...userData,
          incomeEvents: [
            ...survivors,
            ...buildStrategyConversionEvents(userData, schedule),
          ],
        };
    const projection = runDeterministicProjection(candidateUserData, {
      _forceSpendingOrder: policyPin,
    });
    const score = scoreProjection(projection, objective, userData.inflationRate);
    candidateScores.push({ bracket, score });
    if (best === null || score > best.winnerScore) {
      best = {
        chosenBracket: bracket,
        perYearDecisions: schedule,
        winnerScore: score,
        candidateScores: [],  // filled below after loop
      };
    }
  }

  if (best === null) {
    // Defensive — CANDIDATE_BRACKETS is non-empty, so this branch should be unreachable.
    return {
      chosenBracket: '12_percent',
      perYearDecisions: [],
      winnerScore: 0,
      candidateScores: [],
    };
  }
  best.candidateScores = candidateScores;
  return best;
}

/**
 * Maps a deterministic-projection result to a scalar score by the configured
 * objective. Higher is always better (we negate "min" objectives).
 *
 * **Units note.** The projection stores two kinds of values that differ in
 * their deflation state:
 *  - `path[i]` is **already deflated to real (year-0) dollars** by the engine
 *    at SimulationService.ts `path.push(startBalance / cumulativeInflation)`.
 *    So terminal-wealth scoring just reads it directly — deflating again
 *    here would produce double-deflated units and a delta that mismatches
 *    the inline chart's visible end-of-plan diff.
 *  - `breakdowns[i].totalTax` is **nominal-year-i** (the actual tax bill in
 *    that year's dollars). Summing nominal across years conflates units, so
 *    for a real lifetime-tax score we deflate each year to year 0 before
 *    summing.
 *
 *  - `'max_median_terminal_wealth'` (default): start-of-last-year portfolio
 *    balance, already real. We use start-of-last-year rather than a true
 *    end-of-plan because the simulation engine doesn't capture
 *    end-of-last-year in the path array; for COMPARING strategies across
 *    the same horizon, this is bit-for-bit equivalent (both candidates'
 *    last-year start-balance reflects their full-horizon outcome).
 *  - `'min_lifetime_tax'`: negative sum of per-year nominal totalTax,
 *    deflated to year 0 before summing. Maximizing the negative =
 *    minimizing the real tax burden.
 *  - `'max_floor'`: not implementable from deterministic alone (it needs
 *    the 10th-percentile MC path). Falls back to terminal wealth; full MC
 *    scoring is a future refinement.
 *  - `'max_lifetime_consumption'`: spending isn't tier-aware in this codebase,
 *    so totalSpendingNet is exogenous (same across all strategies). Falls
 *    back to terminal wealth.
 */
export function scoreProjection(
  projection: ReturnType<typeof runDeterministicProjection>,
  objective: StrategyObjective,
  // `inflationRate` is consumed only by the `'min_lifetime_tax'` branch, which
  // deflates each year's nominal `totalTax` to year-0 dollars before summing.
  // `'max_median_terminal_wealth'` (the default branch) reads `path[last]`
  // which the engine has already deflated — no further deflation needed.
  // The parameter stays in the signature so callers don't have to remember
  // which objective uses it; passing it is harmless when unused.
  inflationRate: number,
): number {
  switch (objective) {
    case 'min_lifetime_tax': {
      let sum = 0;
      for (let i = 0; i < projection.breakdowns.length; i++) {
        sum += deflateToYearZero(projection.breakdowns[i].totalTax, i, inflationRate);
      }
      return -sum;
    }
    case 'max_median_terminal_wealth':
    case 'max_floor':
    case 'max_lifetime_consumption':
    default: {
      const lastIdx = projection.path.length - 1;
      return projection.path[lastIdx] ?? 0;
    }
  }
}
