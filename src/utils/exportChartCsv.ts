import type { AnnualCashFlowBreakdown } from '../services/SimulationService';
import { toDisplay, pathToDisplay, type DisplayCurrency } from './displayCurrency';

const csvQuote = (s: string) => `"${s.replace(/"/g, '""')}"`;

// Union of non-living spending goals across the horizon, ordered by the
// scenario's goal list (stable, matches the Expenses chart's series order);
// ids not in the list append in first-appearance order.
function collectGoalColumns(
  annualBreakdowns: AnnualCashFlowBreakdown[],
  goalIdOrder: string[],
): { goalId: string; goalName: string }[] {
  const found = new Map<string, string>();
  for (const bd of annualBreakdowns) {
    for (const g of bd.audit?.spendingGoalBreakdown ?? []) {
      if (g.goalType === 'living_expenses' || found.has(g.goalId)) continue;
      found.set(g.goalId, g.goalName);
    }
  }
  const ordered = goalIdOrder.filter((id) => found.has(id));
  const remaining = [...found.keys()].filter((id) => !ordered.includes(id));
  return [...ordered, ...remaining].map((goalId) => ({ goalId, goalName: found.get(goalId)! }));
}

// Pure CSV assembly — exported separately from the download trigger so tests
// can assert columns without a DOM.
export function buildCsvContent(
  scenarioName: string,
  years: number[],
  nominal: number[],
  median: number[],
  nominalInflation: number[],
  medianInflation: number[],
  breakdownInflation: number[],
  annualBreakdowns: AnnualCashFlowBreakdown[],
  currentAge: number,
  displayCurrency: DisplayCurrency,
  options: { nominalHidden: boolean; medianHidden: boolean },
  band: { p10: number[]; p90: number[] } | null,
  // Scenario spending-goal id order for the dynamic per-goal columns.
  goalIdOrder: string[] = [],
): string {
  const modeLabel = displayCurrency === 'real' ? "today's dollars" : 'nominal dollars';
  const timestamp = new Date().toISOString();
  const comment = `# scenario: ${scenarioName} | exported: ${timestamp} | values in ${modeLabel}`;
  const pathHeaders: string[] = [];
  if (!options.nominalHidden) pathHeaders.push('Projected Portfolio ($)');
  if (!options.medianHidden) pathHeaders.push('Median Portfolio ($)');
  if (band) pathHeaders.push('Band p10 ($)', 'Band p90 ($)');
  // One dynamic column per non-living spending goal (from
  // audit.spendingGoalBreakdown), matching the Expenses chart's series.
  const goalColumns = collectGoalColumns(annualBreakdowns, goalIdOrder);
  // Scalar audit columns are appended after the core columns. Per-event tax
  // attribution and per-account flows are NOT exported — they don't fit a flat
  // one-row-per-year CSV cleanly. See the Income Detail tab in the app for those.
  // Note: 'BoY Balance — *' are the per-account-type beginning-of-year balances
  // (the Balances chart); the audit 'BoY Trad Bal Self/Spouse' columns near the
  // end are the per-OWNER RMD basis — same instant, different decomposition.
  const header = [
    'Age', 'Year',
    ...pathHeaders,
    'SS Gross', 'Other Taxable Income', 'After-Tax Income', 'Total Gross Income',
    'Base Spending', 'Goal Spending',
    ...goalColumns.map((g) => csvQuote(`Goal: ${g.goalName}`)),
    'Total Spending', 'Spending Shortfall',
    'Total Tax', 'Ordinary Income Tax', 'Federal LTCG Tax', 'State LTCG Tax', 'NIIT (3.8%)', 'IRMAA Surcharge', 'Portfolio Withdrawal',
    'Withdrawal — Brokerage', 'Withdrawal — Traditional', 'Withdrawal — Roth', 'Withdrawal — Cash', 'Cash Interest',
    'RMD Required', 'RMD Reinvested',
    'Roth Conversion',
    'Surplus Contribution',
    'Net Cash Flow',
    'BoY Balance — Traditional', 'BoY Balance — Roth', 'BoY Balance — Brokerage', 'BoY Balance — Cash',
    // ---- audit columns ----
    'AGI', 'Standard Deduction', 'Senior Add-On', 'OBBB Reduction', 'Total Deductions', 'Taxable Income',
    'Federal Bracket Index', 'Federal Marginal Rate', 'Federal Ordinary Tax', 'State Ordinary Tax', 'Effective State',
    'State Std Deduction', 'State Retirement Exclusion', 'State SS Included', 'State Marginal Rate', 'State Bracket Index',
    'State Locality Surcharge', 'State LTCG Taxable', 'State LTCG Threshold',
    'SS Provisional Income', 'SS Zone',
    'IRMAA Lookback MAGI', 'IRMAA Tier', 'IRMAA Per-Enrollee Annual', 'IRMAA Enrollees',
    'NIIT MAGI', 'NIIT Threshold', 'NIIT MAGI Excess', 'NIIT Taxable Base',
    'RMD Self', 'RMD Spouse', 'RMD Divisor Self', 'RMD Divisor Spouse', 'BoY Trad Bal Self', 'BoY Trad Bal Spouse',
  ].join(',');

  const rows = years.map((year, i) => {
    const bd = annualBreakdowns[i];
    const bdF = breakdownInflation[i] ?? 1;
    const pathCells: number[] = [];
    if (!options.nominalHidden) {
      pathCells.push(Math.round(pathToDisplay(nominal[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
    }
    if (!options.medianHidden) {
      pathCells.push(Math.round(pathToDisplay(median[i] ?? 0, medianInflation[i] ?? 1, displayCurrency)));
    }
    if (band) {
      // Band values displayed using the deterministic inflation deflator —
      // matches the chart's band rendering.
      pathCells.push(Math.round(pathToDisplay(band.p10[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
      pathCells.push(Math.round(pathToDisplay(band.p90[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
    }
    const goalCells = goalColumns.map((col) => {
      const amount = (bd.audit?.spendingGoalBreakdown ?? [])
        .filter((g) => g.goalId === col.goalId)
        .reduce((s, g) => s + g.amountNet, 0);
      return Math.round(toDisplay(amount, bdF, displayCurrency));
    });
    return [
      currentAge + i,
      year,
      ...pathCells,
      Math.round(toDisplay(bd.ssGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.otherTaxableGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.afterTaxIncome, bdF, displayCurrency)),
      Math.round(toDisplay(bd.totalGrossIncome, bdF, displayCurrency)),
      Math.round(toDisplay(bd.baseSpendingNet, bdF, displayCurrency)),
      Math.round(toDisplay(bd.otherSpendingGoalsNet, bdF, displayCurrency)),
      ...goalCells,
      Math.round(toDisplay(bd.totalSpendingNet, bdF, displayCurrency)),
      Math.round(toDisplay(bd.spendingShortfall, bdF, displayCurrency)),
      Math.round(toDisplay(bd.totalTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.ordinaryTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.federalCapGainsTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.stateCapGainsTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.niitTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.irmaaSurcharge, bdF, displayCurrency)),
      Math.round(toDisplay(bd.portfolioWithdrawal, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromBrokerage, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromTraditional, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromRoth, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromCash, bdF, displayCurrency)),
      Math.round(toDisplay(bd.cashInterest, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdRequired, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdExcess, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rothConversionGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.surplusContribution, bdF, displayCurrency)),
      Math.round(toDisplay(bd.netCashFlow, bdF, displayCurrency)),
      Math.round(toDisplay(bd.boyBalanceTraditional, bdF, displayCurrency)),
      Math.round(toDisplay(bd.boyBalanceRoth, bdF, displayCurrency)),
      Math.round(toDisplay(bd.boyBalanceBrokerage, bdF, displayCurrency)),
      Math.round(toDisplay(bd.boyBalanceCash, bdF, displayCurrency)),
      // ---- audit columns ----
      Math.round(toDisplay(bd.audit?.agi ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.standardDeduction ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.seniorAddOn ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.obbbReduction ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.totalDeductions ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.taxableIncome ?? 0, bdF, displayCurrency)),
      bd.audit?.federalBracketIndex ?? 0,
      ((bd.audit?.federalMarginalRate ?? 0) * 100).toFixed(2) + '%',
      Math.round(toDisplay(bd.audit?.federalOrdinaryTax ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateOrdinaryTax ?? 0, bdF, displayCurrency)),
      // Quote the state name in case it contains a comma (e.g., "Washington, DC").
      csvQuote(bd.audit?.effectiveStateName ?? ''),
      Math.round(toDisplay(bd.audit?.stateStdDeduction ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateRetirementExclusionApplied ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateSsIncludedInState ?? 0, bdF, displayCurrency)),
      ((bd.audit?.stateMarginalRate ?? 0) * 100).toFixed(2) + '%',
      bd.audit?.stateBracketIndex ?? 0,
      Math.round(toDisplay(bd.audit?.stateLocalitySurcharge ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateLtcgTaxableAtState ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateLtcgThresholdApplied ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.ssProvisionalIncome ?? 0, bdF, displayCurrency)),
      bd.audit?.ssZone ?? 'none',
      Math.round(toDisplay(bd.audit?.irmaaLookbackMagi ?? 0, bdF, displayCurrency)),
      bd.audit?.irmaaTierIndex ?? 0,
      Math.round(toDisplay(bd.audit?.irmaaPerEnrolleeAnnual ?? 0, bdF, displayCurrency)),
      bd.audit?.irmaaEnrolleeCount ?? 0,
      Math.round(toDisplay(bd.audit?.niitMagi ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitThreshold ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitMagiExcess ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitTaxableBase ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdRequiredSelf, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdRequiredSpouse, bdF, displayCurrency)),
      (bd.audit?.rmdDivisorSelf ?? 0).toFixed(1),
      (bd.audit?.rmdDivisorSpouse ?? 0).toFixed(1),
      Math.round(toDisplay(bd.audit?.rmdBoyBalanceSelf ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.rmdBoyBalanceSpouse ?? 0, bdF, displayCurrency)),
    ].join(',');
  });

  return [comment, header, ...rows].join('\n');
}

// Builds and downloads the yearly-data CSV for the chart's primary path.
// DOM download wrapper over buildCsvContent. Extracted from Chart.tsx.
export function exportCsv(
  scenarioName: string,
  years: number[],
  nominal: number[],
  median: number[],
  nominalInflation: number[],
  medianInflation: number[],
  breakdownInflation: number[],
  annualBreakdowns: AnnualCashFlowBreakdown[],
  currentAge: number,
  displayCurrency: DisplayCurrency,
  options: { nominalHidden: boolean; medianHidden: boolean },
  band: { p10: number[]; p90: number[] } | null,
  goalIdOrder: string[] = [],
) {
  const csv = buildCsvContent(
    scenarioName, years, nominal, median, nominalInflation, medianInflation,
    breakdownInflation, annualBreakdowns, currentAge, displayCurrency, options, band, goalIdOrder,
  );
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scenarioName.replace(/[^a-z0-9]/gi, '-')}-projection.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
