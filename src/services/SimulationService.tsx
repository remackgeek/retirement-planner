import type { UserData } from '../types/UserData';
import type { PortfolioType, PortfolioParams } from '../types/IncomeEvent';
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

// Portfolio parameters for log-normal and fat-tail distributions
const portfolioParams: Record<PortfolioType, PortfolioParams> = {
  conservative: {
    mean: 0.05,
    stdDev: 0.08,
    mu: 0.046,
    sigma: 0.076,
    df: 4, // Degrees of freedom for t-distribution (fat-tail)
  },
  balanced: {
    mean: 0.06,
    stdDev: 0.12,
    mu: 0.052,
    sigma: 0.112,
    df: 4,
  },
  aggressive: {
    mean: 0.08,
    stdDev: 0.15,
    mu: 0.056,
    sigma: 0.137,
    df: 4,
  },
};

// Helper function to generate a standard normal random variable (Box-Muller transform)
function standardNormalRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Function to generate a single year's log-normal return factor (1 + r)
function generateReturnFactor(params: PortfolioParams): number {
  const normalSample = params.mu + params.sigma * standardNormalRandom();
  return Math.exp(normalSample);
}

// Function to generate a t-distribution random variable (for fat-tail distributions)
function tDistributionRandom(df: number): number {
  // Using the method: t = z / sqrt(chi^2 / df)
  // where z ~ N(0,1) and chi^2 ~ Chi-squared(df)
  const z = standardNormalRandom();
  const chiSquared = generateChiSquared(df);
  return z / Math.sqrt(chiSquared / df);
}

// Function to generate chi-squared random variable
function generateChiSquared(df: number): number {
  // For df >= 1, we can use the gamma distribution relationship
  // Chi-squared(df) = Gamma(df/2, 2)
  return generateGamma(df / 2, 2);
}

// Function to generate gamma random variable using Marsaglia and Tsang method
function generateGamma(shape: number, scale: number): number {
  if (shape >= 1) {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    let x, v;
    do {
      do {
        x = standardNormalRandom();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) break;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) break;
    } while (true);
    return d * v * scale;
  } else {
    // For shape < 1, use the relationship Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return generateGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  }
}

// Function to generate fat-tail return factor using t-distribution
function generateFatTailReturnFactor(params: PortfolioParams): number {
  if (!params.df) {
    throw new Error('Degrees of freedom required for fat-tail distribution');
  }
  const tSample = tDistributionRandom(params.df);
  // Scale by the standard deviation and add the mean
  const scaledSample = params.mean + params.stdDev * tSample;
  return Math.exp(scaledSample);
}

/**
 * Calculates the fund balance after one year of growth based on the portfolio type and simulation type.
 * @param initialAmount - Starting fund balance for the year.
 * @param portfolioType - Type of portfolio: 'conservative', 'balanced', or 'aggressive'.
 * @param simulationType - Type of simulation: 'log_normal' or 'fat_tail'.
 * @returns The new fund balance after applying random growth for one year.
 */
function calculateYearlyGrowth(
  initialAmount: number,
  portfolioType: PortfolioType,
  simulationType: 'log_normal' | 'fat_tail' = 'log_normal'
): number {
  const params = portfolioParams[portfolioType];
  if (!params) {
    throw new Error('Invalid portfolio type');
  }

  let growthFactor: number;
  if (simulationType === 'fat_tail') {
    growthFactor = generateFatTailReturnFactor(params);
  } else {
    growthFactor = generateReturnFactor(params);
  }

  return initialAmount * growthFactor;
}

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
  const inflationRate = userData.inflationRate;
  const numSims = 5000;
  let successCount = 0;
  const portfolioPaths: number[][] = [];

  // Determine if we should use log-normal growth or fallback to old system
  const useLogNormal =
    userData.portfolioAssumptions.riskLevel !== 'custom' &&
    ['conservative', 'balanced', 'aggressive'].includes(
      userData.portfolioAssumptions.riskLevel
    );

  for (let sim = 0; sim < numSims; sim++) {
    let balance = userData.currentSavings;
    const path: number[] = [];
    let failed = false;
    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;

      // Store starting balance for this year (before any changes)
      const inflationFactor = Math.pow(1 + inflationRate, i);
      path.push(balance / inflationFactor);

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

      // Apply portfolio returns at the END of the year
      if (
        useLogNormal &&
        typeof userData.portfolioAssumptions.riskLevel === 'string'
      ) {
        // Use new log-normal or fat-tail growth
        const simulationType =
          userData.portfolioAssumptions.simulationType || 'log_normal';
        balance = calculateYearlyGrowth(
          balance,
          userData.portfolioAssumptions.riskLevel as PortfolioType,
          simulationType
        );
      } else {
        // Fallback to old normal distribution system
        const { mean, sigma } = getPortfolioReturns(
          userData.portfolioAssumptions
        );
        const r = mean + sigma * gaussianRandom();
        balance *= 1 + r;
      }
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
