import type { AnnualCashFlowBreakdown } from '../services/SimulationService';

// Effective tax rate = income tax / cash actually flowing into the household.
// Excludes rothConversionGross because conversions inflate withdrawalFromTraditional
// without giving the household spendable cash (the dollars are re-deposited into Roth).
// Excludes irmaaSurcharge from the numerator: IRMAA is a Medicare premium, not an
// income tax — including it would inflate the displayed rate beyond what marginal
// math would produce.
// Returns null when there's nothing to base a rate on, so callers can hide the row.
export function effectiveTaxRate(b: AnnualCashFlowBreakdown): number | null {
  const denom = b.totalGrossIncome + b.portfolioWithdrawal - b.rothConversionGross;
  const incomeTax = b.totalTax - b.irmaaSurcharge;
  if (denom <= 0 || incomeTax <= 0) return null;
  return incomeTax / denom;
}
