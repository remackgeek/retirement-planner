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
 *  - Does NOT respect IRMAA cliffs (Design A is naive; upgrade path = Design B).
 *  - Does NOT model funding-availability for the marginal tax (Cash / Taxable /
 *    RMD-excess). The engine's existing conv-tax sourcing handles that.
 *  - Does NOT cap below zero — when the user's baseline already exceeds the
 *    target bracket (e.g., high pension income), conversion = 0 for that year.
 */

import type { UserData } from '../../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision, BracketTarget } from './types';
import type { IncomeEvent } from '../../types/IncomeEvent';
import {
  getBracketCeilingTaxableIncome,
  getStandardDeduction,
  getUsualSeniorExtra,
  getNumQualifyingSeniors,
  calculateSSTaxableAmount,
} from '../TaxCalculator';

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
    const spouseAge = userData.spouseAge !== null ? userData.spouseAge + i : null;

    const topOfBracket = getBracketCeilingTaxableIncome(
      userData.filingStatus, bracketIndex, year, inflationRate
    );
    // Top bracket is Infinity — nothing to "fill into". Emit 0.
    if (!isFinite(topOfBracket)) {
      decisions.push({ year, conversionAmount: 0 });
      continue;
    }

    const baselineOrdinaryGross = computeBaselineOrdinaryGrossForYear(userData, year, i);
    const stdDed = getStandardDeduction(userData.filingStatus, year, inflationRate);
    const numQualifying = getNumQualifyingSeniors(userData.filingStatus, age, spouseAge);
    const seniorExtra = getUsualSeniorExtra(userData.filingStatus, year, numQualifying, inflationRate);
    const totalDed = stdDed + seniorExtra;

    const ssGross = sumSSForYear(userData, year, i);
    const otherOrdinary = baselineOrdinaryGross - ssGross; // strip SS; feed into provisional separately

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
        ? calculateSSTaxableAmount(ssGross, otherOrdinary + convAmount, userData.filingStatus)
        : 0;
      const baselineTaxable = Math.max(0, otherOrdinary + ssTaxable - totalDed);
      convAmount = Math.max(0, topOfBracket - baselineTaxable);
      // Converged when the conversion amount stops moving (dollar-precision).
      if (Math.abs(convAmount - prevConv) < 1) break;
    }
    decisions.push({ year, conversionAmount: convAmount });
  }

  return decisions;
}

/**
 * Year-N ordinary gross income WITHOUT any conversion contribution. Sums
 * wage_income, pension_income, annuity_income, rental_income, other_income,
 * sale_of_property, work_during_retirement, social_security (gross), minus
 * any pre-tax retirement contributions. Mirrors the contribution to
 * `otherTaxableGross + ssGross` that `accumulateIncome` builds, but without
 * the contribution-cap pass or per-event audit overhead.
 */
function computeBaselineOrdinaryGrossForYear(
  userData: UserData,
  year: number,
  yearIndex: number,
): number {
  const age = userData.currentAge + yearIndex;
  const spouseAge = userData.spouseAge !== null ? userData.spouseAge + yearIndex : null;
  let sum = 0;
  for (const e of userData.incomeEvents) {
    if (e.type === 'roth_conversion') continue;
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

function sumSSForYear(userData: UserData, year: number, yearIndex: number): number {
  const age = userData.currentAge + yearIndex;
  const spouseAge = userData.spouseAge !== null ? userData.spouseAge + yearIndex : null;
  let sum = 0;
  for (const e of userData.incomeEvents) {
    if (e.type !== 'social_security') continue;
    if (!eventActiveAtAge(e, age, spouseAge)) continue;
    sum += inflateAmount(e.amount, year, userData.referenceYear, userData.inflationRate, getColaType(e));
  }
  return sum;
}

function eventActiveAtAge(e: IncomeEvent, age: number, spouseAge: number | null): boolean {
  // Per-owner events use spouse's age when owner === 'spouse'. Most income
  // events default to self.
  const ownerAge = e.owner === 'spouse' && spouseAge !== null ? spouseAge : age;
  if (e.startAge !== undefined && ownerAge < e.startAge) return false;
  if (e.endAge !== undefined && ownerAge > e.endAge) return false;
  // isOneTime events fire only at startAge — equivalent to startAge === endAge.
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
