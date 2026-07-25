/**
 * Design A — Rule-driven fill-to-bracket strategy.
 *
 * For each year of the plan, computes the Roth conversion amount that fills the
 * configured federal bracket (12%, 22%, 24%) AFTER all other ordinary income
 * (wages, pensions, Social Security taxable portion, RMD-as-taxable-income).
 *
 * The conversion amount is taxable income, so:
 *
 *   convAmount = top_of_target_bracket_taxable_income
 *              − (baseline_ordinary_taxable_income)
 *
 * where `baseline_ordinary_taxable_income` is the year's ordinary gross MINUS
 * the standard deduction (federal-only — state deductions don't matter for
 * federal-bracket targeting).
 *
 * Caveats / blind spots (acceptable for Design A; addressed by Design B/C):
 *
 *  - Does NOT consult the Traditional balance. If the user has $0 Trad, this
 *    still emits conversion amounts; the simulation engine then caps the
 *    conversion at `tradAvailForConv` per year. So the schedule we emit is
 *    "what you'd convert if you had it" — the engine handles the cap.
 *  - Models the SS taxable-portion feedback via a small fix-point iteration
 *    (up to 4 passes; converges in 1–2 in practice because the SS taxable
 *    portion is bounded at 85%). Each pass recomputes `ssTaxable` using
 *    `otherOrdinary + tentative_conversion` as the provisional-income basis,
 *    then re-fills to the bracket ceiling. Without this loop a high
 *    conversion in an SS-claiming year would push SS into the 85% tier and
 *    silently over-fill the bracket.
 *  - IRMAA cliffs: capped by default (`respectIrmaaNiitCliffs` treats undefined
 *    as ON) — the per-year fill is capped so MAGI stays under the next IRMAA
 *    tier (year+2 lookback). Conservative — only ever reduces the conversion.
 *    NIIT is NOT capped: it's a marginal 3.8% tax, not a cliff — the engine
 *    prices it in every scored projection (see capConversionForCliffs doc).
 *  - Does NOT model funding-availability for the marginal tax (Cash / Taxable /
 *    RMD-excess). The engine's existing conv-tax sourcing handles that.
 *  - Does NOT cap below zero — when the user's baseline already exceeds the
 *    target bracket (e.g., high pension income), conversion = 0 for that year.
 */

import type { UserData } from '../../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision, BracketTarget } from './types';
import { DEFAULT_END_AGE_CAP } from './types';
import type { IncomeEvent } from '../../types/IncomeEvent';
import {
  getBracketCeilingTaxableIncome,
  getStandardDeduction,
  getUsualSeniorExtra,
  getNumQualifyingSeniors,
  calculateSSTaxableAmount,
} from '../TaxCalculator';
import { nextIrmaaTierCeiling, irmaaTierCeilings } from '../IRMAA';
import { survivorContextForYearOffset } from '../deathModel';

/** Read `taxStatus` from an event, with a 'before_tax' default for events that
 *  don't declare one (most income types). Centralizes the optional-field
 *  access so callers don't need `as any`. */
function getTaxStatus(e: IncomeEvent): 'before_tax' | 'after_tax' {
  // `taxStatus` is present on most event types but is typed as part of each
  // discriminated union member; reading it generically requires a single
  // narrowing helper rather than a per-type switch in every consumer.
  const v = (e as { taxStatus?: 'before_tax' | 'after_tax' }).taxStatus;
  return v === 'after_tax' ? 'after_tax' : 'before_tax';
}

/** Read `colaType` from an event, defaulting to 'fixed' (no indexing). */
function getColaType(e: IncomeEvent): 'fixed' | 'inflation_adjusted' | undefined {
  return (e as { colaType?: 'fixed' | 'inflation_adjusted' }).colaType;
}

/** Read `contributionType` from a retirement_contribution event. */
function getContributionType(e: IncomeEvent): string | undefined {
  if (e.type !== 'retirement_contribution') return undefined;
  return (e as { contributionType?: string }).contributionType;
}

// Eager imports from SimulationService would create a circular dependency
// (SimulationService imports the strategy framework which imports this file).
// Instead, we re-implement the inflate / accumulate logic minimally for the
// scheduler's purposes. `accumulateIncome` does richer work (event-by-event
// breakdowns, contribution caps); we only need a per-year "what's the
// non-conversion ordinary baseline" view.

const BRACKET_INDEX: Record<BracketTarget, number> = {
  none: -1,
  '12_percent': 1,
  '22_percent': 2,
  '24_percent': 3,
};

export function computeFillToBracketSchedule(
  userData: UserData,
  taxStrategy: TaxStrategy,
): PerYearStrategyDecision[] {
  const target: BracketTarget = taxStrategy.bracketTarget ?? '12_percent';
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const endAgeCap = taxStrategy.endAgeCap ?? DEFAULT_END_AGE_CAP;

  // 'none' yields zero-amount entries per year (not an empty vector). Empty
  // would cause downstream consumers (Optimize's coordinate descent) to skip
  // the year loop entirely; explicit zeros let them probe non-zero candidates.
  // The strategy framework's `injectSyntheticConversions` filters zero-amount
  // years out, so no synthetic events are created — the engine sees no
  // conversions, as intended.
  if (target === 'none') {
    const decisions: PerYearStrategyDecision[] = [];
    for (let i = 0; i < totalYears; i++) {
      decisions.push({ year: userData.referenceYear + i, conversionAmount: 0 });
    }
    return decisions;
  }

  const bracketIndex = BRACKET_INDEX[target];
  const inflationRate = userData.inflationRate;
  const decisions: PerYearStrategyDecision[] = [];

  for (let i = 0; i < totalYears; i++) {
    const year = userData.referenceYear + i;
    const age = userData.currentAge + i;
    // Survivor context (one death-model build per year). `spouseAge` collapses
    // to null after the spouse's death — the deceased no longer counts as a
    // qualifying senior or a Medicare enrollee. `filingStatus` is MFJ through
    // the year of the first death, single after (the widow's penalty): using
    // the static userData.filingStatus here filled to MFJ ceilings (~2× the
    // survivor's) and capped against MFJ IRMAA tiers for post-death years, so a
    // generated schedule could overshoot the survivor's bracket AND cross their
    // single-filer IRMAA tier despite the cliff toggle being ON.
    const { deceased, spouseAge, filingStatus } = survivorContextForYearOffset(userData, i);

    // End-age cap: past the cap, owner-lifetime conversion arbitrage is
    // essentially exhausted; emit 0 so the vector length stays totalYears
    // (Optimize's coordinate descent expects fixed-length vectors) but no
    // synthetic conversion is created. The wizard generates self-owned
    // conversion events (handleWizApply in RothConversionDialog defaults to
    // self), so the cap applies to **self's age**, not the younger spouse's.
    // Using min(age, spouseAge) would let self-owned conversions fire past
    // the cap whenever the spouse is still younger — pulling from self's
    // past-cap Trad. If/when per-owner schedules are added, this check
    // should check the owner's age via PerYearStrategyDecision.owner.
    if (age > endAgeCap) {
      decisions.push({ year, conversionAmount: 0 });
      continue;
    }

    // Self dead, spouse survives: the wizard's conversions are self-owned
    // events, and the engine terminates a deceased owner's conversion events
    // at their death — emitting a non-zero amount here would schedule
    // conversions that can never execute.
    if (deceased === 'self') {
      decisions.push({ year, conversionAmount: 0 });
      continue;
    }

    const topOfBracket = getBracketCeilingTaxableIncome(
      filingStatus, bracketIndex, year, inflationRate
    );
    // Top bracket is Infinity — nothing to "fill into". Emit 0.
    if (!isFinite(topOfBracket)) {
      decisions.push({ year, conversionAmount: 0 });
      continue;
    }

    const otherOrdinary = computeBaselineOrdinaryGrossForYear(userData, year, i);
    const stdDed = getStandardDeduction(filingStatus, year, inflationRate);
    const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);
    const seniorExtra = getUsualSeniorExtra(filingStatus, year, numQualifying, inflationRate);
    const totalDed = stdDed + seniorExtra;

    const ssGross = sumSSForYear(userData, year, i);

    // SS-feedback fix-point (C2). A conversion lifts ordinary income, which
    // can push provisional income across the 50% / 85% SS-taxable thresholds,
    // raising taxable income above the bracket ceiling. We iterate a few
    // times: pick a conversion using the current ssTaxable estimate, then
    // recompute ssTaxable with the conversion included in the provisional
    // calc. Two passes capture nearly all the feedback (SS taxable portion
    // is bounded at 85% so the loop converges fast); we cap at 4 passes as
    // a safety net.
    let convAmount = 0;
    let ssTaxable = 0;
    for (let iter = 0; iter < 4; iter++) {
      const prevConv = convAmount;
      // Provisional income for SS taxability uses ordinary + 50% of SS gross,
      // computed against ordinary-INCLUSIVE of any conversion we're about to
      // emit. calculateSSTaxableAmount uses the IRS formula internally.
      ssTaxable = ssGross > 0
        ? calculateSSTaxableAmount(ssGross, otherOrdinary + convAmount, filingStatus)
        : 0;
      const baselineTaxable = Math.max(0, otherOrdinary + ssTaxable - totalDed);
      convAmount = Math.max(0, topOfBracket - baselineTaxable);
      // Converged when the conversion amount stops moving (dollar-precision).
      if (Math.abs(convAmount - prevConv) < 1) break;
    }

    // Optional IRMAA cliff cap (on unless explicitly disabled; see capConversionForCliffs).
    convAmount = capConversionForCliffs(userData, year, i, convAmount);

    decisions.push({ year, conversionAmount: convAmount });
  }

  return decisions;
}

/**
 * Optional IRMAA cliff cap (no-op when `userData.respectIrmaaNiitCliffs` is
 * explicitly `false`). A conversion adds to MAGI roughly dollar-for-dollar; for
 * the 22%/24% targets the fill can reach the IRMAA tiers ($103k single / $206k
 * MFJ, indexed). Caps the conversion so the year's MAGI stays under the next
 * IRMAA tier ceiling — relevant only if a Medicare enrollee exists in year+2
 * (2-year lookback). MAGI baseline proxy is ordinary + SS-taxable (computed
 * inclusive of `convAmount`, mirroring the fill loop).
 *
 * NIIT is deliberately NOT part of this cap. NIIT is a marginal 3.8% tax
 * (`3.8% × min(investment income, MAGI − threshold)`), not a discontinuity:
 * a conversion is not investment income, so crossing the threshold costs at
 * most 3.8% of that year's investment income — often $0 when no brokerage
 * withdrawal happens. The engine prices NIIT inside every scored projection,
 * so the optimizer's score arbitrates it correctly; a hard MAGI cap here only
 * suppressed legitimate 22%/24% fills (MAGI $300–400k) for zero benefit.
 *
 * Shared between `computeFillToBracketSchedule` (per-year fill) and the Optimize
 * coordinate descent (per-candidate cap), so all three backends honor the flag
 * identically — fill/auto/optimize treat the IRMAA cliff as the same hard cap.
 *
 * Known looseness (the cap can under-count MAGI, so a capped conversion may
 * still nudge slightly past a tier): the baseline OMITS (1) forced RMD — a
 * Traditional withdrawal in the real MAGI proxy, so 73+ conversion years are the
 * exposed case — and (2) the Brokerage pull that funds the conversion's own
 * ordinary tax, which adds LTCG to MAGI. Acceptable for a heuristic; the
 * engine's true per-year MAGI still drives the actual IRMAA charged in the
 * simulation. Only ever reduces the conversion.
 */
export function capConversionForCliffs(
  userData: UserData,
  year: number,
  yearIndex: number,
  convAmount: number,
): number {
  // Default ON: practitioner consensus treats IRMAA cliffs as hard caps, not
  // soft scoring penalties. Only an explicit `false` opt-out skips the cap.
  if (userData.respectIrmaaNiitCliffs === false || convAmount <= 0) return convAmount;
  // Survivor-aware: the deceased is not a Medicare enrollee and the survivor
  // files single (single IRMAA tiers ≈ half the MFJ ones — using the static
  // MFJ status here let a post-death conversion cross the survivor's tier
  // despite the cliff toggle being ON). The baseline reflects terminated
  // income + the SS max-rule via the shared helpers.
  const { filingStatus } = survivorContextForYearOffset(userData, yearIndex);
  const ssGross = sumSSForYear(userData, year, yearIndex);
  const otherOrdinary = computeBaselineOrdinaryGrossForYear(userData, year, yearIndex);
  const ssTaxable = ssGross > 0
    ? calculateSSTaxableAmount(ssGross, otherOrdinary + convAmount, filingStatus)
    : 0;
  const magiBaseline = otherOrdinary + ssTaxable;
  let magiCeiling = Infinity;
  if (userData.enableIRMAA !== false && hasMedicareEnrolleeInTwoYears(userData, yearIndex)) {
    magiCeiling = Math.min(
      magiCeiling,
      nextIrmaaTierCeiling(magiBaseline, filingStatus, year + 2, userData.inflationRate),
    );
  }
  return isFinite(magiCeiling) ? Math.min(convAmount, Math.max(0, magiCeiling - magiBaseline)) : convAmount;
}

/**
 * Tier-aware probe candidates for the Optimize descent (consulted only when
 * `respectIrmaaNiitCliffs === false`). For each finite IRMAA tier ceiling,
 * returns the conversion amount that fills the year's MAGI exactly to that
 * ceiling. The descent adds these to its candidate set so a deliberate tier
 * crossing is evaluated at the efficient boundary point (max conversion that
 * still tops out the destination tier) instead of blindly partway through —
 * the engine prices the resulting surcharge (2-year lookback) in the scored
 * projection, so the score arbitrates whether crossing pays.
 *
 * Mirrors `capConversionForCliffs`' MAGI machinery, including the SS-taxable
 * fix-point from the bracket fill (the conversion that lands on a ceiling
 * depends on ssTaxable, which depends on the conversion) and the same
 * RMD-omission looseness — acceptable: these are probes the score arbitrates,
 * not caps. Returns [] when IRMAA is disabled or no Medicare enrollee exists
 * in year+2 — crossing has no priced effect then, so probes would be noise.
 */
export function irmaaTierFillCandidates(
  userData: UserData,
  year: number,
  yearIndex: number,
): number[] {
  if (userData.enableIRMAA === false) return [];
  if (!hasMedicareEnrolleeInTwoYears(userData, yearIndex)) return [];
  // Survivor-aware, mirroring capConversionForCliffs: single tiers after the
  // first death (the enrollee count above is survivor-aware too).
  const { filingStatus } = survivorContextForYearOffset(userData, yearIndex);
  const ssGross = sumSSForYear(userData, year, yearIndex);
  const otherOrdinary = computeBaselineOrdinaryGrossForYear(userData, year, yearIndex);
  const candidates: number[] = [];
  for (const ceiling of irmaaTierCeilings(filingStatus, year + 2, userData.inflationRate)) {
    let conv = 0;
    for (let iter = 0; iter < 4; iter++) {
      const prev = conv;
      const ssTaxable = ssGross > 0
        ? calculateSSTaxableAmount(ssGross, otherOrdinary + conv, filingStatus)
        : 0;
      conv = Math.max(0, ceiling - (otherOrdinary + ssTaxable));
      if (Math.abs(conv - prev) < 1) break;
    }
    if (conv > 0) candidates.push(conv);
  }
  return candidates;
}

/** Will ANY household member be a Medicare enrollee in year+2 (the IRMAA
 *  lookback)? Survivor-aware: a deceased member never enrolls. Shared by the
 *  cliff cap and the tier-fill probes so the two can't disagree on whether an
 *  IRMAA surcharge is even reachable. */
function hasMedicareEnrolleeInTwoYears(userData: UserData, yearIndex: number): boolean {
  const { deceased, spouseAge } = survivorContextForYearOffset(userData, yearIndex);
  const age = userData.currentAge + yearIndex;
  const selfMedicareSoon = deceased !== 'self' && age + 2 >= 65;
  const spouseMedicareSoon = spouseAge !== null && spouseAge + 2 >= 65;
  return selfMedicareSoon || spouseMedicareSoon;
}

/**
 * Year-N ordinary gross income WITHOUT any conversion contribution and WITHOUT
 * Social Security (SS is handled by `sumSSForYear`, whose survivor max-rule
 * would otherwise disagree with a summed-SS baseline). Sums wage_income,
 * pension_income, annuity_income, rental_income, other_income,
 * sale_of_property, work_during_retirement, minus any pre-tax retirement
 * contributions. Mirrors the contribution to `otherTaxableGross` that
 * `accumulateIncome` builds, but without the contribution-cap pass or
 * per-event audit overhead. Survivor-aware: a deceased owner's non-SS income
 * terminates at their death (mirrors `eventActiveInYear`).
 */
function computeBaselineOrdinaryGrossForYear(
  userData: UserData,
  year: number,
  yearIndex: number,
): number {
  const age = userData.currentAge + yearIndex;
  // RAW spouse age (not the survivor-collapsed one): a surviving spouse's
  // events still need their own age to resolve start/end. Events owned by the
  // deceased are removed by the `deceased` filter below instead.
  const spouseAge = userData.spouseAge !== null ? userData.spouseAge + yearIndex : null;
  const { deceased } = survivorContextForYearOffset(userData, yearIndex);
  let sum = 0;
  for (const e of userData.incomeEvents) {
    if (e.type === 'roth_conversion') continue;
    if (e.type === 'social_security') continue;
    if (deceased && (e.owner ?? 'self') === deceased) continue;
    if (!eventActiveAtAge(e, age, spouseAge)) continue;
    const taxStatus = getTaxStatus(e);
    const colaType = getColaType(e);

    if (e.type === 'retirement_contribution') {
      // Pre-tax retirement contributions REDUCE ordinary income (employee
      // deferral). Roth / after-tax do not reduce.
      if (getContributionType(e) === 'pre_tax') {
        const amt = inflateAmount(e.amount, year, userData.referenceYear, userData.inflationRate, colaType);
        sum -= Math.max(0, amt);
      }
      continue;
    }
    if (taxStatus === 'after_tax') continue;
    const amt = inflateAmount(e.amount, year, userData.referenceYear, userData.inflationRate, colaType);
    sum += amt;
  }
  return Math.max(0, sum);
}

/** Year-N Social Security gross. Survivor-aware: after the first death the
 *  survivor keeps the LARGER of the two benefits (max, not sum) — mirrors
 *  `accumulateIncome`'s survivorMode rule in the engine. */
function sumSSForYear(userData: UserData, year: number, yearIndex: number): number {
  const age = userData.currentAge + yearIndex;
  // RAW spouse age: SS is exempt from the death cut (the survivor keeps the
  // larger benefit via the max rule below), so a spouse-owned SS event must
  // still resolve its start age against the spouse's own age.
  const spouseAge = userData.spouseAge !== null ? userData.spouseAge + yearIndex : null;
  const { survivorMode } = survivorContextForYearOffset(userData, yearIndex);
  let sum = 0;
  let max = 0;
  for (const e of userData.incomeEvents) {
    if (e.type !== 'social_security') continue;
    if (!eventActiveAtAge(e, age, spouseAge)) continue;
    const amt = inflateAmount(e.amount, year, userData.referenceYear, userData.inflationRate, getColaType(e));
    sum += amt;
    max = Math.max(max, amt);
  }
  return survivorMode ? max : sum;
}

function eventActiveAtAge(e: IncomeEvent, age: number, spouseAge: number | null): boolean {
  // Per-owner events use spouse's age when owner === 'spouse'. Most income
  // events default to self.
  const ownerAge = e.owner === 'spouse' && spouseAge !== null ? spouseAge : age;
  if (e.startAge !== undefined && ownerAge < e.startAge) return false;
  // isOneTime events fire only at startAge. They carry endAge: undefined, so
  // without this check a one-time inflow (e.g. a property sale) counts as
  // recurring income in every later year — inflating the strategy baseline and
  // letting the default-on IRMAA cliff cap zero out all generated conversions
  // from that age on. Mirrors eventActiveInYear in SimulationService.ts.
  if (e.isOneTime) return ownerAge === e.startAge;
  if (e.endAge !== undefined && ownerAge > e.endAge) return false;
  return true;
}

function inflateAmount(
  amount: number,
  year: number,
  referenceYear: number,
  inflationRate: number,
  colaType: 'fixed' | 'inflation_adjusted' | undefined,
): number {
  // 'fixed' or undefined → no indexing. 'inflation_adjusted' compounds from
  // referenceYear forward at the deterministic inflationRate.
  if (!colaType || colaType === 'fixed') return amount;
  const years = year - referenceYear;
  return amount * Math.pow(1 + inflationRate, Math.max(0, years));
}
