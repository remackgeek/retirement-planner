/**
 * Social Security claiming-age sweep.
 *
 * Given a reconstructed PIA + FRA for one owner, this evaluates each candidate
 * claiming age by replacing that owner's SS event with the actuarially-correct
 * benefit (see socialSecurity.ts) and running the existing deterministic
 * projection. It returns the per-age real (year-0) plan final value so the
 * wizard can recommend the age that maximizes plan value.
 *
 * Cheap by design: ≤ 9 deterministic projections (62–70) ≈ tens of ms, so the
 * dialog consumes this synchronously from a `useMemo` — no worker, no spinner.
 * Spending order is auto-selected per projection (the engine's default), exactly
 * as the live chart does it; we deliberately do not pin it, so the numbers match
 * what the user sees elsewhere and the baseline + every candidate are treated
 * identically.
 */
import type { UserData } from '../types/UserData';
import type { IncomeEvent, IncomeEventMeta } from '../types/IncomeEvent';
import { DEFAULT_SS_HAIRCUT_YEAR, DEFAULT_SS_HAIRCUT_PERCENT } from '../types/IncomeEvent';
import { runDeterministicProjection } from './SimulationService';
import { benefitAtAge } from './socialSecurity';

export interface ClaimingAgeResult {
  age: number;
  /** Actuarially-adjusted annual benefit at this claim age, today's dollars. */
  annualBenefit: number;
  /** Real (year-0) plan final value for claiming at this age. */
  terminalReal: number;
  /** Real (year-0) portfolio path for this candidate. */
  path: number[];
}

export interface ClaimingSweepResult {
  results: ClaimingAgeResult[];
  bestAge: number | null;
  /** The owner's current SS claim age from their existing event, if any. */
  currentClaimAge: number | null;
  /** Cumulative inflation factors `[1, 1+r, …]` shared by all candidate paths. */
  inflationFactors: number[];
  /** Real (year-0) path of the scenario *exactly as saved* (the user's
   *  manually-entered SS, untouched). Present only when the owner already has a
   *  saved SS event with a positive amount. Used purely as a stable reference
   *  line on the comparison chart — it does NOT feed the per-age table deltas. */
  enteredPlanPath?: number[];
}

const SWEEP_EVENT_ID = '__ss-sweep__';

/** Options for {@link buildClaimingEvent}. Explicit `haircutEnabled`/`haircutPercent`/
 *  `haircutYear` override the template/defaults (the wizard exposes them as controls);
 *  `meta` is the provenance stamp applied on Apply. */
export interface BuildClaimingOpts {
  haircutEnabled?: boolean;
  haircutPercent?: number;
  haircutYear?: number;
  meta?: IncomeEventMeta;
}

/**
 * Construct an SS income event for `owner` claiming at `claimAge` with
 * `annualBenefit` (today's dollars). Single source of truth shared by the sweep
 * (candidate generation) and the dialog's Apply, so the two never drift.
 *
 * Always emits `ssAmountBasis: 'today'` (PIA is a today's-dollar concept) and
 * inherits `colaType` from `template`. The trust-fund haircut is a per-event set
 * of fields: an explicit `opts.haircutEnabled`/`haircutPercent`/`haircutYear` (from
 * the wizard's controls) wins over the template, which wins over the defaults (on /
 * DEFAULT_SS_HAIRCUT_PERCENT / DEFAULT_SS_HAIRCUT_YEAR). `??` is used so an explicit
 * `false` or `0` is honored.
 */
export function buildClaimingEvent(
  template: IncomeEvent | undefined,
  owner: 'self' | 'spouse',
  claimAge: number,
  annualBenefit: number,
  opts: BuildClaimingOpts = {},
): Omit<IncomeEvent, 'id'> {
  return {
    type: 'social_security',
    owner,
    name: template?.name ?? (owner === 'spouse' ? 'Social Security (Spouse)' : 'Social Security (Self)'),
    amount: annualBenefit,
    startAge: claimAge,
    taxStatus: 'before_tax',
    colaType: template?.colaType ?? 'inflation_adjusted',
    ssAmountBasis: 'today',
    ssHaircutEnabled: opts.haircutEnabled ?? template?.ssHaircutEnabled ?? true,
    ssHaircutPercent: opts.haircutPercent ?? template?.ssHaircutPercent ?? DEFAULT_SS_HAIRCUT_PERCENT,
    ssHaircutYear: opts.haircutYear ?? template?.ssHaircutYear ?? DEFAULT_SS_HAIRCUT_YEAR,
    amountPeriod: template?.amountPeriod ?? 'annual',
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
}

/** Replace (or append) `owner`'s Social Security event in a working UserData copy. */
function withOwnerSSEvent(
  userData: UserData,
  owner: 'self' | 'spouse',
  ssEvent: Omit<IncomeEvent, 'id'>,
): UserData {
  const survivors = userData.incomeEvents.filter(
    (e) => !(e.type === 'social_security' && (e.owner ?? 'self') === owner),
  );
  return { ...userData, incomeEvents: [...survivors, { ...ssEvent, id: SWEEP_EVENT_ID }] };
}

export interface SweepParams {
  owner: 'self' | 'spouse';
  pia: number;
  fraMonths: number;
  ageMin: number;
  ageMax: number;
  /** The owner's existing SS event, used to inherit COLA + report current age. */
  template?: IncomeEvent;
  /** Trust-fund haircut applied to every candidate (from the wizard's controls).
   *  Defaults to on / DEFAULT_SS_HAIRCUT_PERCENT / DEFAULT_SS_HAIRCUT_YEAR when omitted. */
  haircutEnabled?: boolean;
  haircutPercent?: number;
  haircutYear?: number;
}

/**
 * Sweep claiming ages `[ageMin..ageMax]` for one owner and score each by real
 * plan final value. Also computes the current-plan baseline for comparison.
 */
export function optimizeClaimingAge(userData: UserData, params: SweepParams): ClaimingSweepResult {
  const { owner, pia, fraMonths, ageMin, ageMax, template, haircutEnabled, haircutPercent, haircutYear } = params;

  // Each candidate is its own projection. The comparison reference is the
  // candidate at the current claim age (chosen in the dialog), not a separate
  // baseline run — that keeps the per-age deltas internally consistent (the
  // current-age row reads $0) and isolates the claiming-age effect.
  const results: ClaimingAgeResult[] = [];
  let inflationFactors: number[] = [];
  for (let age = ageMin; age <= ageMax; age++) {
    const annualBenefit = benefitAtAge(pia, fraMonths, age);
    const candidate = withOwnerSSEvent(
      userData,
      owner,
      buildClaimingEvent(template, owner, age, annualBenefit, { haircutEnabled, haircutPercent, haircutYear }),
    );
    const proj = runDeterministicProjection(candidate);
    if (inflationFactors.length === 0) inflationFactors = proj.inflation; // shared by all candidates
    results.push({ age, annualBenefit, terminalReal: proj.path.at(-1) ?? 0, path: proj.path });
  }

  let bestAge: number | null = null;
  let bestTerminal = -Infinity;
  for (const r of results) {
    if (r.terminalReal > bestTerminal) {
      bestTerminal = r.terminalReal;
      bestAge = r.age;
    }
  }

  // Project the scenario exactly as saved (untouched SS) for the stable
  // reference line — only when there's a real saved entry to reference.
  const enteredPlanPath =
    template && template.amount > 0 ? runDeterministicProjection(userData).path : undefined;

  return {
    results,
    bestAge,
    currentClaimAge: template?.startAge ?? null,
    inflationFactors,
    enteredPlanPath,
  };
}

/**
 * Breakeven age: the age at which the `later` (delayed-claim) portfolio path
 * overtakes the `earlier` path — the classic SS crossover, expressed against the
 * portfolio rather than cumulative benefits. Returns null when `later` never
 * starts behind then catches up (e.g. when it dominates throughout, or the two
 * are the same plan).
 */
export function findCrossoverAge(
  later: number[],
  earlier: number[],
  planCurrentAge: number,
): number | null {
  const n = Math.min(later.length, earlier.length);
  let wasBehind = false;
  for (let i = 0; i < n; i++) {
    if (later[i] < earlier[i]) {
      wasBehind = true;
    } else if (wasBehind && later[i] >= earlier[i]) {
      return planCurrentAge + i;
    }
  }
  return null;
}
