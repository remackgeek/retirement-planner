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
import { runDeterministicProjection } from '../SimulationService';
import { buildStrategyConversionEvents, isGeneratorProducedConversion } from './syntheticEvents';

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
): AutoBracketResult {
  const objective = taxStrategy.objective ?? 'max_median_terminal_wealth';
  const candidateScores: { bracket: BracketTarget; score: number }[] = [];
  let best: AutoBracketResult | null = null;

  for (const bracket of CANDIDATE_BRACKETS) {
    const schedule = computeFillToBracketSchedule(userData, { ...taxStrategy, bracketTarget: bracket });
    // Build a userData copy with the candidate strategy applied so the
    // deterministic projection runs against THIS bracket's conversion plan.
    //
    // SPECIAL CASE for 'none': this candidate represents "don't add any
    // conversions". To make it an honest baseline to compare the other
    // candidates against, we strip the taxStrategy entirely so the user's
    // existing `spendingWithdrawalOrder` resolves naturally (auto-defaulting
    // to 'brokerage_first' when no conversion events exist, 'bracket_aware'
    // when they do). The other candidates (12/22/24%) DO force bracket_aware
    // spending — which is the strategy's signature — so a "switching to a
    // strategy" choice is fairly compared against "stay where you are."
    //
    // Without this special-case, the 'none' candidate forces bracket_aware
    // too, making it a hidden change from the user's status quo. The user
    // sees the optimizer "improve" by switching spending order — but
    // attributes that improvement to a non-existent conversion schedule.
    // Engine no longer reads `taxStrategy`. Inject the candidate's schedule as
    // synthetic conversion events for non-'none' candidates; force bracket_aware
    // spending order to match the strategy's signature. The 'none' candidate
    // strips conversion events entirely and leaves spending order to the
    // content-aware default — that's the true "stay where you are" baseline.
    // Non-'none' candidates: keep manual + user-detached conversions (those
    // survive Apply per the replace-only-generated policy) and append the
    // candidate's generator-produced schedule. Stripping ALL conversions here
    // would understate the candidate's score whenever the user has manual
    // conversions in the scenario.
    const candidateUserData: UserData = bracket === 'none'
      ? userData
      : {
          ...userData,
          incomeEvents: [
            ...userData.incomeEvents.filter((e) => !isGeneratorProducedConversion(e)),
            ...buildStrategyConversionEvents(userData, schedule),
          ],
          spendingWithdrawalOrder: 'bracket_aware',
        };
    const projection = runDeterministicProjection(candidateUserData);
    const score = scoreProjection(projection, objective);
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
 * Phase 3b scoring:
 *  - `'max_median_terminal_wealth'` (default): start-of-last-year portfolio
 *    balance from the projection's path. We use start-of-last-year rather
 *    than a true end-of-plan because the simulation engine doesn't capture
 *    end-of-last-year in the path array; for COMPARING strategies across
 *    the same horizon, this is bit-for-bit equivalent (both candidates'
 *    last-year start-balance reflects their full-horizon outcome).
 *  - `'min_lifetime_tax'`: negative sum of totalTax across breakdowns.
 *    Maximizing the negative = minimizing the tax.
 *  - `'max_floor'`: not implementable from deterministic alone (it needs
 *    the 10th-percentile MC path). Falls back to terminal wealth for
 *    Phase 3b; full MC scoring is a future refinement.
 *  - `'max_lifetime_consumption'`: spending isn't tier-aware in this codebase,
 *    so totalSpendingNet is exogenous (same across all strategies). Falls
 *    back to terminal wealth.
 */
export function scoreProjection(
  projection: ReturnType<typeof runDeterministicProjection>,
  objective: StrategyObjective,
): number {
  switch (objective) {
    case 'min_lifetime_tax': {
      let sum = 0;
      for (const b of projection.breakdowns) sum += b.totalTax;
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
