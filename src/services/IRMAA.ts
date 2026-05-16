// IRMAA — Medicare Income-Related Monthly Adjustment Amount
//
// Medicare Part B and Part D premiums include a surcharge ("IRMAA") for
// beneficiaries whose Modified AGI exceeds tiered thresholds. The surcharge
// applies per Medicare-enrolled person and is determined by MAGI from two
// years prior (IRS lookback).
//
// 2024 official tier table. Tier upper bounds use the IRS thresholds; surcharge
// columns are the monthly Part B + Part D adjustments. Thresholds are inflated
// per year by the deterministic inflation rate (matching how the federal tax
// brackets are indexed elsewhere in this project), starting from the 2024
// base year.

type FilingStatus = 'single' | 'mfs' | 'mfj' | 'hoh';

interface IrmaaTier {
  magiUpper: number;            // inclusive upper bound of this tier
  monthlySurcharge: number;     // Part B + Part D monthly surcharge per enrollee
}

// 2024 official tiers (https://www.medicare.gov / SSA).
const SINGLE_TIERS_2024: IrmaaTier[] = [
  { magiUpper: 103_000, monthlySurcharge: 0 },
  { magiUpper: 129_000, monthlySurcharge: 69.90 + 12.90 },
  { magiUpper: 161_000, monthlySurcharge: 174.70 + 33.30 },
  { magiUpper: 193_000, monthlySurcharge: 279.50 + 53.80 },
  { magiUpper: 500_000, monthlySurcharge: 384.30 + 74.20 },
  { magiUpper: Infinity, monthlySurcharge: 419.30 + 81.00 },
];

const MFJ_TIERS_2024: IrmaaTier[] = [
  { magiUpper: 206_000, monthlySurcharge: 0 },
  { magiUpper: 258_000, monthlySurcharge: 69.90 + 12.90 },
  { magiUpper: 322_000, monthlySurcharge: 174.70 + 33.30 },
  { magiUpper: 386_000, monthlySurcharge: 279.50 + 53.80 },
  { magiUpper: 750_000, monthlySurcharge: 384.30 + 74.20 },
  { magiUpper: Infinity, monthlySurcharge: 419.30 + 81.00 },
];

// MFS uses a compressed 3-tier table; below we approximate with the single
// thresholds, documented as a known simplification.
const MFS_TIERS_2024: IrmaaTier[] = SINGLE_TIERS_2024;

const BASE_YEAR = 2024;

function tiersFor(filingStatus: FilingStatus): IrmaaTier[] {
  if (filingStatus === 'mfj') return MFJ_TIERS_2024;
  if (filingStatus === 'mfs') return MFS_TIERS_2024;
  return SINGLE_TIERS_2024; // single, hoh
}

// Annual per-enrollee surcharge given the 2-year-prior MAGI for a calendar year.
// Thresholds are inflation-indexed forward from 2024 by `(1+inflationRate)^(year-2024)`.
function annualSurchargePerEnrollee(
  lookbackMagi: number,
  filingStatus: FilingStatus,
  year: number,
  inflationRate: number,
): number {
  if (!(lookbackMagi > 0)) return 0;
  const factor = year > BASE_YEAR ? Math.pow(1 + inflationRate, year - BASE_YEAR) : 1;
  const tiers = tiersFor(filingStatus);
  for (const tier of tiers) {
    if (lookbackMagi <= tier.magiUpper * factor) {
      return tier.monthlySurcharge * 12;
    }
  }
  return tiers[tiers.length - 1].monthlySurcharge * 12;
}

// Calculate total IRMAA surcharge for a calendar year.
//
// - `lookbackMagi`: AGI/MAGI proxy from two years prior. Caller supplies 0 when
//   that year is unavailable (first two years of the simulation) — surcharge is 0.
// - Multiplied by 1 if only self is on Medicare, 2 if both spouses are.
// - Pre-Medicare (under 65) enrollees get nothing.
export function calculateIRMAA(
  lookbackMagi: number,
  filingStatus: FilingStatus,
  year: number,
  inflationRate: number,
  ageSelf: number,
  ageSpouse: number | null,
): number {
  const perEnrollee = annualSurchargePerEnrollee(lookbackMagi, filingStatus, year, inflationRate);
  if (perEnrollee <= 0) return 0;
  let enrollees = 0;
  if (ageSelf >= 65) enrollees += 1;
  if (ageSpouse !== null && ageSpouse >= 65) enrollees += 1;
  return perEnrollee * enrollees;
}

// NIIT thresholds — statutory, NOT indexed for inflation.
const NIIT_THRESHOLDS: Record<FilingStatus, number> = {
  single: 200_000,
  hoh: 200_000,
  mfj: 250_000,
  mfs: 125_000,
};

const NIIT_RATE = 0.038;

// Net Investment Income Tax: 3.8% × min(investment income, MAGI − threshold).
// `investmentIncome` proxy in this model is the gross taxable-account withdrawal
// (we don't track cost basis separately) — same proxy used for federal LTCG.
export function calculateNIIT(
  magi: number,
  investmentIncome: number,
  filingStatus: FilingStatus,
): number {
  const threshold = NIIT_THRESHOLDS[filingStatus];
  const excess = Math.max(0, magi - threshold);
  const base = Math.min(Math.max(0, investmentIncome), excess);
  return base * NIIT_RATE;
}
