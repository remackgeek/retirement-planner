import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import { calculateNetFromGross } from './TaxCalculator';
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
    const stateTaxRate = getStateTaxRate(userData, year);
    const { otherTaxableGross } = baselineOrdinaryGross(userData, year, inflationRate);

    // Incremental federal+state tax of adding the conversion to ordinary gross.
    // SS taxability interactions are ignored here — the Impact Preview is a
    // quick estimate, not a full tax sim.
    const baseGross = Math.max(0, otherTaxableGross);
    const withConvGross = baseGross + convAmount;
    const baseNet = baseGross > 0
      ? calculateNetFromGross(baseGross, stateTaxRate, userData.filingStatus, age, year, userData.spouseAge)
      : 0;
    const withConvNet = calculateNetFromGross(
      withConvGross,
      stateTaxRate,
      userData.filingStatus,
      age,
      year,
      userData.spouseAge,
    );
    const baseTax = baseGross - baseNet;
    const withConvTax = withConvGross - withConvNet;
    const incrementalTax = Math.max(0, withConvTax - baseTax);

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
  const rmdAge = 73;
  const yearsFromNowToRmd = rmdAge - userData.currentAge;
  let rmdReductionAt73 = 0;
  if (yearsFromNowToRmd >= 0) {
    const balances = initialAccountBalances(userData);
    const initialTrad = userData.accounts
      .filter((a) => a.type === 'traditional')
      .reduce((s, a) => s + (balances[a.id] ?? 0), 0);

    // Compound forward, subtracting each year's conversion (if active) at year-end.
    let tradWithConv = initialTrad;
    let tradNoConv = initialTrad;
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

  return {
    firstYearTax,
    totalTaxOverConversion,
    rmdReductionAt73,
    projectedRothAtEndOfPlan,
  };
}
