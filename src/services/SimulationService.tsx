import type { UserData } from '../types/UserData';

function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
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

  // Retirement spending with optional decrease
  const retirementSpending = userData.retirementSpending;
  const retirementStartYear =
    userData.referenceYear +
    (retirementSpending.startAge - userData.currentAge);
  if (year >= retirementStartYear) {
    let annualAmount = retirementSpending.monthlyAmount * 12;
    if (retirementSpending.yearlyDecreasePercent) {
      const yearsSinceStart = year - retirementStartYear;
      annualAmount *= Math.pow(
        1 - retirementSpending.yearlyDecreasePercent / 100,
        yearsSinceStart
      );
    }
    totalSpending += annualAmount;
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
      totalSpending += amount;
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
      totalIncome += amount;
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
  const inflationRate = 0.03; // Assuming 3% inflation rate
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
