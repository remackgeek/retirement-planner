/**
 * Synthetic-event factory shared by tax-strategy modules.
 *
 * Both TaxStrategyFramework (Fixed-fallback for auto_bracket/optimize,
 * Fill-to-bracket injection) and OptimizeStrategy (coordinate-descent
 * candidate evaluation) need to convert a `PerYearStrategyDecision` into a
 * synthetic `roth_conversion` income event for the engine. Centralizing the
 * factory here ensures the two paths can't drift on event shape, COLA, or
 * id-prefix conventions.
 *
 * No upstream strategy-module imports — this file is a leaf so the call
 * sites can depend on it without creating import cycles.
 */

import type { UserData } from '../../types/UserData';
import type { PerYearStrategyDecision } from './types';
import type { IncomeEvent } from '../../types/IncomeEvent';

/**
 * Prefix marker for synthetic conversion events created by AutoBracket /
 * Optimize during *candidate evaluation* (these never reach persisted
 * scenario state — they live only inside `runDeterministicProjection` calls
 * during scoring). The fingerprint/cache system that originally consumed
 * this prefix is gone; it now serves as a debug aid and as the signal
 * `isGeneratorProducedConversion` uses to recognize transient candidates
 * during candidate-eval (in addition to the user-facing
 * `meta.generatedBy` provenance on Applied wizard events).
 */
export const STRATEGY_CONVERSION_ID_PREFIX = 'strategy-conv-';

/**
 * Build a single synthetic conversion event for one year of a strategy's
 * decision vector. Returns null when the conversion amount is zero or
 * negative (the engine treats absent events as zero-conversion, so injecting
 * a zero event is just clutter).
 *
 * Semantics:
 *  - `startAge === endAge` (the year-derived age) marks this as a one-time
 *    event; `isOneTime: true` is set explicitly so any future change to
 *    `eventActiveInYear` that begins to consult the flag treats these
 *    events correctly.
 *  - `colaType: 'fixed'` — strategy-emitted amounts are already in nominal
 *    dollars for the target year (computed from the year's inflated bracket
 *    ceiling). The engine must NOT apply additional COLA.
 *  - `taxStatus: 'before_tax'` — conversion contributes to ordinary income
 *    for the year as the engine expects.
 */
export function createStrategyConversionEvent(
  userData: UserData,
  decision: PerYearStrategyDecision,
): IncomeEvent | null {
  if (decision.conversionAmount <= 0) return null;
  const startAge = userData.currentAge + (decision.year - userData.referenceYear);
  return {
    id: `${STRATEGY_CONVERSION_ID_PREFIX}${decision.year}`,
    type: 'roth_conversion',
    name: `Strategy conversion ${decision.year}`,
    amount: decision.conversionAmount,
    startAge,
    endAge: startAge,
    isOneTime: true,
    taxStatus: 'before_tax',
    colaType: 'fixed',
  } as IncomeEvent;
}

/**
 * Build the synthetic-event array for a full schedule. Filters zero-amount
 * years (`createStrategyConversionEvent` returns null for those).
 */
export function buildStrategyConversionEvents(
  userData: UserData,
  decisions: PerYearStrategyDecision[],
): IncomeEvent[] {
  const events: IncomeEvent[] = [];
  for (const d of decisions) {
    const e = createStrategyConversionEvent(userData, d);
    if (e !== null) events.push(e);
  }
  return events;
}

/**
 * Predicate: an event is a *generator-produced* roth conversion (NOT the user's
 * manual / edited-detached conversion). Candidate-evaluation in
 * AutoBracket/Optimize should strip these (the candidate schedule replaces
 * them) but preserve manual conversions (Apply preserves them too).
 *
 * Manual events have `meta` undefined or `meta.generatedBy === 'user'`.
 * Strategy-injected events (used in this same module) carry the
 * 'strategy-conv-' id prefix and have no meta — treat them as
 * generator-produced for filtering symmetry.
 */
export function isGeneratorProducedConversion(e: IncomeEvent): boolean {
  if (e.type !== 'roth_conversion') return false;
  if (e.id.startsWith(STRATEGY_CONVERSION_ID_PREFIX)) return true;
  const gb = e.meta?.generatedBy;
  return !!gb && gb !== 'user';
}
