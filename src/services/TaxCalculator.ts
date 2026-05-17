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
  numQualifying: number,
  inflationRate?: number
): number {
  if (numQualifying === 0) return 0;
  // Use the most recent available year for future years
  const availableYears = Object.keys(additionalSeniorPerByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const effectiveYear =
    availableYears.find((year) => year <= taxYear) || availableYears[0];
  const per = additionalSeniorPerByYear[effectiveYear][status] * inflationFactor(taxYear, inflationRate);
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

// Brackets and standard deductions are projected forward from 2026 using the
// scenario's inflationRate, matching how the IRS adjusts via Chained CPI-U.
const BASE_INFLATION_YEAR = 2026;

function inflationFactor(taxYear: number, inflationRate: number | undefined): number {
  if (!inflationRate || taxYear <= BASE_INFLATION_YEAR) return 1;
  return Math.pow(1 + inflationRate, taxYear - BASE_INFLATION_YEAR);
}

function calculateFederalTax(
  taxable: number,
  status: FilingStatus,
  taxYear: number,
  inflationRate?: number
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
  const factor = inflationFactor(taxYear, inflationRate);
  let tax = 0;
  let prevUpper = 0;
  for (const bracket of brackets) {
    const scaledUpper = bracket.upper === Infinity ? Infinity : bracket.upper * factor;
    const amountInBracket = Math.min(taxable, scaledUpper) - prevUpper;
    if (amountInBracket > 0) {
      tax += amountInBracket * bracket.rate;
    }
    if (taxable <= scaledUpper) break;
    prevUpper = scaledUpper;
  }
  return tax;
}

// Memoization cache for tax calculations
const taxCalculationCache = new Map<string, number>();

function getNetCacheKey(
  grossIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null,
  inflationRate?: number
): string {
  return `net_${grossIncome}_${stateTaxRate}_${filingStatus}_${age}_${taxYear}_${spouseAge}_${inflationRate ?? 0}`;
}

export function calculateNetFromGross(
  grossIncome: number,
  stateTaxRate: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null,
  inflationRate?: number
): number {
  const cacheKey = getNetCacheKey(
    grossIncome,
    stateTaxRate,
    filingStatus,
    age,
    taxYear,
    spouseAge,
    inflationRate
  );
  if (taxCalculationCache.has(cacheKey)) {
    return taxCalculationCache.get(cacheKey)!;
  }

  if (grossIncome < 0 || stateTaxRate < 0 || stateTaxRate >= 1) {
    throw new Error('Invalid input values');
  }

  const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);
  const usualExtra = getUsualSeniorExtra(filingStatus, taxYear, numQualifying, inflationRate);
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
  const baseStdDed =
    (standardDeductionsByYear[deductionEffectiveYear]?.[filingStatus] ?? 0) *
    inflationFactor(taxYear, inflationRate);
  const deduction = baseStdDed + usualExtra + obbbExtra;
  const taxable = Math.max(0, grossIncome - deduction);
  const federalTax = calculateFederalTax(taxable, filingStatus, taxYear, inflationRate);
  const stateTax = grossIncome * stateTaxRate;
  const result = grossIncome - federalTax - stateTax;
  taxCalculationCache.set(cacheKey, result);
  return result;
}

export type { FilingStatus };

/**
 * Returns the standard deduction for the given filing status and tax year
 * (using the most recent available year for future years). Does not include
 * senior or OBBB additions — use `calculateNetFromGross` for full accuracy.
 */
export function getStandardDeduction(status: FilingStatus, taxYear: number, inflationRate?: number): number {
  const years = Object.keys(standardDeductionsByYear).map(Number).sort((a, b) => b - a);
  const effectiveYear = years.find((y) => y <= taxYear) ?? years[0];
  const base = standardDeductionsByYear[effectiveYear]?.[status] ?? 0;
  return base * inflationFactor(taxYear, inflationRate);
}

/**
 * Returns the 0-based index of the marginal federal bracket the given taxable
 * income lands in (0 = 10%, 6 = 37%). Standard deduction is NOT applied here —
 * pass already-deducted taxable income.
 */
export function getFederalBracketIndex(
  taxable: number,
  status: FilingStatus,
  taxYear: number,
  inflationRate?: number
): number {
  const availableYears = Object.keys(bracketsByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const effectiveYear =
    availableYears.find((year) => year <= taxYear) || availableYears[0];
  const brackets = bracketsByYear[effectiveYear]?.[status];
  if (!brackets) return 0;
  const factor = inflationFactor(taxYear, inflationRate);
  for (let i = 0; i < brackets.length; i++) {
    const scaledUpper = brackets[i].upper === Infinity ? Infinity : brackets[i].upper * factor;
    if (taxable <= scaledUpper) return i;
  }
  return brackets.length - 1;
}

// SS taxable fraction thresholds (frozen since 1983/1993, not inflation-indexed)
const ssThresholds: Record<string, { t1: number; t2: number; base: number }> = {
  single: { t1: 25000, t2: 34000, base: 4500 },
  hoh: { t1: 25000, t2: 34000, base: 4500 },
  mfj: { t1: 32000, t2: 44000, base: 6000 },
};

/**
 * Compute the taxable portion of Social Security benefits using IRS provisional income rules.
 * Returns the dollar amount of SS that counts as taxable income (0% to 85% of ssGross).
 */
export function calculateSSTaxableAmount(
  ssGross: number,
  otherGross: number,
  filingStatus: FilingStatus
): number {
  if (ssGross <= 0) return 0;

  // MFS: always 85% taxable regardless of provisional income
  if (filingStatus === 'mfs') return 0.85 * ssGross;

  const { t1, t2, base } = ssThresholds[filingStatus];
  const provisionalIncome = otherGross + 0.5 * ssGross;

  if (provisionalIncome <= t1) {
    return 0;
  }

  if (provisionalIncome <= t2) {
    return Math.min(0.5 * (provisionalIncome - t1), 0.5 * ssGross);
  }

  // Above t2: up to 85% taxable
  // base is capped at 0.5 * ssGross per IRS Publication 915
  const adjustedBase = Math.min(base, 0.5 * ssGross);
  const taxableAmount = 0.85 * (provisionalIncome - t2) + adjustedBase;
  return Math.min(taxableAmount, 0.85 * ssGross);
}

// Function to clear cache when user data changes
export function clearTaxCalculationCache(): void {
  taxCalculationCache.clear();
}
