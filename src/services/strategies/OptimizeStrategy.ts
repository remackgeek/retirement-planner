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
import { DEFAULT_END_AGE_CAP, DEFAULT_TERMINAL_TRAD_TAX_RATE } from './types';
import { runDeterministicProjection, selectBestSpendingOrder } from '../SimulationService';
import { computeAutoBracketSchedule, scoreProjection, type AfterTaxScoreParams } from './AutoBracketStrategy';
import { capConversionForCliffs, irmaaTierFillCandidates } from './FillToBracketStrategy';
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
  /** Score of the user's TRUE pre-strategy baseline (scenario as-saved,
   *  with no synthetic conversions added, run under the same pinned
   *  spending policy the descent uses). The dialog reports "vs your
   *  current setup, optimizer found +$X" using this baseline. */
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
  // Consumed only when the objective is 'max_after_tax_terminal_wealth';
  // harmless otherwise. Same derivation as computeAutoBracketSchedule so the
  // seed's winnerScore stays directly comparable to descent scores.
  const afterTaxParams: AfterTaxScoreParams = {
    ltcgRate: userData.longTermCapGainsRate ?? 0,
    terminalTradRate: taxStrategy.terminalTradTaxRate ?? DEFAULT_TERMINAL_TRAD_TAX_RATE,
  };
  let projectionCount = 0;

  // **Perf:** pin the spending policy once for the entire descent. Without
  // pinning, every `runDeterministicProjection` call below triggers
  // `selectBestSpendingOrder` internally → 2 extra inner projections per
  // call. Across ~600–1500 candidate evaluations, that's a ~3× slowdown
  // (10–15 s vs the documented 3–5 s). We pin to the policy picked for the
  // user's true baseline (no extra conversions). The choice is unlikely to
  // flip across candidate schedules — they all share the same underlying
  // account balances, spending, and SS profile — and if it does flip, the
  // margin is small enough to be within the selector's tiebreaker
  // tolerance. Trade some marginal accuracy for ~3× perf.
  const pinnedSpendingOrder = selectBestSpendingOrder(userData);
  // Two deterministic projections inside selectBestSpendingOrder.
  projectionCount += 2;

  // True baseline: user's scenario as-saved, run with the pinned policy.
  // This is the "stay where you are" reference for "vs your current setup".
  const baselineProjection = runDeterministicProjection(userData, {
    _forceSpendingOrder: pinnedSpendingOrder,
  });
  const baselineScore = scoreProjection(baselineProjection, objective, userData.inflationRate, afterTaxParams);
  projectionCount++;

  // Initialize: Auto-bracket's best schedule. Pass our already-pinned
  // policy down to AutoBracket so it doesn't redundantly recompute the
  // same selector answer (saves 2 projections).
  const seed = computeAutoBracketSchedule(userData, taxStrategy, pinnedSpendingOrder);
  // Auto-bracket: 4 candidate projections (no selector probe — pinned).
  projectionCount += 4;
  const bestSchedule: PerYearStrategyDecision[] = seed.perYearDecisions.map((d) => ({ ...d }));

  // Helper: evaluate a candidate schedule via deterministic projection.
  // Passes `_forceSpendingOrder: pinnedSpendingOrder` so the inner call
  // skips selectBestSpendingOrder.
  const evaluate = (schedule: PerYearStrategyDecision[]): number => {
    projectionCount++;
    const synthetic = buildStrategyConversionEvents(userData, schedule);
    // Strip generator-produced conversions; keep manual + user-detached
    // events (they survive Apply per the replace-only-generated policy) so the
    // candidate's score matches the post-Apply state.
    const candidateUserData: UserData = {
      ...userData,
      incomeEvents: [
        ...userData.incomeEvents.filter((e) => !isGeneratorProducedConversion(e)),
        ...synthetic,
      ],
    };
    const projection = runDeterministicProjection(candidateUserData, {
      _forceSpendingOrder: pinnedSpendingOrder,
    });
    return scoreProjection(projection, objective, userData.inflationRate, afterTaxParams);
  };

  // Use AutoBracket's reported winner score directly — no re-score needed.
  //
  // Contract that makes this safe: both AutoBracket and this descent now
  //   (a) pin the same `pinnedSpendingOrder` (both compute it via
  //       `selectBestSpendingOrder(userData)` against the same userData),
  //   (b) construct candidate userData identically — strip generator-tagged
  //       conversions from `userData.incomeEvents`, then append synthetic
  //       events built from the schedule via `buildStrategyConversionEvents`.
  // So `evaluate(seed.perYearDecisions)` would produce exactly `seed.winnerScore`
  // — the re-score was historically needed because AutoBracket's 'none' branch
  // used different settings than the bracket branches, but that asymmetry was
  // removed in the Pass 1 audit (MEDIUM-1). Saves one projection per Optimize
  // invocation; not huge, but it's the same logical fix as HIGH-3.
  let bestScore = seed.winnerScore;
  const sweepScores: number[] = [bestScore];

  // End-age cap: skip years past the cap entirely. The seed (Auto-bracket
  // winner) already emits 0 for these years; coordinate descent shouldn't
  // probe non-zero candidates past the cap either. Wizard-generated
  // conversions are self-owned (handleWizApply doesn't set owner; engine
  // defaults to self), so the cap applies to self's age. See
  // FillToBracketStrategy for the matching rationale.
  const endAgeCap = taxStrategy.endAgeCap ?? DEFAULT_END_AGE_CAP;
  const yearIsCapped = (yearIndex: number): boolean => {
    const age = userData.currentAge + yearIndex;
    return age > endAgeCap;
  };

  // Tier-aware probes (cliffs OFF only): conversion amounts that fill MAGI
  // exactly to each IRMAA tier ceiling, so the descent evaluates deliberate
  // tier crossings at their efficient boundary points and the score (which
  // prices the surcharge via the engine) arbitrates whether crossing pays.
  // With cliffs ON these would be redundant — capConversionForCliffs already
  // snaps over-sized candidates onto the next-tier ceiling and forbids
  // crossings by design. Precomputed per year (invariant across sweeps).
  const cliffsOff = userData.respectIrmaaNiitCliffs === false;
  const tierProbesByYear: number[][] = bestSchedule.map((d, i) =>
    cliffsOff && !yearIsCapped(i) ? irmaaTierFillCandidates(userData, d.year, i) : [],
  );

  // Coordinate descent. Forward sweep, then backward sweep per iteration.
  for (let sweep = 0; sweep < OPTIMIZE_MAX_SWEEPS; sweep++) {
    const prevScore = bestScore;
    const totalYears = bestSchedule.length;
    const direction = sweep % 2 === 0 ? 1 : -1;
    const startIdx = direction === 1 ? 0 : totalYears - 1;
    const endIdx = direction === 1 ? totalYears : -1;
    for (let i = startIdx; i !== endIdx; i += direction) {
      if (yearIsCapped(i)) continue;
      const currentAmount = bestSchedule[i].conversionAmount;
      const year = bestSchedule[i].year; // === userData.referenceYear + i
      const rawCandidates: number[] = OPTIMIZE_CANDIDATE_MULTIPLIERS.map((m) => currentAmount * m);
      // Always include 0 explicitly (in case currentAmount was already 0,
      // multipliers all collapse).
      if (!rawCandidates.includes(0)) rawCandidates.push(0);
      // Zero-init year: multipliers all collapse to 0, so we have nothing to
      // explore around. Use absolute-dollar probes to "wake up" the year.
      // The probe set is logarithmic-ish in the $5-100k range where most
      // bracket-headroom conversions land.
      if (currentAmount === 0) {
        for (const probe of OPTIMIZE_ZERO_INIT_PROBES) rawCandidates.push(probe);
      }
      // IRMAA tier-boundary probes (empty unless cliffs are off — see above).
      for (const probe of tierProbesByYear[i]) rawCandidates.push(probe);
      // Cliff-aware candidate generation: cap each candidate under the next IRMAA
      // tier ceiling so the descent never probes a conversion that trips a cliff —
      // the same hard cap fill-to-bracket and auto-bracket already apply. No-op when
      // `respectIrmaaNiitCliffs` is off (capConversionForCliffs returns its input);
      // in that mode the tier-boundary probes above give the descent the efficient
      // crossing candidates instead. Dedupe so candidates that collapse onto the
      // ceiling don't trigger redundant projections.
      const candidates = [
        ...new Set(rawCandidates.map((c) => (c < 0 ? c : capConversionForCliffs(userData, year, i, c)))),
      ];

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
