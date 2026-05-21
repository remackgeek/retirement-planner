import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
  getFederalBracketIndex,
  getStandardDeduction,
} from './TaxCalculator';
import {
  IRS_UNIFORM_LIFETIME_TABLE,
  initialAccountBalances,
  runDeterministicProjection,
  getEffectiveStateName,
} from './SimulationService';
import { getStateTaxProfile } from '../data/stateTaxProfiles';
import { computeStateTax } from './StateTaxCalculator';

export interface ConversionImpact {
  firstYearTax: number;             // incremental ordinary tax in the first conversion year
  totalTaxOverConversion: number;   // sum of incremental taxes across all active years
  rmdReductionAt73: number;         // $ reduction in the first-year RMD attributable to conversion
  projectedRothAtEndOfPlan: number; // nominal Roth value from conversions at life expectancy
  netPlanValueImpact: number;       // signed delta of plan value at life expectancy (with vs without)
  // True-cap detection: years where Trad balance (after RMD/spending) limited the conversion
  // below the user's requested amount. Rare — only fires when the Trad bucket itself is too small.
  conversionShortfallYears: number;
  conversionShortfallDollars: number;
  // Withholding detection: years where Taxable + RMD-excess couldn't cover the marginal
  // ordinary tax, so a portion of the conversion was withheld for tax (IRS Form 1099-R Box 4).
  // The conversion still executes at the requested Trad pull, but the Roth deposit shrinks
  // by the withheld amount. Mathematically suboptimal vs. paying from Taxable.
  conversionWithheldYears: number;
  conversionWithheldDollars: number;
}

// Incremental conversion tax helper. Uses the federal-only `calculateNetFromGross`
// plus the profile-based `computeStateTax` so the marginal-tax estimate honors
// retirement-income exclusions, SS rules, and graduated state brackets.
function incrementalTaxOnConversion(
  userData: UserData,
  year: number,
  baseOrdinary: number,
  baseSsTaxable: number,
  baseSsGross: number,
  withConvOrdinary: number,
  withConvSsTaxable: number,
  withConvSsGross: number,
  convAmount: number,
  age: number,
  spouseAgeYear: number | null,
): number {
  const stateName = getEffectiveStateName(userData, year);
  const { profile, resolvedKey } = getStateTaxProfile(stateName, year);
  const baseGross = baseOrdinary + baseSsTaxable;
  const withConvGross = withConvOrdinary + withConvSsTaxable;
  const baseFedNet = baseGross > 0
    ? calculateNetFromGross(baseGross, userData.filingStatus, age, year, spouseAgeYear, userData.inflationRate)
    : 0;
  const withConvFedNet = calculateNetFromGross(
    withConvGross, userData.filingStatus, age, year, spouseAgeYear, userData.inflationRate
  );
  const baseFedTax = baseGross - baseFedNet;
  const withConvFedTax = withConvGross - withConvFedNet;
  // The conversion flows as an additional Traditional withdrawal for state-rule
  // purposes (it's taxed as ordinary income from a Traditional account).
  const baseStateRes = computeStateTax(profile, {
    ordinaryGross: baseOrdinary,
    ssTaxableFederal: baseSsTaxable,
    ssGross: baseSsGross,
    traditionalWithdrawal: 0,
    ltcgFromTaxable: 0,
    age, spouseAge: spouseAgeYear, filingStatus: userData.filingStatus,
    year, inflationRate: userData.inflationRate,
  }, resolvedKey);
  const withConvStateRes = computeStateTax(profile, {
    ordinaryGross: baseOrdinary,
    ssTaxableFederal: withConvSsTaxable,
    ssGross: withConvSsGross,
    traditionalWithdrawal: convAmount,
    ltcgFromTaxable: 0,
    age, spouseAge: spouseAgeYear, filingStatus: userData.filingStatus,
    year, inflationRate: userData.inflationRate,
  }, resolvedKey);
  const baseStateTax = baseStateRes.stateOrdinaryTax + baseStateRes.stateLocalitySurcharge;
  const withConvStateTax = withConvStateRes.stateOrdinaryTax + withConvStateRes.stateLocalitySurcharge;
  return Math.max(0, (withConvFedTax + withConvStateTax) - (baseFedTax + baseStateTax));
}

// Compute per-year baseline ordinary taxable income from the *non-conversion*
// events only. Matches the same shape as SimulationService.accumulateIncome but
// intentionally omits conversions (so we can measure their incremental impact).
function baselineOrdinaryGross(
  userData: UserData,
  year: number,
  inflationRate: number,
): { ssGross: number; otherTaxableGross: number } {
  let ssGross = 0;
  let otherTaxableGross = 0;
  for (const event of userData.incomeEvents) {
    if (event.type === 'roth_conversion') continue;

    const ownerAge =
      event.owner === 'spouse' && userData.spouseAge !== null
        ? userData.spouseAge
        : userData.currentAge;
    const startYear = userData.referenceYear + (event.startAge - ownerAge);
    const endYear = event.endAge
      ? userData.referenceYear + (event.endAge - ownerAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;
    const active = event.isOneTime ? year === startYear : year >= startYear && year <= endYear;
    if (!active) continue;

    let amount = event.amount;
    if (event.colaType === 'inflation_adjusted') {
      let baseYear = userData.referenceYear;
      if (event.type === 'social_security' && event.ssAmountBasis === 'future') {
        baseYear = startYear;
      }
      const yearsFromBase = year - baseYear;
      if (yearsFromBase > 0) amount *= Math.pow(1 + inflationRate, yearsFromBase);
    }
    if (event.type === 'social_security' && event.ssHaircutEnabled !== false && year >= 2034) {
      const reduction = (event.ssHaircutPercent ?? 23) / 100;
      amount *= 1 - reduction;
    }

    if (event.taxStatus === 'after_tax') continue; // doesn't affect ordinary gross
    if (event.type === 'social_security') ssGross += amount;
    else otherTaxableGross += amount;
  }
  return { ssGross, otherTaxableGross };
}

// Inflation-adjusted conversion amount for a given year.
function conversionAmountInYear(
  userData: UserData,
  conversion: IncomeEvent,
  year: number,
  inflationRate: number,
): number {
  const ownerAge =
    conversion.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (conversion.startAge - ownerAge);
  const endYear = conversion.endAge
    ? userData.referenceYear + (conversion.endAge - ownerAge)
    : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;
  const active = conversion.isOneTime ? year === startYear : year >= startYear && year <= endYear;
  if (!active) return 0;
  let amount = Math.max(0, conversion.amount);
  if (conversion.colaType === 'inflation_adjusted') {
    const yearsFromBase = year - userData.referenceYear;
    if (yearsFromBase > 0) amount *= Math.pow(1 + inflationRate, yearsFromBase);
  }
  return amount;
}

/**
 * Estimate the impact of a single Roth conversion event against the current
 * scenario baseline. Deterministic — uses the portfolio's blended nominal
 * return for balance projection. Designed for a live dialog preview, not a
 * full Monte Carlo.
 */
export function estimateConversionImpact(
  userData: UserData,
  conversion: IncomeEvent,
): ConversionImpact {
  if (conversion.type !== 'roth_conversion') {
    return {
      firstYearTax: 0,
      totalTaxOverConversion: 0,
      rmdReductionAt73: 0,
      projectedRothAtEndOfPlan: 0,
      netPlanValueImpact: 0,
      conversionShortfallYears: 0,
      conversionShortfallDollars: 0,
      conversionWithheldYears: 0,
      conversionWithheldDollars: 0,
    };
  }

  const inflationRate = userData.inflationRate;
  const { stockReturn, bondReturn } = userData.portfolioAssumptions;
  const totalBalance = userData.accounts.reduce((s, a) => s + a.balance, 0);
  const weightedStockAlloc = userData.accounts.length === 0
    ? 0.6
    : totalBalance > 0
      ? userData.accounts.reduce((s, a) => s + a.stockAllocation * a.balance, 0) / totalBalance
      : userData.accounts.reduce((s, a) => s + a.stockAllocation, 0) / userData.accounts.length;
  const blendedReturn = weightedStockAlloc * stockReturn + (1 - weightedStockAlloc) * bondReturn;

  const ownerAge =
    conversion.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (conversion.startAge - ownerAge);
  const endYearFromEvent = conversion.endAge
    ? userData.referenceYear + (conversion.endAge - ownerAge)
    : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;
  const endYear = conversion.isOneTime ? startYear : endYearFromEvent;
  const lastPlanYear = userData.referenceYear + (userData.lifeExpectancy - userData.currentAge);

  let firstYearTax = 0;
  let totalTaxOverConversion = 0;
  let projectedRothAtEndOfPlan = 0;

  for (let year = startYear; year <= Math.min(endYear, lastPlanYear); year++) {
    const convAmount = conversionAmountInYear(userData, conversion, year, inflationRate);
    if (convAmount <= 0) continue;

    const age = userData.currentAge + (year - userData.referenceYear);
    // Year-adjusted spouse age so the senior add-on (and any other age-keyed
    // tax adjustment) qualifies correctly as the spouse ages through the
    // conversion window. Passing today's `userData.spouseAge` would freeze
    // the spouse's eligibility at the reference year.
    const spouseAgeYear =
      userData.spouseAge !== null
        ? userData.spouseAge + (year - userData.referenceYear)
        : null;
    const { ssGross, otherTaxableGross } = baselineOrdinaryGross(userData, year, inflationRate);

    // Incremental federal+state tax of adding the conversion to ordinary gross.
    // Compute SS taxability for both branches — the conversion increases provisional
    // income, which can push more of SS across the 50%/85% thresholds.
    const baseOrdinary = Math.max(0, otherTaxableGross);
    const withConvOrdinary = baseOrdinary + convAmount;
    const baseSsTaxable = calculateSSTaxableAmount(ssGross, baseOrdinary, userData.filingStatus);
    const withConvSsTaxable = calculateSSTaxableAmount(ssGross, withConvOrdinary, userData.filingStatus);
    const incrementalTax = incrementalTaxOnConversion(
      userData, year,
      baseOrdinary, baseSsTaxable, ssGross,
      withConvOrdinary, withConvSsTaxable, ssGross,
      convAmount, age, spouseAgeYear,
    );

    if (year === startYear) firstYearTax = incrementalTax;
    totalTaxOverConversion += incrementalTax;

    // Project Roth growth of this year's converted amount out to life expectancy.
    const yearsToLastPlan = Math.max(0, lastPlanYear - year);
    projectedRothAtEndOfPlan += convAmount * Math.pow(1 + blendedReturn, yearsToLastPlan);
  }

  // RMD reduction at the first RMD year (age 73) relative to baseline. Project
  // Trad balance to age 73 with and without the conversion schedule. Use the
  // initial account balances as the starting point (ignoring regular withdrawals,
  // which is acceptable for a rough preview).
  const accountBalances = initialAccountBalances(userData);
  const initialTradBalance = userData.accounts
    .filter((a) => a.type === 'traditional')
    .reduce((s, a) => s + (accountBalances[a.id] ?? 0), 0);

  const rmdAge = 73;
  const yearsFromNowToRmd = rmdAge - userData.currentAge;
  let rmdReductionAt73 = 0;
  if (yearsFromNowToRmd >= 0) {
    // Compound forward, subtracting each year's conversion (if active) at year-end.
    let tradWithConv = initialTradBalance;
    let tradNoConv = initialTradBalance;
    for (let i = 0; i < yearsFromNowToRmd; i++) {
      const year = userData.referenceYear + i;
      tradWithConv *= 1 + blendedReturn;
      tradNoConv *= 1 + blendedReturn;
      const convAmount = conversionAmountInYear(userData, conversion, year, inflationRate);
      tradWithConv = Math.max(0, tradWithConv - convAmount);
    }
    const divisor = IRS_UNIFORM_LIFETIME_TABLE[rmdAge] ?? 26.5;
    rmdReductionAt73 = Math.max(0, tradNoConv / divisor - tradWithConv / divisor);
  }

  // Net plan-value impact: run the full deterministic simulation engine twice
  // — once with this conversion event included, once with it stripped — and
  // diff the end-of-plan portfolio balance. This is the same single-path
  // engine that drives the "Deterministic" chart line, so the figure honors
  // the withdrawal waterfall, RMD ordering, SS taxability, IRMAA, NIIT,
  // state LTCG, and conversion-tax sourcing exactly as the live sim does.
  // Skip if the conversion has no amount — both runs would be identical.
  // Two detections from the same `withRun` breakdowns:
  //   - Shortfall: rothConversionRequested > rothConversionGross → Trad balance
  //     itself was insufficient (true cap; very rare).
  //   - Withholding: rothConversionTaxWithheld > 0 → Taxable + RMD-excess couldn't
  //     fund the marginal ordinary tax, so part of the conversion was withheld for
  //     tax. Conversion still executes but Roth deposit shrinks.
  let netPlanValueImpact = 0;
  let conversionShortfallYears = 0;
  let conversionShortfallDollars = 0;
  let conversionWithheldYears = 0;
  let conversionWithheldDollars = 0;
  if (conversion.amount > 0) {
    const withoutEvents = userData.incomeEvents.filter((e) => e.id !== conversion.id);
    const withEvents = [...withoutEvents, conversion];
    const userDataWith: UserData = { ...userData, incomeEvents: withEvents };
    const userDataWithout: UserData = { ...userData, incomeEvents: withoutEvents };
    const withRun = runDeterministicProjection(userDataWith);
    const withoutRun = runDeterministicProjection(userDataWithout);
    const lastIdx = withRun.path.length - 1;
    netPlanValueImpact = withRun.path[lastIdx] - withoutRun.path[lastIdx];
    for (const b of withRun.breakdowns) {
      if (b.rothConversionRequested > b.rothConversionGross + 0.5) {
        conversionShortfallYears += 1;
        conversionShortfallDollars += b.rothConversionRequested - b.rothConversionGross;
      }
      if (b.rothConversionTaxWithheld > 0.5) {
        conversionWithheldYears += 1;
        conversionWithheldDollars += b.rothConversionTaxWithheld;
      }
    }
  }

  return {
    firstYearTax,
    totalTaxOverConversion,
    rmdReductionAt73,
    projectedRothAtEndOfPlan,
    netPlanValueImpact,
    conversionShortfallYears,
    conversionShortfallDollars,
    conversionWithheldYears,
    conversionWithheldDollars,
  };
}

// ---------------------------------------------------------------------------
// Warning heuristics — small pure helpers for the dialog's inline hints.
// Each returns true when the configuration is likely problematic. Save is
// never blocked by these; they're advisory only.
// ---------------------------------------------------------------------------

/**
 * Triggers when first-year nominal conversion amount exceeds 1.5× the sum of
 * `living_expenses` spending goals active in the conversion's start year.
 * Catches the common case where the conversion tax forces large extra
 * Traditional withdrawals.
 */
export function exceedsSpendingHeuristic(
  userData: UserData,
  conversion: IncomeEvent,
): boolean {
  if (conversion.type !== 'roth_conversion') return false;
  if (!(conversion.amount > 0)) return false;
  const ownerAge =
    conversion.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (conversion.startAge - ownerAge);
  const startAgeUser = userData.currentAge + (startYear - userData.referenceYear);
  let livingExpenses = 0;
  for (const goal of userData.spendingGoals) {
    if (goal.type !== 'living_expenses') continue;
    const active = goal.isOneTime
      ? startAgeUser === goal.startAge
      : startAgeUser >= goal.startAge && (goal.endAge === undefined || startAgeUser <= goal.endAge);
    if (!active) continue;
    const period = goal.amountPeriod ?? 'annual';
    const annual = period === 'monthly' ? goal.amount * 12 : goal.amount;
    livingExpenses += annual;
  }
  if (livingExpenses <= 0) return false;
  return conversion.amount > 1.5 * livingExpenses;
}

/**
 * Triggers when adding the conversion to the user's first-year baseline
 * ordinary gross pushes them ≥ 2 federal brackets higher than baseline alone.
 */
export function crossesMultipleBracketsHeuristic(
  userData: UserData,
  conversion: IncomeEvent,
): boolean {
  if (conversion.type !== 'roth_conversion') return false;
  if (!(conversion.amount > 0)) return false;
  const ownerAge =
    conversion.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (conversion.startAge - ownerAge);
  const { otherTaxableGross } = baselineOrdinaryGross(userData, startYear, userData.inflationRate);
  const stdDed = getStandardDeduction(userData.filingStatus, startYear, userData.inflationRate);
  const baseTaxable = Math.max(0, otherTaxableGross - stdDed);
  const withConvTaxable = Math.max(0, otherTaxableGross + conversion.amount - stdDed);
  const baseIdx = getFederalBracketIndex(baseTaxable, userData.filingStatus, startYear, userData.inflationRate);
  const withConvIdx = getFederalBracketIndex(withConvTaxable, userData.filingStatus, startYear, userData.inflationRate);
  return withConvIdx - baseIdx >= 2;
}

/**
 * Triggers when total nominal lifetime conversion (annual × years) exceeds
 * 80% of the current Traditional balance.
 */
export function exceedsMostOfTradHeuristic(
  userData: UserData,
  conversion: IncomeEvent,
): boolean {
  if (conversion.type !== 'roth_conversion') return false;
  if (!(conversion.amount > 0)) return false;
  const totalTrad = userData.accounts
    .filter((a) => a.type === 'traditional')
    .reduce((s, a) => s + a.balance, 0);
  if (totalTrad <= 0) return false;
  const ownerAge =
    conversion.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (conversion.startAge - ownerAge);
  const endYear = conversion.isOneTime
    ? startYear
    : conversion.endAge
      ? userData.referenceYear + (conversion.endAge - ownerAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;
  const years = Math.max(1, endYear - startYear + 1);
  const total = conversion.amount * years;
  return total > 0.8 * totalTrad;
}
