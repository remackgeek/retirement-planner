import type { AnnualCashFlowBreakdown } from '../services/SimulationService';

// Effective tax rate = totalTax / cash actually flowing into the household.
// Excludes rothConversionGross because conversions inflate withdrawalFromTraditional
// without giving the household spendable cash (the dollars are re-deposited into Roth).
// Returns null when there's nothing to base a rate on, so callers can hide the row.
export function effectiveTaxRate(b: AnnualCashFlowBreakdown): number | null {
  const denom = b.totalGrossIncome + b.portfolioWithdrawal - b.rothConversionGross;
  if (denom <= 0 || b.totalTax <= 0) return null;
  return b.totalTax / denom;
}

export const fmtRate = (rate: number) => `${(rate * 100).toFixed(1)}%`;
