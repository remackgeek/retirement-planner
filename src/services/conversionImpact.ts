import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
  getFederalBracketIndex,
  getStandardDeduction,
} from './TaxCalculator';
import {
  STATE_TAX_RATES,
  IRS_UNIFORM_LIFETIME_TABLE,
  initialAccountBalances,
} from './SimulationService';

export interface ConversionImpact {
  firstYearTax: number;             // incremental ordinary tax in the first conversion year
  totalTaxOverConversion: number;   // sum of incremental taxes across all active years
  rmdReductionAt73: number;         // $ reduction in the first-year RMD attributable to conversion
  projectedRothAtEndOfPlan: number; // nominal Roth value from conversions at life expectancy
  netPlanValueImpact: number;       // signed delta of plan value at life expectancy (with vs without)
}

// Resolve the effective state tax rate for `year` from the user's timeline.
// Duplicated locally to keep the impact helper decoupled from sim internals.
function getStateTaxRate(userData: UserData, year: number): number {
  const timeline = userData.stateTimeline;
  if (!timeline || timeline.length === 0) return 0;
  let effectiveState = timeline[0].state;
  for (let i = 1; i < timeline.length; i++) {
    const startYear = timeline[i].startYear;
    if (startYear != null && year >= startYear) {
      effectiveState = timeline[i].state;
    } else {
      break;
    }
  }
  return STATE_TAX_RATES[effectiveState] ?? 0;
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
  let taxDragAtEndOfPlan = 0;

  for (let year = startYear; year <= Math.min(endYear, lastPlanYear); year++) {
    const convAmount = conversionAmountInYear(userData, conversion, year, inflationRate);
    if (convAmount <= 0) continue;

    const age = userData.currentAge + (year - userData.referenceYear);
    const stateTaxRate = getStateTaxRate(userData, year);
    const { otherTaxableGross } = baselineOrdinaryGross(userData, year, inflationRate);

    // Incremental federal+state tax of adding the conversion to ordinary gross.
    // SS taxability interactions are ignored here — the Impact Preview is a
    // quick estimate, not a full tax sim.
    const baseGross = Math.max(0, otherTaxableGross);
    const withConvGross = baseGross + convAmount;
    const baseNet = baseGross > 0
      ? calculateNetFromGross(baseGross, stateTaxRate, userData.filingStatus, age, year, userData.spouseAge, userData.inflationRate)
      : 0;
    const withConvNet = calculateNetFromGross(
      withConvGross,
      stateTaxRate,
      userData.filingStatus,
      age,
      year,
      userData.spouseAge,
      userData.inflationRate
    );
    const baseTax = baseGross - baseNet;
    const withConvTax = withConvGross - withConvNet;
    const incrementalTax = Math.max(0, withConvTax - baseTax);

    if (year === startYear) firstYearTax = incrementalTax;
    totalTaxOverConversion += incrementalTax;
    // Conversion tax pulls from the taxable account first (per the withdrawal
    // waterfall); track its forgone growth out to end of plan.
    taxDragAtEndOfPlan += incrementalTax * Math.pow(1 + blendedReturn, Math.max(0, lastPlanYear - year));

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

  // Net plan-value impact: project Traditional + Roth balances all the way to
  // life expectancy under both branches (with conversions vs without), honoring
  // RMDs after age 73 in each branch. Apply an estimated effective tax rate to
  // remaining Traditional balances at end-of-plan so pre-tax dollars are
  // compared apples-to-apples with tax-free Roth dollars. The opportunity cost
  // of conversion tax paid from taxable accounts is captured via
  // `taxDragAtEndOfPlan` and subtracted below.
  let tradWithConvFull = initialTradBalance;
  let tradNoConvFull = initialTradBalance;
  let rothFromConv = 0;
  const yearsToEnd = Math.max(0, lastPlanYear - userData.referenceYear);
  const rmdMaxAge = 120;
  // Iterate inclusive of `lastPlanYear` so the final-year conversion is reflected
  // in rothFromConv / tradWithConvFull, matching the tax-loop bounds above.
  for (let i = 0; i <= yearsToEnd; i++) {
    const year = userData.referenceYear + i;
    const ageThisYear = userData.currentAge + i;
    tradWithConvFull *= 1 + blendedReturn;
    tradNoConvFull *= 1 + blendedReturn;
    rothFromConv *= 1 + blendedReturn;
    const convAmount = conversionAmountInYear(userData, conversion, year, inflationRate);
    if (convAmount > 0) {
      tradWithConvFull = Math.max(0, tradWithConvFull - convAmount);
      rothFromConv += convAmount;
    }
    if (ageThisYear >= 73) {
      const lookupAge = Math.min(ageThisYear, rmdMaxAge);
      const divisor = IRS_UNIFORM_LIFETIME_TABLE[lookupAge] ?? 26.5;
      const rmdWith = tradWithConvFull / divisor;
      const rmdNo = tradNoConvFull / divisor;
      tradWithConvFull = Math.max(0, tradWithConvFull - rmdWith);
      tradNoConvFull = Math.max(0, tradNoConvFull - rmdNo);
    }
  }
  // Effective tax rate proxy for end-of-plan Traditional balance: the average
  // rate the user's *baseline* (non-conversion) ordinary income would pay at
  // conversion start, including the IRS provisional-income taxable fraction of
  // Social Security. This represents the rate the trad-no-conversion side
  // would face on future withdrawals; using the conversion's own marginal rate
  // would make conversion neutral by construction.
  const baseAtStart = baselineOrdinaryGross(userData, startYear, inflationRate);
  const ssTaxableAtStart = calculateSSTaxableAmount(
    baseAtStart.ssGross,
    baseAtStart.otherTaxableGross,
    userData.filingStatus,
  );
  const baseGrossAtStart = baseAtStart.otherTaxableGross + ssTaxableAtStart;
  const startAge_ = userData.currentAge + (startYear - userData.referenceYear);
  const baseNetAtStart = baseGrossAtStart > 0
    ? calculateNetFromGross(
        baseGrossAtStart,
        getStateTaxRate(userData, startYear),
        userData.filingStatus,
        startAge_,
        startYear,
        userData.spouseAge,
        userData.inflationRate
      )
    : 0;
  const effRate = baseGrossAtStart > 0
    ? Math.min(0.4, Math.max(0, (baseGrossAtStart - baseNetAtStart) / baseGrossAtStart))
    : 0.22;
  const netPlanValueImpact =
    rothFromConv +
    tradWithConvFull * (1 - effRate) -
    tradNoConvFull * (1 - effRate) -
    taxDragAtEndOfPlan;

  return {
    firstYearTax,
    totalTaxOverConversion,
    rmdReductionAt73,
    projectedRothAtEndOfPlan,
    netPlanValueImpact,
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
