type FilingStatus = 'single' | 'mfs' | 'mfj' | 'hoh';

interface Bracket {
  rate: number;
  upper: number;
}

// Federal ordinary-income brackets by year and filing status. MFS thresholds are
// half the MFJ thresholds, per statute (do NOT copy them from the single column —
// only the 10%–32% MFS rows coincide with single by arithmetic, the 35% top does not).
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
      { rate: 0.35, upper: 375800 },
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
      { rate: 0.35, upper: 384350 },
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

// Age-65+ additional standard deduction, per qualifying senior. There are only two
// statutory amounts each year: a married figure (used by both MFJ and MFS) and an
// unmarried figure (single/HoH). MFS gets the MARRIED amount — do not copy it from single.
const additionalSeniorPerByYear: Record<
  number,
  Record<FilingStatus, number>
> = {
  2024: {
    single: 1950,
    mfs: 1550,
    mfj: 1550,
    hoh: 1950,
  },
  2025: {
    single: 2000,
    mfs: 1600,
    mfj: 1600,
    hoh: 2000,
  },
  2026: {
    single: 2050,
    mfs: 1650,
    mfj: 1650,
    hoh: 2050,
  },
};

// Federal long-term capital-gains rate breakpoints (taxable-income thresholds).
// LTCG stacks ON TOP of ordinary taxable income: the portion of gain sitting
// below `zeroTop` is taxed 0%, between `zeroTop` and `fifteenTop` at 15%, and
// above `fifteenTop` at 20%. Projected forward from the base year via the same
// inflation factor as the ordinary brackets. Only consulted when a scenario
// opts into stacked LTCG (UserData.useStackedLtcgBrackets); the default flat
// `longTermCapGainsRate` path ignores this table.
//
// Sources: 2024 = Rev. Proc. 2023-34; 2025 = Rev. Proc. 2024-40; 2026 =
// Rev. Proc. 2025-32. MFS values are half the MFJ thresholds, per statute.
// Re-verify against the IRS revenue procedure before relying on a given year.
const ltcgBreakpointsByYear: Record<number, Record<FilingStatus, { zeroTop: number; fifteenTop: number }>> = {
  2024: {
    single: { zeroTop: 47025, fifteenTop: 518900 },
    mfs: { zeroTop: 47025, fifteenTop: 291850 },
    mfj: { zeroTop: 94050, fifteenTop: 583750 },
    hoh: { zeroTop: 63000, fifteenTop: 551350 },
  },
  2025: {
    single: { zeroTop: 48350, fifteenTop: 533400 },
    mfs: { zeroTop: 48350, fifteenTop: 300000 },
    mfj: { zeroTop: 96700, fifteenTop: 600050 },
    hoh: { zeroTop: 64750, fifteenTop: 566700 },
  },
  2026: {
    single: { zeroTop: 49450, fifteenTop: 545500 },
    mfs: { zeroTop: 49450, fifteenTop: 306850 },
    mfj: { zeroTop: 98900, fifteenTop: 613700 },
    hoh: { zeroTop: 66200, fifteenTop: 578650 },
  },
};

/**
 * Inflation-indexed federal LTCG 0%/15% breakpoints for a filing status/year.
 * Above `fifteenTop` the 20% rate applies.
 */
export function getLtcgBreakpoints(
  filingStatus: FilingStatus,
  taxYear: number,
  inflationRate?: number,
): { zeroTop: number; fifteenTop: number } {
  const years = Object.keys(ltcgBreakpointsByYear).map(Number).sort((a, b) => b - a);
  const eff = years.find((y) => y <= taxYear) ?? years[0];
  const bp = ltcgBreakpointsByYear[eff][filingStatus];
  const f = inflationFactor(taxYear, inflationRate);
  return { zeroTop: bp.zeroTop * f, fifteenTop: bp.fifteenTop * f };
}

/**
 * Federal LTCG tax via 0/15/20% bracket stacking. `ordinaryTaxable` is the
 * after-deduction ordinary taxable income (the height at which the gain stacks);
 * `ltcg` is the long-term gain. The 0% band only applies to the part of the gain
 * that falls below the 0% ceiling once ordinary income is accounted for.
 */
export function computeFederalLTCGTax(
  ordinaryTaxable: number,
  ltcg: number,
  filingStatus: FilingStatus,
  taxYear: number,
  inflationRate?: number,
): number {
  const gain = Math.max(0, ltcg);
  if (gain <= 0) return 0;
  const base = Math.max(0, ordinaryTaxable);
  const { zeroTop, fifteenTop } = getLtcgBreakpoints(filingStatus, taxYear, inflationRate);
  const stackTop = base + gain;
  const fifteenAmt = Math.max(0, Math.min(stackTop, fifteenTop) - Math.max(base, zeroTop));
  const twentyAmt = Math.max(0, stackTop - Math.max(base, fifteenTop));
  return fifteenAmt * 0.15 + twentyAmt * 0.20;
}

/**
 * After-deduction federal ordinary taxable income for a gross amount — the same
 * deduction stack `calculateNetFromGross` applies (base standard deduction +
 * age-65 senior add-on + OBBB extra). Exposed so the LTCG-stacking path can find
 * the height at which gains stack without re-deriving the deduction.
 */
export function getFederalTaxableIncome(
  grossIncome: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null,
  inflationRate?: number,
): number {
  const safeGross = Math.max(0, grossIncome);
  const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);
  const usualExtra = getUsualSeniorExtra(filingStatus, taxYear, numQualifying, inflationRate);
  const obbbExtra = getOBBBSeniorDeduction(safeGross, filingStatus, taxYear, numQualifying);
  const baseStdDed = getStandardDeduction(filingStatus, taxYear, inflationRate);
  return Math.max(0, safeGross - (baseStdDed + usualExtra + obbbExtra));
}

/**
 * Number of filers age 65+ who qualify for the senior-bonus standard
 * deduction (1 for single/HoH/MFS filers age 65+, plus 1 for an MFJ spouse
 * age 65+).
 */
export function getNumQualifyingSeniors(
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

/**
 * The "usual" senior standard-deduction add-on (the long-standing IRS
 * age-65 extra; separate from the temporary OBBB extra). Deterministic —
 * depends only on filing status, age(s), tax year, and inflation. Exported
 * for callers that need the effective deduction inclusive of the senior
 * bonus (e.g. the bracket-aware headroom precompute in SimulationService).
 */
export function getUsualSeniorExtra(
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

// Bracket-by-bracket detail for the Tax Audit view. Same logic as
// calculateFederalTax but emits a per-bracket allocation as a side product.
export interface FederalBracketDetail {
  rate: number;
  upperScaled: number;   // inflation-indexed upper bound (Infinity for top bracket)
  amountInBracket: number;
  taxInBracket: number;
}

function calculateFederalTaxDetailed(
  taxable: number,
  status: FilingStatus,
  taxYear: number,
  inflationRate: number | undefined
): { totalTax: number; bracketIndex: number; marginalRate: number; bracketDetails: FederalBracketDetail[] } {
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
  const details: FederalBracketDetail[] = [];
  let totalTax = 0;
  let prevUpper = 0;
  let bracketIndex = 0;
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    const scaledUpper = bracket.upper === Infinity ? Infinity : bracket.upper * factor;
    const amountInBracket = Math.max(0, Math.min(taxable, scaledUpper) - prevUpper);
    const taxInBracket = amountInBracket * bracket.rate;
    details.push({
      rate: bracket.rate,
      upperScaled: scaledUpper,
      amountInBracket,
      taxInBracket,
    });
    totalTax += taxInBracket;
    if (taxable > prevUpper && taxable <= scaledUpper) bracketIndex = i;
    if (taxable <= scaledUpper) {
      // Fill remaining (unused) brackets in detail array with zeros so callers
      // always see the full bracket table.
      for (let j = i + 1; j < brackets.length; j++) {
        const nextScaledUpper = brackets[j].upper === Infinity ? Infinity : brackets[j].upper * factor;
        details.push({ rate: brackets[j].rate, upperScaled: nextScaledUpper, amountInBracket: 0, taxInBracket: 0 });
      }
      break;
    }
    prevUpper = scaledUpper;
    if (i === brackets.length - 1) bracketIndex = i;
  }
  return {
    totalTax,
    bracketIndex,
    marginalRate: brackets[bracketIndex].rate,
    bracketDetails: details,
  };
}

// Memoization cache for federal-only tax calculations (state is handled
// separately via the profile-based StateTaxCalculator and is not cached here).
const taxCalculationCache = new Map<string, number>();

function getNetCacheKey(
  grossIncome: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null,
  inflationRate?: number
): string {
  return `net_${grossIncome}_${filingStatus}_${age}_${taxYear}_${spouseAge}_${inflationRate ?? 0}`;
}

/**
 * Detailed federal tax breakdown for the Tax Audit view. Returns all
 * intermediates (deduction parts, AGI, taxable income, bracket index, marginal
 * rate, per-bracket allocation, federal tax, net). State tax is now computed
 * separately via `computeStateTax` in `StateTaxCalculator.ts` and is not
 * included in this struct. Not memoized — meant for representative-path detail
 * rows, not the inner MC loop.
 */
export interface DetailedNetFromGross {
  grossIncome: number;
  standardDeduction: number;
  seniorAddOn: number;
  obbbReduction: number;
  totalDeductions: number;
  taxableIncome: number;
  federalTax: number;
  /** Federal-only net (grossIncome - federalTax). State tax must be subtracted at the call site. */
  federalNet: number;
  federalBracketIndex: number;
  federalMarginalRate: number;
  federalBrackets: FederalBracketDetail[];
  numQualifyingSeniors: number;
}

export function calculateNetFromGrossDetailed(
  grossIncome: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null,
  inflationRate?: number
): DetailedNetFromGross {
  const safeGross = Math.max(0, grossIncome);
  const numQualifying = getNumQualifyingSeniors(filingStatus, age, spouseAge);
  const usualExtra = getUsualSeniorExtra(filingStatus, taxYear, numQualifying, inflationRate);
  const obbbExtra = getOBBBSeniorDeduction(safeGross, filingStatus, taxYear, numQualifying);
  const deductionYears = Object.keys(standardDeductionsByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const deductionEffectiveYear =
    deductionYears.find((year) => year <= taxYear) || deductionYears[0];
  const baseStdDed =
    (standardDeductionsByYear[deductionEffectiveYear]?.[filingStatus] ?? 0) *
    inflationFactor(taxYear, inflationRate);
  const totalDeductions = baseStdDed + usualExtra + obbbExtra;
  const taxableIncome = Math.max(0, safeGross - totalDeductions);
  const fed = calculateFederalTaxDetailed(taxableIncome, filingStatus, taxYear, inflationRate);
  return {
    grossIncome: safeGross,
    standardDeduction: baseStdDed,
    seniorAddOn: usualExtra,
    obbbReduction: obbbExtra,
    totalDeductions,
    taxableIncome,
    federalTax: fed.totalTax,
    federalNet: safeGross - fed.totalTax,
    federalBracketIndex: fed.bracketIndex,
    federalMarginalRate: fed.marginalRate,
    federalBrackets: fed.bracketDetails,
    numQualifyingSeniors: numQualifying,
  };
}

/**
 * Federal-only net from gross (gross − federal ordinary tax). State tax must
 * be subtracted separately at the call site via `computeStateTax`.
 */
export function calculateNetFromGross(
  grossIncome: number,
  filingStatus: FilingStatus,
  age: number,
  taxYear: number,
  spouseAge: number | null = null,
  inflationRate?: number
): number {
  const cacheKey = getNetCacheKey(
    grossIncome,
    filingStatus,
    age,
    taxYear,
    spouseAge,
    inflationRate
  );
  if (taxCalculationCache.has(cacheKey)) {
    return taxCalculationCache.get(cacheKey)!;
  }

  if (grossIncome < 0) {
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
  const result = grossIncome - federalTax;
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

/**
 * Returns the upper bound (taxable income, inflation-scaled) of the federal
 * bracket at `bracketIndex` (0 = 10%, 1 = 12%, 2 = 22%, ...). Returns Infinity
 * for the top bracket. Standard deduction is NOT applied — the returned value
 * is a taxable-income ceiling, not a gross-income ceiling. Callers comparing
 * against gross income must add the standard deduction.
 *
 * Used by the bracket-aware spending waterfall (see CLAUDE.md "Cross-year
 * spending source policy") to compute Trad-spending headroom that stays
 * within a target marginal rate.
 */
export function getBracketCeilingTaxableIncome(
  status: FilingStatus,
  bracketIndex: number,
  taxYear: number,
  inflationRate?: number
): number {
  const availableYears = Object.keys(bracketsByYear)
    .map(Number)
    .sort((a, b) => b - a);
  const effectiveYear =
    availableYears.find((year) => year <= taxYear) || availableYears[0];
  const brackets = bracketsByYear[effectiveYear]?.[status];
  if (!brackets || bracketIndex < 0 || bracketIndex >= brackets.length) return 0;
  const upper = brackets[bracketIndex].upper;
  if (upper === Infinity) return Infinity;
  return upper * inflationFactor(taxYear, inflationRate);
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

/**
 * Detailed SS taxability breakdown for the Tax Audit view. Exposes the
 * provisional income, both IRS thresholds, and which zone the taxpayer
 * landed in (none / 50% / 85%).
 */
export type SsZone = 'none' | '50%' | '85%' | 'mfs-flat';

export interface DetailedSsTaxable {
  taxable: number;
  provisionalIncome: number;
  threshold1: number;
  threshold2: number;
  zone: SsZone;
}

export function calculateSSTaxableAmountDetailed(
  ssGross: number,
  otherGross: number,
  filingStatus: FilingStatus
): DetailedSsTaxable {
  if (ssGross <= 0) {
    return { taxable: 0, provisionalIncome: 0, threshold1: 0, threshold2: 0, zone: 'none' };
  }
  if (filingStatus === 'mfs') {
    return {
      taxable: 0.85 * ssGross,
      provisionalIncome: otherGross + 0.5 * ssGross,
      threshold1: 0,
      threshold2: 0,
      zone: 'mfs-flat',
    };
  }
  const { t1, t2, base } = ssThresholds[filingStatus];
  const provisionalIncome = otherGross + 0.5 * ssGross;
  if (provisionalIncome <= t1) {
    return { taxable: 0, provisionalIncome, threshold1: t1, threshold2: t2, zone: 'none' };
  }
  if (provisionalIncome <= t2) {
    return {
      taxable: Math.min(0.5 * (provisionalIncome - t1), 0.5 * ssGross),
      provisionalIncome,
      threshold1: t1,
      threshold2: t2,
      zone: '50%',
    };
  }
  const adjustedBase = Math.min(base, 0.5 * ssGross);
  const taxableAmount = 0.85 * (provisionalIncome - t2) + adjustedBase;
  return {
    taxable: Math.min(taxableAmount, 0.85 * ssGross),
    provisionalIncome,
    threshold1: t1,
    threshold2: t2,
    zone: '85%',
  };
}

// Function to clear cache when user data changes
export function clearTaxCalculationCache(): void {
  taxCalculationCache.clear();
}
