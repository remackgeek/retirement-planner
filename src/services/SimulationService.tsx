import type { UserData } from '../types/UserData';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
} from './TaxCalculator';

// State tax rates (from user's table, converted to decimal)
export const STATE_TAX_RATES: Record<string, number> = {
  Alabama: 0.05,
  Alaska: 0.0,
  Arizona: 0.025,
  Arkansas: 0.039,
  California: 0.08,
  Colorado: 0.044,
  Connecticut: 0.06,
  Delaware: 0.066,
  Florida: 0.0,
  Georgia: 0.0539,
  Hawaii: 0.079,
  Idaho: 0.057,
  Illinois: 0.0495,
  Indiana: 0.03,
  Iowa: 0.038,
  Kansas: 0.0558,
  Kentucky: 0.04,
  Louisiana: 0.03,
  Maine: 0.0675,
  Maryland: 0.05,
  Massachusetts: 0.05,
  Michigan: 0.0425,
  Minnesota: 0.068,
  Mississippi: 0.044,
  Missouri: 0.047,
  Montana: 0.059,
  Nebraska: 0.052,
  Nevada: 0.0,
  'New Hampshire': 0.0,
  'New Jersey': 0.053,
  'New Mexico': 0.047,
  'New York': 0.055,
  'North Carolina': 0.0425,
  'North Dakota': 0.0195,
  Ohio: 0.0275,
  Oklahoma: 0.0475,
  Oregon: 0.0875,
  Pennsylvania: 0.0307,
  'Rhode Island': 0.0475,
  'South Carolina': 0.062,
  'South Dakota': 0.0,
  Tennessee: 0.0,
  Texas: 0.0,
  Utah: 0.0455,
  Vermont: 0.066,
  Virginia: 0.0575,
  Washington: 0.0,
  'West Virginia': 0.0482,
  Wisconsin: 0.053,
  Wyoming: 0.0,
  'Washington, DC': 0.085,
};

// Derive log-normal mu/sigma from arithmetic mean return and standard deviation.
// For a log-normal where (1+r) ~ LogNormal(mu, sigma):
//   E[1+r] = exp(mu + sigma²/2) = 1 + mean  →  mu = ln(1+mean) - sigma²/2
//   Var[1+r] / E[1+r]² = exp(sigma²) - 1    →  sigma = sqrt(ln(1 + stdDev²/(1+mean)²))
function lognormalParams(mean: number, stdDev: number): { mu: number; sigma: number } {
  const sigma = Math.sqrt(Math.log(1 + (stdDev * stdDev) / ((1 + mean) * (1 + mean))));
  const mu = Math.log(1 + mean) - (sigma * sigma) / 2;
  return { mu, sigma };
}

// Helper function to generate a standard normal random variable (Box-Muller transform)
function standardNormalRandom(random: () => number = Math.random): number {
  let u = 0,
    v = 0;
  while (u === 0) u = random(); // Converting [0,1) to (0,1)
  while (v === 0) v = random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate a single year's log-normal return factor (1 + r)
function generateReturnFactor(
  mean: number,
  stdDev: number,
  random: () => number = Math.random
): number {
  const { mu, sigma } = lognormalParams(mean, stdDev);
  const normalSample = mu + sigma * standardNormalRandom(random);
  return Math.exp(normalSample);
}

function getStateTaxRate(userData: UserData, year: number): number {
  const timeline = userData.stateTimeline;
  let effectiveState = timeline[0].state;
  for (let i = 1; i < timeline.length; i++) {
    const startYear = timeline[i].startYear;
    if (startYear != null && year >= startYear) {
      effectiveState = timeline[i].state;
    } else {
      break;
    }
  }
  return STATE_TAX_RATES[effectiveState] || 0;
}



export interface AnnualCashFlowBreakdown {
  ssGross: number;
  otherTaxableGross: number;
  afterTaxIncome: number;
  totalGrossIncome: number;
  ssTaxableAmount: number;
  baseSpendingNet: number;
  otherSpendingGoalsNet: number;
  totalSpendingNet: number;
  portfolioWithdrawal: number;
  totalTax: number;
  netCashFlow: number;
}

function accumulateIncome(
  userData: UserData,
  year: number,
  inflationRate: number
): { ssGross: number; otherTaxableGross: number; afterTaxIncome: number } {
  let afterTaxIncome = 0;
  let ssGross = 0;
  let otherTaxableGross = 0;

  userData.incomeEvents.forEach((event) => {
    const ownerAge = (event.owner === 'spouse' && userData.spouseAge !== null)
      ? userData.spouseAge
      : userData.currentAge;
    const startYear =
      userData.referenceYear + (event.startAge - ownerAge);
    const endYear = event.endAge
      ? userData.referenceYear + (event.endAge - ownerAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;

    let shouldInclude = false;
    if (event.isOneTime) {
      shouldInclude = year === startYear;
    } else {
      shouldInclude = year >= startYear && year <= endYear;
    }

    if (shouldInclude) {
      let amount = event.amount;
      if (event.colaType === 'inflation_adjusted') {
        let baseYear = userData.referenceYear;
        if (event.type === 'social_security' && event.ssAmountBasis === 'future') {
          baseYear = startYear;
        }
        const yearsFromBase = year - baseYear;
        if (yearsFromBase > 0) {
          amount *= Math.pow(1 + inflationRate, yearsFromBase);
        }
      }

      if (event.type === 'social_security' && event.ssHaircutEnabled !== false && year >= 2034) {
        const reduction = (event.ssHaircutPercent ?? 23) / 100;
        amount *= (1 - reduction);
      }

      if (event.taxStatus === 'after_tax') {
        afterTaxIncome += amount;
      } else if (event.type === 'social_security') {
        ssGross += amount;
      } else {
        otherTaxableGross += amount;
      }
    }
  });

  return { ssGross, otherTaxableGross, afterTaxIncome };
}

function accumulateSpending(
  userData: UserData,
  year: number,
  inflationRate: number
): { baseSpendingNet: number; otherSpendingGoalsNet: number } {
  let baseSpendingNet = 0;
  let otherSpendingGoalsNet = 0;

  userData.spendingGoals.forEach((goal) => {
    const startYear =
      userData.referenceYear + (goal.startAge - userData.currentAge);
    const endYear = goal.endAge
      ? userData.referenceYear + (goal.endAge - userData.currentAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;

    let shouldInclude = false;
    if (goal.isOneTime) {
      shouldInclude = year === startYear;
    } else {
      shouldInclude = year >= startYear && year <= endYear;
    }

    if (shouldInclude) {
      let amount = goal.amount;
      if (goal.inflationAdjusted) {
        const yearsFromReference = year - userData.referenceYear;
        amount *= Math.pow(1 + inflationRate, yearsFromReference);
      }
      if (goal.yearlyDecreasePercent != null) {
        const yearsSinceStart = year - startYear;
        amount *= Math.pow(1 - goal.yearlyDecreasePercent / 100, yearsSinceStart);
      }
      if (goal.type === 'living_expenses') {
        baseSpendingNet += amount;
      } else {
        otherSpendingGoalsNet += amount;
      }
    }
  });

  return { baseSpendingNet, otherSpendingGoalsNet };
}

export function calculateAnnualCashFlow(
  userData: UserData,
  year: number,
  inflationRate: number = 0.03
): AnnualCashFlowBreakdown {
  const income = accumulateIncome(userData, year, inflationRate);
  const spending = accumulateSpending(userData, year, inflationRate);
  const { ssGross, otherTaxableGross, afterTaxIncome } = income;
  const totalSpendingNet = spending.baseSpendingNet + spending.otherSpendingGoalsNet;
  const totalGrossIncome = ssGross + otherTaxableGross + afterTaxIncome;
  const availableCash = afterTaxIncome + ssGross + otherTaxableGross;

  const stateTaxRate = getStateTaxRate(userData, year);
  const age = userData.currentAge + (year - userData.referenceYear);

  // Iterative solver: withdrawal is taxable income, which increases tax,
  // which increases the withdrawal needed
  let withdrawal = Math.max(0, totalSpendingNet - availableCash);
  let totalTax = 0;
  let ssTaxableAmount = 0;

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    ssTaxableAmount = calculateSSTaxableAmount(
      ssGross, otherTaxableGross + withdrawal, userData.filingStatus
    );
    const combinedTaxable = otherTaxableGross + withdrawal + ssTaxableAmount;

    if (combinedTaxable > 0) {
      const netFromTaxable = calculateNetFromGross(
        combinedTaxable, stateTaxRate, userData.filingStatus,
        age, year, userData.spouseAge
      );
      totalTax = combinedTaxable - netFromTaxable;
    } else {
      totalTax = 0;
    }

    const newWithdrawal = Math.max(0, totalSpendingNet + totalTax - availableCash);

    if (Math.abs(newWithdrawal - withdrawal) < 0.01) {
      withdrawal = newWithdrawal;
      break;
    }
    withdrawal = newWithdrawal;
  }

  const netCashFlow = availableCash - totalTax - totalSpendingNet;

  return {
    ssGross,
    otherTaxableGross,
    afterTaxIncome,
    totalGrossIncome,
    ssTaxableAmount,
    baseSpendingNet: spending.baseSpendingNet,
    otherSpendingGoalsNet: spending.otherSpendingGoalsNet,
    totalSpendingNet,
    portfolioWithdrawal: withdrawal,
    totalTax,
    netCashFlow,
  };
}

export function runSimulation(
  userData: UserData,
  random: () => number = Math.random
): {
  probability: number;
  median: number[];
  downside: number[];
  nominal: number[];
  years: number[];
} {
  const currentYear = userData.referenceYear;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const inflationRate = userData.inflationRate;
  const numSims = userData.simulationSettings.numSimulations;
  const { expectedReturn, standardDeviation } = userData.portfolioAssumptions;
  let successCount = 0;
  const portfolioPaths: number[][] = [];

  for (let sim = 0; sim < numSims; sim++) {
    let balance = userData.currentSavings;
    const path: number[] = [];
    let failed = false;
    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;

      // Store starting balance for this year (before any changes)
      const inflationFactor = Math.pow(1 + inflationRate, i);
      path.push(balance / inflationFactor);

      // Calculate unified cash flow for this year
      const cashFlow = calculateAnnualCashFlow(userData, year, inflationRate);
      balance += cashFlow.netCashFlow;
      if (balance < 0) {
        failed = true;
        balance = 0;
      }

      // Apply log-normal portfolio returns at the END of the year
      balance *= generateReturnFactor(expectedReturn, standardDeviation, random);
    }
    portfolioPaths.push(path);
    if (!failed) successCount++;
  }
  const probability = Math.round((successCount / numSims) * 100);
  const sortedPaths = Array.from({ length: totalYears }, (_, i) =>
    portfolioPaths.map((path) => path[i]).sort((a, b) => a - b)
  );
  const median = sortedPaths.map((s) => s[Math.floor(numSims / 2)]);
  const downside = sortedPaths.map((s) => s[Math.floor(numSims * 0.1)]);
  const years = Array.from({ length: totalYears }, (_, i) => currentYear + i);

  // Deterministic nominal path: single pass using expected mean return, no variance
  const nominal: number[] = [];
  {
    let balance = userData.currentSavings;
    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;
      const inflationFactor = Math.pow(1 + inflationRate, i);
      nominal.push(balance / inflationFactor);
      const cashFlow = calculateAnnualCashFlow(userData, year, inflationRate);
      balance += cashFlow.netCashFlow;
      if (balance < 0) balance = 0;
      balance *= 1 + expectedReturn;
    }
  }

  return { probability, median, downside, nominal, years };
}
