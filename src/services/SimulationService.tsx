import type { UserData } from '../types/UserData';
import {
  calculateNetFromGross,
  calculateGrossIncomeNeeded,
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

function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function getStateTaxRate(userData: UserData): number {
  return STATE_TAX_RATES[userData.state] || 0;
}

function calculateAfterTaxIncome(
  amount: number,
  taxStatus: 'before_tax' | 'after_tax',
  userData: UserData,
  year: number
): number {
  if (taxStatus === 'after_tax') {
    return amount;
  }
  // For before_tax income, amount is gross - calculate net after taxes
  const stateTaxRate = getStateTaxRate(userData);
  return calculateNetFromGross(
    amount,
    stateTaxRate,
    userData.filingStatus,
    userData.currentAge + (year - userData.referenceYear), // Age in this year
    year,
    userData.spouseAge
  );
}

function calculateGrossWithdrawal(
  amount: number,
  userData: UserData,
  year: number
): number {
  // Since spending is specified as before-tax amount, we need to calculate
  // the gross withdrawal needed to achieve this net spending
  const stateTaxRate = getStateTaxRate(userData);
  return calculateGrossIncomeNeeded(
    amount,
    stateTaxRate,
    userData.filingStatus,
    userData.currentAge + (year - userData.referenceYear), // Age in this year
    year,
    userData.spouseAge
  );
}

function getPortfolioReturns(assumptions: UserData['portfolioAssumptions']): {
  mean: number;
  sigma: number;
} {
  if (
    assumptions.riskLevel === 'custom' &&
    assumptions.expectedReturn &&
    assumptions.standardDeviation
  ) {
    return {
      mean: assumptions.expectedReturn,
      sigma: assumptions.standardDeviation,
    };
  }
  const realReturns: Record<string, number> = {
    conservative: 0.03,
    moderate: 0.045,
    high: 0.06,
  };
  const vols: Record<string, number> = {
    conservative: 0.05,
    moderate: 0.1,
    high: 0.15,
  };
  const riskLevel =
    assumptions.riskLevel === 'custom' ? 'moderate' : assumptions.riskLevel; // fallback
  return { mean: realReturns[riskLevel], sigma: vols[riskLevel] };
}

export function calculateAnnualSpending(
  userData: UserData,
  year: number,
  inflationRate: number = 0.03
): number {
  let totalSpending = 0;

  // Retirement spending with inflation adjustment and optional decrease
  const retirementSpending = userData.retirementSpending;
  const retirementStartYear =
    userData.referenceYear +
    (retirementSpending.startAge - userData.currentAge);
  if (year >= retirementStartYear) {
    let annualAmount = retirementSpending.monthlyAmount * 12;

    // Apply inflation adjustment first (retirement spending should keep up with inflation)
    const yearsFromReference = year - userData.referenceYear;
    annualAmount *= Math.pow(1 + inflationRate, yearsFromReference);

    // Then apply optional yearly decrease after inflation
    if (retirementSpending.yearlyDecreasePercent) {
      const yearsSinceStart = year - retirementStartYear;
      annualAmount *= Math.pow(
        1 - retirementSpending.yearlyDecreasePercent / 100,
        yearsSinceStart
      );
    }

    // Gross up for taxes since spending is specified as before-tax amount
    const grossAmount = calculateGrossWithdrawal(annualAmount, userData, year);
    totalSpending += grossAmount;
  }

  // Spending goals
  userData.spendingGoals.forEach((goal) => {
    const startYear =
      userData.referenceYear + (goal.startAge - userData.currentAge);
    const endYear = goal.endAge
      ? userData.referenceYear + (goal.endAge - userData.currentAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;

    let shouldInclude = false;
    if (goal.isOneTime) {
      // One-time goals only occur in the start year
      shouldInclude = year === startYear;
    } else {
      // Ongoing goals occur from start to end year
      shouldInclude = year >= startYear && year <= endYear;
    }

    if (shouldInclude) {
      let amount = goal.amount;
      if (goal.inflationAdjusted) {
        const yearsFromReference = year - userData.referenceYear;
        amount *= Math.pow(1 + inflationRate, yearsFromReference);
      }

      // Gross up for taxes since spending goals are specified as before-tax amounts
      const grossAmount = calculateGrossWithdrawal(amount, userData, year);
      totalSpending += grossAmount;
    }
  });

  return totalSpending;
}

export function calculateAnnualIncome(
  userData: UserData,
  year: number,
  inflationRate: number = 0.03
): number {
  let totalIncome = 0;

  userData.incomeEvents.forEach((event) => {
    const startYear =
      userData.referenceYear + (event.startAge - userData.currentAge);
    const endYear = event.endAge
      ? userData.referenceYear + (event.endAge - userData.currentAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;

    let shouldInclude = false;
    if (event.isOneTime) {
      // One-time events only occur in the start year
      shouldInclude = year === startYear;
    } else {
      // Ongoing events occur from start to end year
      shouldInclude = year >= startYear && year <= endYear;
    }

    if (shouldInclude) {
      let amount = event.amount;
      if (event.colaType === 'inflation_adjusted') {
        const yearsFromReference = year - userData.referenceYear;
        amount *= Math.pow(1 + inflationRate, yearsFromReference);
      }

      // Apply Social Security shortfall reduction starting in 2034
      if (event.type === 'social_security' && year >= 2034) {
        amount *= 0.77; // 23% reduction (77% of scheduled benefits)
      }

      // Apply taxes based on tax status
      const afterTaxAmount = calculateAfterTaxIncome(
        amount,
        event.taxStatus,
        userData,
        year
      );
      totalIncome += afterTaxAmount;
    }
  });

  return totalIncome;
}

export function runSimulation(userData: UserData): {
  probability: number;
  median: number[];
  downside: number[];
  years: number[];
} {
  const currentYear = userData.referenceYear;
  const yearsToRetire = userData.retirementAge - userData.currentAge;
  const retirementYear = currentYear + yearsToRetire;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const { mean, sigma } = getPortfolioReturns(userData.portfolioAssumptions);
  const inflationRate = userData.inflationRate;
  const numSims = 5000;
  let successCount = 0;
  const portfolioPaths: number[][] = [];
  for (let sim = 0; sim < numSims; sim++) {
    let balance = userData.currentSavings;
    const path: number[] = [];
    let failed = false;
    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;
      const r = mean + sigma * gaussianRandom();
      balance *= 1 + r;
      // Calculate spending for this year (includes retirement spending + spending goals)
      const spending = calculateAnnualSpending(userData, year);

      // Calculate income for this year (includes income events + annual savings if pre-retirement)
      let income = calculateAnnualIncome(userData, year);
      if (year < retirementYear) {
        income += userData.annualSavings; // Add annual savings pre-retirement
      }

      // Apply net cash flow
      const netFlow = income - spending; // Positive = surplus, negative = deficit
      balance += netFlow;
      if (balance < 0) {
        failed = true;
        balance = 0;
      }
      // Store balance in today's dollars (deflated by cumulative inflation)
      const inflationFactor = Math.pow(1 + inflationRate, i);
      path.push(balance / inflationFactor);
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
  return { probability, median, downside, years };
}
