import type { Scenario } from '../types/Scenario';

/**
 * Explicit "Update to current year" for a scenario whose `referenceYear` is
 * behind the calendar.
 *
 * A scenario's `referenceYear` is stamped once at creation and is the anchor for
 * every age→calendar-year mapping (`year = referenceYear + (startAge − ownerAge)`).
 * Income events and spending goals are age-based, so advancing `referenceYear`
 * AND every current age by the same delta keeps each event/goal on the same
 * calendar year — only "which age is today" moves.
 *
 * This transform is never applied implicitly (not on load, import, clone, edit,
 * or the probability write-back). The user triggers it from the stale-plan
 * banner or the sidebar's calendar action — see CLAUDE.md "Plan year".
 *
 * Fields touched: `referenceYear`, `currentAge`, `spouseAge` (when set),
 * `lifeExpectancy` / `spouseLifeExpectancy` only when the roll would otherwise
 * push an age to or past its horizon, and — for `historical_single` only —
 * `historicalStartYear` (so the historical row under each calendar year is
 * preserved; index 0 of that series is pinned to year 0 of the projection).
 * Everything else — the other absolute-year fields (`stateTimeline[].startYear`,
 * `blackSwanEvents[].year`, `ssHaircutYear`), balances, amounts,
 * `lastSuccessProbability` — is untouched here.
 */

export function currentCalendarYear(): number {
  return new Date().getFullYear();
}

/** Years the scenario is behind the calendar; never negative (no backward roll). */
export function getPlanYearDelta(
  scenario: Pick<Scenario, 'referenceYear'>,
  nowYear: number = currentCalendarYear(),
): number {
  if (!Number.isFinite(scenario.referenceYear)) return 0;
  return Math.max(0, nowYear - scenario.referenceYear);
}

export function isStaleScenario(
  scenario: Pick<Scenario, 'referenceYear'>,
  nowYear: number = currentCalendarYear(),
): boolean {
  return getPlanYearDelta(scenario, nowYear) > 0;
}

/** An event/goal that stops contributing once the plan year moves past it. */
export interface PastItem {
  id: string;
  name: string;
  kind: 'income' | 'spending';
  /** Last calendar year the item was active (one-time: its only year). */
  lastYear: number;
}

/** Structured summary of what a roll changes — drives the confirm preview. */
export interface PlanYearChanges {
  fromYear: number;
  toYear: number;
  delta: number;
  currentAge: { from: number; to: number };
  spouseAge: { from: number; to: number } | null;
  /** Set when `lifeExpectancy` had to be raised to stay above the new age. */
  lifeExpectancyBumped: { from: number; to: number } | null;
  spouseLifeExpectancyBumped: { from: number; to: number } | null;
  /** Set when a `historical_single` start year moved with the plan year. */
  historicalStartYear: { from: number; to: number } | null;
  /**
   * Items whose last active calendar year is now before `toYear` (and was not
   * already before `fromYear`): they were active in the saved frame but never
   * fire after the update. Same year math as `eventActiveInYear` /
   * `accumulateSpending` in SimulationService.
   */
  pastItems: PastItem[];
}

export interface RollResult<T extends Scenario> {
  /** The rolled scenario, or the SAME reference when `delta === 0`. */
  scenario: T;
  delta: number;
  changes: PlanYearChanges | null;
}

function collectPastItems(scenario: Scenario, fromYear: number, toYear: number): PastItem[] {
  const out: PastItem[] = [];
  const lastYearOf = (
    startAge: number,
    endAge: number | undefined,
    isOneTime: boolean | undefined,
    ownerAge: number,
  ): number | null => {
    if (isOneTime) return fromYear + (startAge - ownerAge);
    if (endAge) return fromYear + (endAge - ownerAge);
    return null; // ongoing — never falls into the past
  };
  for (const e of scenario.incomeEvents ?? []) {
    const ownerAge =
      e.owner === 'spouse' && scenario.spouseAge != null ? scenario.spouseAge : scenario.currentAge;
    const last = lastYearOf(e.startAge, e.endAge, e.isOneTime, ownerAge);
    if (last != null && last >= fromYear && last < toYear) {
      out.push({ id: e.id, name: e.name, kind: 'income', lastYear: last });
    }
  }
  for (const g of scenario.spendingGoals ?? []) {
    const last = lastYearOf(g.startAge, g.endAge, g.isOneTime, scenario.currentAge);
    if (last != null && last >= fromYear && last < toYear) {
      out.push({ id: g.id, name: g.name, kind: 'spending', lastYear: last });
    }
  }
  return out;
}

/**
 * Pure and idempotent: rolling an already-current scenario returns the same
 * object reference with `delta: 0`, so callers can use identity to detect a
 * no-op and memoized consumers never churn.
 */
export function rollScenarioToYear<T extends Scenario>(
  scenario: T,
  nowYear: number = currentCalendarYear(),
): RollResult<T> {
  const delta = getPlanYearDelta(scenario, nowYear);
  if (delta === 0) return { scenario, delta: 0, changes: null };

  const fromYear = scenario.referenceYear;
  const currentAge = scenario.currentAge + delta;
  const spouseAge = scenario.spouseAge == null ? null : scenario.spouseAge + delta;

  // Horizon is `lifeExpectancy − currentAge + 1` years; keep it ≥ 1 and keep the
  // ScenarioDialog invariant `lifeExpectancy > currentAge` intact.
  let lifeExpectancy = scenario.lifeExpectancy;
  let lifeExpectancyBumped: PlanYearChanges['lifeExpectancyBumped'] = null;
  if (lifeExpectancy <= currentAge) {
    lifeExpectancyBumped = { from: lifeExpectancy, to: currentAge + 1 };
    lifeExpectancy = currentAge + 1;
  }

  // Never null spouseLifeExpectancy — that would silently disable the survivor
  // model. Bump it the same way when it exists and would fall behind.
  let spouseLifeExpectancy = scenario.spouseLifeExpectancy;
  let spouseLifeExpectancyBumped: PlanYearChanges['spouseLifeExpectancyBumped'] = null;
  if (spouseAge != null && spouseLifeExpectancy != null && spouseLifeExpectancy <= spouseAge) {
    spouseLifeExpectancyBumped = { from: spouseLifeExpectancy, to: spouseAge + 1 };
    spouseLifeExpectancy = spouseAge + 1;
  }

  // historical_single pins historical index 0 to projection year 0, so keeping
  // the start year fixed would slide the whole series one row per delta under
  // the calendar. Advance it with the plan year (the generator wraps/clamps
  // past the end of the series, so no upper clamp is needed here).
  // Optional chaining: a sparse/unmigrated record may lack portfolioAssumptions
  // entirely; the roll must not throw on it (it's reachable from the sidebar).
  let portfolioAssumptions = scenario.portfolioAssumptions;
  let historicalStartYear: PlanYearChanges['historicalStartYear'] = null;
  const hsy = portfolioAssumptions?.historicalStartYear;
  if (portfolioAssumptions?.returnModel === 'historical_single' && hsy != null && Number.isFinite(hsy)) {
    historicalStartYear = { from: hsy, to: hsy + delta };
    portfolioAssumptions = { ...portfolioAssumptions, historicalStartYear: hsy + delta };
  }

  const rolled: T = {
    ...scenario,
    referenceYear: nowYear,
    currentAge,
    spouseAge,
    lifeExpectancy,
    spouseLifeExpectancy,
    portfolioAssumptions,
  };

  return {
    scenario: rolled,
    delta,
    changes: {
      fromYear,
      toYear: nowYear,
      delta,
      currentAge: { from: scenario.currentAge, to: currentAge },
      spouseAge: scenario.spouseAge == null ? null : { from: scenario.spouseAge, to: spouseAge! },
      lifeExpectancyBumped,
      spouseLifeExpectancyBumped,
      historicalStartYear,
      pastItems: collectPastItems(scenario, fromYear, nowYear),
    },
  };
}
