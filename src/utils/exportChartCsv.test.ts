import { describe, it, expect } from 'vitest';
import { buildCsvContent } from './exportChartCsv';
import type {
  AnnualAuditBreakdown,
  AnnualCashFlowBreakdown,
} from '../services/SimulationService';

const audit = (o: Partial<AnnualAuditBreakdown> = {}): AnnualAuditBreakdown => ({
  agi: 0, standardDeduction: 0, seniorAddOn: 0, obbbReduction: 0, totalDeductions: 0,
  taxableIncome: 0, federalBracketIndex: 0, federalMarginalRate: 0, federalOrdinaryTax: 0,
  stateOrdinaryTax: 0, federalBrackets: [], numQualifyingSeniors: 0, effectiveStateName: 'Florida',
  stateOrdinaryBaseGross: 0, stateStdDeduction: 0, stateRetirementExclusionApplied: 0,
  stateSsIncludedInState: 0, stateMarginalRate: 0, stateBracketIndex: 0, stateLocalitySurcharge: 0,
  stateLtcgTaxableAtState: 0, stateLtcgThresholdApplied: 0,
  ssProvisionalIncome: 0, ssProvisionalThreshold1: 0, ssProvisionalThreshold2: 0, ssZone: 'none',
  irmaaLookbackMagi: 0, irmaaTierIndex: 0, irmaaTierUpperScaled: 0, irmaaPerEnrolleeAnnual: 0,
  irmaaEnrolleeCount: 0, irmaaMonthlySurcharge: 0,
  niitMagi: 0, niitThreshold: 0, niitMagiExcess: 0, niitInvestmentIncome: 0, niitTaxableBase: 0,
  rmdDivisorSelf: 0, rmdDivisorSpouse: 0, rmdBoyBalanceSelf: 0, rmdBoyBalanceSpouse: 0,
  incomeEventTaxBreakdown: [],
  spendingGoalBreakdown: [],
  ...o,
});

const breakdown = (o: Partial<AnnualCashFlowBreakdown> = {}): AnnualCashFlowBreakdown => ({
  ssGross: 0, otherTaxableGross: 0, afterTaxIncome: 0, totalGrossIncome: 0, ssTaxableAmount: 0,
  baseSpendingNet: 0, otherSpendingGoalsNet: 0, totalSpendingNet: 0, portfolioWithdrawal: 0,
  withdrawalFromBrokerage: 0, withdrawalFromTraditional: 0, withdrawalFromRoth: 0,
  withdrawalFromCash: 0, cashInterest: 0, cashEndingBalance: 0,
  cashRefillFromSurplus: 0, cashSweepToBrokerage: 0,
  totalTax: 0, ordinaryTax: 0, federalCapGainsTax: 0, stateCapGainsTax: 0,
  stateLocalitySurcharge: 0, irmaaSurcharge: 0, niitTax: 0, netCashFlow: 0,
  rmdRequired: 0, rmdExcess: 0, rmdRequiredSelf: 0, rmdRequiredSpouse: 0,
  rothConversionGross: 0, rothConversionRequested: 0,
  rothConversionTaxFromCash: 0, rothConversionTaxFromBrokerage: 0,
  rothConversionTaxFromRmdExcess: 0, rothConversionTaxWithheld: 0,
  rothConversionGrossSelf: 0, rothConversionGrossSpouse: 0,
  rothConversionTaxWithheldSelf: 0, rothConversionTaxWithheldSpouse: 0,
  spendingShortfall: 0, wageIncomeGross: 0,
  preTaxContributions: 0, rothContributions: 0, afterTaxContributions: 0, employerMatch: 0,
  contributionsCappedAmount: 0, surplusContribution: 0,
  boyBalanceTraditional: 0, boyBalanceRoth: 0, boyBalanceBrokerage: 0, boyBalanceCash: 0,
  audit: audit(),
  ...o,
});

const build = (breakdowns: AnnualCashFlowBreakdown[], goalIdOrder: string[] = []) =>
  buildCsvContent(
    'Test Scenario',
    breakdowns.map((_, i) => 2026 + i),
    breakdowns.map(() => 0), // nominal path
    breakdowns.map(() => 0), // median path
    breakdowns.map(() => 1), breakdowns.map(() => 1), breakdowns.map(() => 1),
    breakdowns,
    60,
    'nominal',
    { nominalHidden: false, medianHidden: false },
    null,
    goalIdOrder,
  );

describe('buildCsvContent', () => {
  it('includes the per-type BoY balance, shortfall, and cash columns', () => {
    const csv = build([breakdown({
      boyBalanceTraditional: 400000, boyBalanceRoth: 200000,
      boyBalanceBrokerage: 300000, boyBalanceCash: 50000,
      spendingShortfall: 1234, withdrawalFromCash: 4000, cashInterest: 2000,
    })]);
    const [, header, row] = csv.split('\n');
    for (const col of [
      'BoY Balance — Traditional', 'BoY Balance — Roth', 'BoY Balance — Brokerage', 'BoY Balance — Cash',
      'Spending Shortfall', 'Withdrawal — Cash', 'Cash Interest',
    ]) {
      expect(header).toContain(col);
    }
    const cells = row.split(',');
    const headerCells = header.split(',');
    const at = (name: string) => cells[headerCells.indexOf(name)];
    expect(at('BoY Balance — Traditional')).toBe('400000');
    expect(at('BoY Balance — Cash')).toBe('50000');
    expect(at('Spending Shortfall')).toBe('1234');
    expect(at('Withdrawal — Cash')).toBe('4000');
    expect(at('Cash Interest')).toBe('2000');
  });

  it('emits one column per non-living goal, ordered by the scenario goal list', () => {
    const bds = [
      breakdown({
        audit: audit({ spendingGoalBreakdown: [
          // First active year only has the second-listed goal.
          { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30000 },
        ] }),
      }),
      breakdown({
        audit: audit({ spendingGoalBreakdown: [
          { goalId: 'g-med', goalName: 'Healthcare', goalType: 'healthcare', amountNet: 14000 },
          { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30000 },
          { goalId: 'g-live', goalName: 'Living', goalType: 'living_expenses', amountNet: 60000 },
        ] }),
      }),
    ];
    const csv = build(bds, ['g-med', 'g-kid']);
    const [, header, row0, row1] = csv.split('\n');
    // Scenario order wins over first-appearance order; living excluded.
    const medIdx = header.indexOf('"Goal: Healthcare"');
    const kidIdx = header.indexOf('"Goal: Mortgage Help"');
    expect(medIdx).toBeGreaterThan(-1);
    expect(kidIdx).toBeGreaterThan(medIdx);
    expect(header).not.toContain('Goal: Living');
    const headerCells = header.split(',');
    const medCol = headerCells.indexOf('"Goal: Healthcare"');
    const kidCol = headerCells.indexOf('"Goal: Mortgage Help"');
    expect(row0.split(',')[medCol]).toBe('0');
    expect(row0.split(',')[kidCol]).toBe('30000');
    expect(row1.split(',')[medCol]).toBe('14000');
    expect(row1.split(',')[kidCol]).toBe('30000');
  });

  it('quotes goal names containing commas so columns stay aligned', () => {
    const csv = build([breakdown({
      audit: audit({ spendingGoalBreakdown: [
        { goalId: 'g-1', goalName: 'Travel, Europe', goalType: 'vacation', amountNet: 9000 },
      ] }),
    })]);
    const [, header, row] = csv.split('\n');
    expect(header).toContain('"Goal: Travel, Europe"');
    // Row cell count must match header cell count (the quoted comma doesn't split).
    const count = (line: string) => {
      let n = 1, inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) n++;
      }
      return n;
    };
    expect(count(row)).toBe(count(header));
  });
});
