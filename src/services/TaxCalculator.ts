// taxCalculator.ts
// This module provides a service for calculating the gross income needed to achieve a desired net income
// after federal and state taxes, considering tax year, filing status, age, and optional spouse age for MFJ.
// It incorporates 2024-2026 tax brackets, standard deductions, senior deductions, and OBBB changes (2025-2028).
// Drop this file into your src/services/ directory or similar, then import and use in your React components.
// Example usage in a React component:
// import { calculateGrossIncomeNeeded } from './services/taxCalculator';
// const gross = calculateGrossIncomeNeeded(50000, 0.05, 'single', 65, 2025);

type FilingStatus = 'single' | 'mfs' | 'mfj' | 'hoh';

interface Bracket {
  rate: number;
  upper: number;
}

const bracketsByYear: Record<number, Record<FilingStatus, Bracket[]>> = {
  2024: {
    single: [
      { rate: 0.1, upper: 11600 },
      { rate: 0.12, upper: 47150 },
      { rate: 0.22, upper: 100525 },
      { rate: 0.24, upper: 191950 },
      { rate: 0.32, upper: 243725 },
      { rate: 0.35, upper: 609350 },
      { rate: 0.37, upper: Infinity },
    ],
    mfs: [
      { rate: 0.1, upper: 11600 },
      { rate: 0.12, upper: 47150 },
      { rate: 0.22, upper: 100525 },
      { rate: 0.24, upper: 191950 },
      { rate: 0.32, upper: 243725 },
      { rate: 0.35, upper: 365600 },
      { rate: 0.37, upper: Infinity },
    ],
    mfj: [
      { rate: 0.1, upper: 23200 },
      { rate: 0.12, upper: 94300 },
      { rate: 0.22, upper: 201050 },
      { rate: 0.24, upper: 383900 },
      { rate: 0.32, upper: 487450 },
      { rate: 0.35, upper: 731200 },
      { rate: 0.37, upper: Infinity },
    ],
    hoh: [
      { rate: 0.1, upper: 16550 },
      { rate: 0.12, upper: 63100 },
      { rate: 0.22, upper: 100500 },
      { rate: 0.24, upper: 191950 },
      { rate: 0.32, upper: 243700 },
      { rate: 0.35, upper: 609350 },
      { rate: 0.37, upper: Infinity },
    ],
  },
  2025: {
    single: [
      { rate: 0.1, upper: 11925 },
      { rate: 0.12, upper: 48475 },
      { rate: 0.22, upper: 103350 },
      { rate: 0.24, upper: 197300 },
      { rate: 0.32, upper: 250525 },
      { rate: 0.35, upper: 626350 },
      { rate: 0.37, upper: Infinity },
    ],
    mfs: [
      { rate: 0.1, upper: 11925 },
      { rate: 0.12, upper: 48475 },
      { rate: 0.22, upper: 103350 },
      { rate: 0.24, upper: 197300 },
      { rate: 0.32, upper: 250525 },
      { rate: 0.35, upper: 626350 },
      { rate: 0.37, upper: Infinity },
    ],
    mfj: [
      { rate: 0.1, upper: 23850 },
      { rate: 0.12, upper: 96950 },
      { rate: 0.22, upper: 206700 },
      { rate: 0.24, upper: 394600 },
      { rate: 0.32, upper: 501050 },
      { rate: 0.35, upper: 751600 },
      { rate: 0.37, upper: Infinity },
    ],
    hoh: [
      { rate: 0.1, upper: 17000 },
      { rate: 0.12, upper: 64850 },
      { rate: 0.22, upper: 103350 },
      { rate: 0.24, upper: 197300 },
      { rate: 0.32, upper: 250500 },
      { rate: 0.35, upper: 626350 },
      { rate: 0.37, upper: Infinity },
    ],
  },
  2026: {
    single: [
      { rate: 0.1, upper: 12400 },
      { rate: 0.12, upper: 50400 },
      { rate: 0.22, upper: 105700 },
      { rate: 0.24, upper: 201775 },
      { rate: 0.32, upper: 256225 },
      { rate: 0.35, upper: 640600 },
      { rate: 0.37, upper: Infinity },
    ],
    mfs: [
      { rate: 0.1, upper: 12400 },
      { rate: 0.12, upper: 50400 },
      { rate: 0.22, upper: 105700 },
      { rate: 0.24, upper: 201775 },
      { rate: 0.32, upper: 256225 },
      { rate: 0.35, upper: 640600 },
      { rate: 0.37, upper: Infinity },
    ],
    mfj: [
      { rate: 0.1, upper: 24800 },
      { rate: 0.12, upper: 100800 },
      { rate: 0.22, upper: 211400 },
      { rate: 0.24, upper: 403550 },
      { rate: 0.32, upper: 512450 },
      { rate: 0.35, upper: 768700 },
      { rate: 0.37, upper: Infinity },
    ],
    hoh: [
      { rate: 0.1, upper: 17700 },
      { rate: 0.12, upper: 67450 },
      { rate: 0.22, upper: 105700 },
      { rate: 0.24, upper: 201775 },
      { rate: 0.32, upper: 256200 },
      { rate: 0.35, upper: 640600 },
      { rate: 0.37, upper: Infinity },
    ],
  },
};

const standardDeductionsByYear: Record<number, Record<FilingStatus, number>> = {
  2024: {
    single: 14600,
    mfs: 14600,
    mfj: 29200,
    hoh: 21900,
  },
  2025: {
    single: 15750,
    mfs: 15750,
    mfj: 31500,
    hoh: 23625,
  },
  2026: {
    single: 16100,
    mfs: 16100,
    mfj: 32200,
    hoh: 24150,
  },
};

const additionalSeniorPerByYear: Record<
  number,
  Record<FilingStatus, number>
> = {
  2024: {
    single: 1950,
    mfs: 1950,
    mfj: 1550,
    hoh: 1950,
  },
  2025: {
    single: 2000,
    mfs: 2000,
    mfj: 1600,
    hoh: 2000,
  },
  2026: {
    single: 2050,
    mfs: 2050,
    mfj: 1650,
    hoh: 2050,
  },
};

function getNumQualifyingSeniors(
  status: FilingStatus,
  age: number,
  spouseAge: number | null
): number {
  let num = age >= 65 ? 1 : 0;
  if (status === 'mfj' && spouseAge !== null && spouseAge >= 65) {
    num += 1;
  }
  return num;
}

function getUsualSeniorExtra(
  status: FilingStatus,
  taxYear: number,
  numQualifying: number
): number {
  if (numQualifying === 0) return 0;
  // Use the most recent available year for future years
  const availableYears = Object.keys(additionalSeniorPerByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const effectiveYear =
    availableYears.find((year) => year <= taxYear) || availableYears[0];
  const per = additionalSeniorPerByYear[effectiveYear][status];
  return numQualifying * per;
}

function getOBBBSeniorDeduction(
  gross: number,
  status: FilingStatus,
  taxYear: number,
  numQualifying: number
): number {
  if (
    numQualifying === 0 ||
    status === 'mfs' ||
    taxYear < 2025 ||
    taxYear > 2028
  )
    return 0;
  const baseSeniorDed = 6000 * numQualifying;
  const isJoint = status === 'mfj';
  const threshold = isJoint ? 150000 : 75000;
  const over = Math.max(0, gross - threshold);
  const reduction = over * 0.06;
  return Math.max(0, baseSeniorDed - reduction);
}

function calculateFederalTax(
  taxable: number,
  status: FilingStatus,
  taxYear: number
): number {
  // Use the most recent available year for future years
  const availableYears = Object.keys(bracketsByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const effectiveYear =
    availableYears.find((year) => year <= taxYear) || availableYears[0];
  const brackets = bracketsByYear[effectiveYear]?.[status];
  if (!brackets) {
    throw new Error(
      `No brackets available for tax year ${taxYear} and status ${status}`
    );
  }
  let tax = 0;
  let prevUpper = 0;
  for (const bracket of brackets) {
    const amountInBracket = Math.min(taxable, bracket.upper) - prevUpper;
    if (amountInBracket > 0) {
      tax += amountInBracket * bracket.rate;
    }
    if (taxable <= bracket.upper) break;
    prevUpper = bracket.upper;
  }
  return tax;
}

// Memoization cache for tax calculations
const taxCalculationCache = new Map<string, number>();

function getCacheKey(
  netIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null
): string {
  return `${netIncome}_${stateTaxRate}_${filingStatus}_${age}_${taxYear}_${spouseAge}`;
}

function getNetCacheKey(
  grossIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null
): string {
  return `net_${grossIncome}_${stateTaxRate}_${filingStatus}_${age}_${taxYear}_${spouseAge}`;
}

export function calculateGrossIncomeNeeded(
  netIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null
): number {
  const cacheKey = getCacheKey(
    netIncome,
    stateTaxRate,
    filingStatus,
    age,
    taxYear,
    spouseAge
  );
  if (taxCalculationCache.has(cacheKey)) {
    return taxCalculationCache.get(cacheKey)!;
  }

  if (netIncome < 0 || stateTaxRate < 0 || stateTaxRate >= 1) {
    throw new Error('Invalid input values');
  }

  let low = netIncome;
  let high = netIncome * 3; // Increased initial guess for high-tax scenarios

  const maxIterations = 1000;
  let iterations = 0;

  const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);

  while (high - low > 0.01 && iterations < maxIterations) {
    const mid = (low + high) / 2;
    const usualExtra = getUsualSeniorExtra(
      filingStatus,
      taxYear,
      numQualifying
    );
    const obbbExtra = getOBBBSeniorDeduction(
      mid,
      filingStatus,
      taxYear,
      numQualifying
    );
    // Use the most recent available year for standard deductions
    const deductionYears = Object.keys(standardDeductionsByYear)
      .map(Number)
      .sort((a, b) => b - a);
    const deductionEffectiveYear =
      deductionYears.find((year) => year <= taxYear) || deductionYears[0];
    const deduction =
      standardDeductionsByYear[deductionEffectiveYear]?.[filingStatus] +
      usualExtra +
      obbbExtra;
    const taxable = Math.max(0, mid - deduction);
    const federalTax = calculateFederalTax(taxable, filingStatus, taxYear);
    const stateTax = mid * stateTaxRate;
    const computedNet = mid - federalTax - stateTax;

    if (computedNet < netIncome) {
      low = mid;
    } else {
      high = mid;
    }
    iterations++;
  }

  if (iterations >= maxIterations) {
    console.warn('Max iterations reached; result may not be precise.');
  }

  const result = Math.round(low * 100) / 100; // Round to nearest cent
  taxCalculationCache.set(cacheKey, result);
  return result;
}

export function calculateNetFromGross(
  grossIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null
): number {
  const cacheKey = getNetCacheKey(
    grossIncome,
    stateTaxRate,
    filingStatus,
    age,
    taxYear,
    spouseAge
  );
  if (taxCalculationCache.has(cacheKey)) {
    return taxCalculationCache.get(cacheKey)!;
  }

  if (grossIncome < 0 || stateTaxRate < 0 || stateTaxRate >= 1) {
    throw new Error('Invalid input values');
  }

  const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);
  const usualExtra = getUsualSeniorExtra(filingStatus, taxYear, numQualifying);
  const obbbExtra = getOBBBSeniorDeduction(
    grossIncome,
    filingStatus,
    taxYear,
    numQualifying
  );
  // Use the most recent available year for standard deductions
  const deductionYears = Object.keys(standardDeductionsByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const deductionEffectiveYear =
    deductionYears.find((year) => year <= taxYear) || deductionYears[0];
  const deduction =
    standardDeductionsByYear[deductionEffectiveYear]?.[filingStatus] +
    usualExtra +
    obbbExtra;
  const taxable = Math.max(0, grossIncome - deduction);
  const federalTax = calculateFederalTax(taxable, filingStatus, taxYear);
  const stateTax = grossIncome * stateTaxRate;
  const result = grossIncome - federalTax - stateTax;
  taxCalculationCache.set(cacheKey, result);
  return result;
}

// Function to clear cache when user data changes
export function clearTaxCalculationCache(): void {
  taxCalculationCache.clear();
}

// Optional: Export a hook for React usage if you want to memoize or handle async (though sync here)
import { useCallback } from 'react';

export const useTaxCalculator = () => {
  return useCallback(calculateGrossIncomeNeeded, []);
};
