/**
 * Design C — Coordinate descent on the per-year conversion vector.
 *
 * Starting from Auto-bracket's best schedule, we sweep year-by-year and for
 * each year run a 1D line search over a small set of conversion-amount
 * candidates, holding all other years fixed. We iterate this sweep until
 * improvement falls below a small epsilon (or we hit max sweeps).
 *
 * Captures cross-year interactions that Designs A/B can't see:
 *   - Converting more in year 5 shrinks Traditional balance and thus the
 *     forced RMD at age 73, expanding bracket headroom in later years.
 *   - Converting less now might pay off if it keeps MAGI under an IRMAA
 *     cliff in the 2-year-lookback window.
 *
 * Cost: ~30-year horizon × ~10 candidates × ~2-3 sweeps = 600-900 deterministic
 * projections × ~5ms = 3-5 seconds. Acceptable for an explicit "Run Optimization"
 * button (not on every keystroke). Per the plan's perf rules, this is the
 * realistic Design C cost; a precompute-reuse refactor (sharing per-year
 * inputs across candidate evaluations) could push this under 1s, but isn't
 * required for Phase 3b correctness.
 *
 * IMPORTANT: This is an OPEN-LOOP optimizer. The resolved per-year vector is
 * baked in at sim start; MC paths follow it regardless of how the stochastic
 * state evolves. On bad MC paths the schedule will be suboptimal (e.g.,
 * converting large in a year that turned out to be a -30% market). This is
 * the same approximation every production planner ships and is documented
 * verbatim in the StrategyRationale panel header.
 */

import type { UserData } from '../../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision } from './types';
import { runDeterministicProjection } from '../SimulationService';
import { computeAutoBracketSchedule, scoreProjection } from './AutoBracketStrategy';
import { buildStrategyConversionEvents, isGeneratorProducedConversion } from './syntheticEvents';

// Tunables. Named (not magic numbers in the descent loop body) per the plan's
// code-hygiene rule for optimizer constants.
export const OPTIMIZE_MAX_SWEEPS = 3;
export const OPTIMIZE_CONVERGENCE_EPSILON_FRACTION = 0.001; // 0.1% relative improvement
/** Multipliers applied to each year's current conversion amount to generate
 *  candidates when the current amount is non-zero. Includes 0 (skip). */
export const OPTIMIZE_CANDIDATE_MULTIPLIERS: number[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
/** Absolute-dollar probes applied when the current year's amount is 0. The
 *  multiplier-based scheme collapses to {0} when current=0, so we need an
 *  explicit set of small-to-mid conversion amounts to "wake up" a year. The
 *  spacing is logarithmic-ish so optimum amounts in the $10-50k range (where
 *  most 12%-bracket-headroom conversions land) are sampled at ~$5-10k
 *  granularity. Coarser above that since values >$100k are usually only
 *  optimal in unusual setups. */
export const OPTIMIZE_ZERO_INIT_PROBES: number[] = [
  5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000,
];

export interface OptimizeResult {
  perYearDecisions: PerYearStrategyDecision[];
  /** Score of the optimized vector. */
  finalScore: number;
  /** Score after each sweep — useful for the rationale panel to show
   *  improvement over iterations. */
  sweepScores: number[];
  /** Cost in deterministic-projection evaluations (informational). */
  projectionCount: number;
  /** Score of the user's TRUE pre-strategy baseline (no taxStrategy, uses
   *  the user's existing spendingWithdrawalOrder resolution). The dialog
   *  uses this to report "vs your current setup, the optimizer found
   *  +X% improvement" — which is what users actually want to know. The
   *  internal seed→final improvement is often tiny and misleading because
   *  the seed (Auto-bracket winner) is itself a significant strategy
   *  change from the user's baseline. */
  baselineScore: number;
}

/**
 * Run coordinate descent to optimize the per-year conversion vector.
 *
 * Synchronous and CPU-bound. Expected to be called from an explicit UI action
 * (Strategy dialog's "Run optimization" button). The UI should show a spinner
 * since this can take ~3-5 seconds for a typical 30-year horizon.
 */
export function runOptimization(
  userData: UserData,
  taxStrategy: TaxStrategy,
): OptimizeResult {
  const objective = taxStrategy.objective ?? 'max_median_terminal_wealth';
  let projectionCount = 0;

  // True baseline: user's scenario with no taxStrategy at all. This is the
  // "stay where you are" reference point. We score it explicitly so the UI
  // can report "vs your current setup, optimizer found +X% improvement" —
  // not the misleading "vs Auto-bracket seed" delta.
  // True baseline = the scenario as-saved. The engine no longer reads any
  // strategy-override field, so no extra stripping is needed.
  const baselineProjection = runDeterministicProjection(userData);
  const baselineScore = scoreProjection(baselineProjection, objective);
  projectionCount++;

  // Initialize: Auto-bracket's best schedule.
  const seed = computeAutoBracketSchedule(userData, taxStrategy);
  projectionCount += 4; // Auto-bracket evaluated 4 candidates
  let bestSchedule: PerYearStrategyDecision[] = seed.perYearDecisions.map((d) => ({ ...d }));

  // Helper: evaluate a candidate schedule via deterministic projection.
  const evaluate = (schedule: PerYearStrategyDecision[]): number => {
    projectionCount++;
    // Inject the schedule as synthetic conversion events on a userData copy.
    // We use 'fill_to_bracket' as the inner strategy name with a precomputed
    // schedule — but the framework's fill_to_bracket recomputes the schedule
    // from bracket headroom, not from the candidate. So we use 'fixed' with
    // pre-injected synthetic events. The synthetic-event factory is shared
    // with TaxStrategyFramework via syntheticEvents.ts.
    const synthetic = buildStrategyConversionEvents(userData, schedule);
    // Strip only generator-produced conversions; keep manual + user-detached
    // events (they survive Apply per the replace-only-generated policy) so the
    // candidate's score matches the post-Apply state.
    const candidateUserData: UserData = {
      ...userData,
      incomeEvents: [
        ...userData.incomeEvents.filter((e) => !isGeneratorProducedConversion(e)),
        ...synthetic,
      ],
      // Force bracket_aware spending order; mirror what optimize uses at sim time.
      spendingWithdrawalOrder: 'bracket_aware',
    };
    const projection = runDeterministicProjection(candidateUserData);
    return scoreProjection(projection, objective);
  };

  // Score the seed UNDER THE DESCENT'S SCORING FRAME so subsequent
  // comparisons are apples-to-apples. The seed from AutoBracket's grid uses
  // a different scoring frame depending on the winner (the 'none' candidate
  // strips taxStrategy entirely; others force bracket_aware). The descent
  // always evaluates with `taxStrategy: 'fixed' + spendingWithdrawalOrder:
  // 'bracket_aware'` (see `evaluate` above). Without this re-scoring,
  // descent can silently miss the spending-order gain — if seed score uses
  // taxable_first and the descent's all-zero schedule scores higher under
  // bracket_aware, the year-update guard (`yearBestAmount !== currentAmount`)
  // skips the improvement because both amounts are 0.
  let bestScore = evaluate(bestSchedule);
  const sweepScores: number[] = [bestScore];

  // Coordinate descent. Forward sweep, then backward sweep per iteration.
  for (let sweep = 0; sweep < OPTIMIZE_MAX_SWEEPS; sweep++) {
    const prevScore = bestScore;
    const totalYears = bestSchedule.length;
    const direction = sweep % 2 === 0 ? 1 : -1;
    const startIdx = direction === 1 ? 0 : totalYears - 1;
    const endIdx = direction === 1 ? totalYears : -1;
    for (let i = startIdx; i !== endIdx; i += direction) {
      const currentAmount = bestSchedule[i].conversionAmount;
      const candidates: number[] = OPTIMIZE_CANDIDATE_MULTIPLIERS.map((m) => currentAmount * m);
      // Always include 0 explicitly (in case currentAmount was already 0,
      // multipliers all collapse).
      if (!candidates.includes(0)) candidates.push(0);
      // Zero-init year: multipliers all collapse to 0, so we have nothing to
      // explore around. Use absolute-dollar probes to "wake up" the year.
      // The probe set is logarithmic-ish in the $5-100k range where most
      // bracket-headroom conversions land.
      if (currentAmount === 0) {
        for (const probe of OPTIMIZE_ZERO_INIT_PROBES) candidates.push(probe);
      }

      let yearBestAmount = currentAmount;
      let yearBestScore = bestScore;
      for (const cand of candidates) {
        if (cand < 0) continue;
        const trial = bestSchedule.map((d, j) => (j === i ? { ...d, conversionAmount: cand } : d));
        const score = evaluate(trial);
        if (score > yearBestScore) {
          yearBestScore = score;
          yearBestAmount = cand;
        }
      }

      if (yearBestAmount !== currentAmount) {
        bestSchedule[i] = { ...bestSchedule[i], conversionAmount: yearBestAmount };
        bestScore = yearBestScore;
      }
    }
    sweepScores.push(bestScore);

    // Convergence check: relative improvement under the epsilon → stop.
    const denom = Math.max(1, Math.abs(prevScore));
    const relImprovement = (bestScore - prevScore) / denom;
    if (relImprovement < OPTIMIZE_CONVERGENCE_EPSILON_FRACTION) break;
  }

  return {
    perYearDecisions: bestSchedule,
    finalScore: bestScore,
    sweepScores,
    projectionCount,
    baselineScore,
  };
}

// (Synthetic-event construction lives in `syntheticEvents.ts` and is shared
// with `TaxStrategyFramework.injectSyntheticConversions`. Both consumers
// import `buildStrategyConversionEvents` from there so the factory has a
// single source of truth.)
