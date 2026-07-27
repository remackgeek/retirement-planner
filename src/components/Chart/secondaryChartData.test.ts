import { describe, it, expect } from 'vitest';
import {
  buildSecondaryChart,
  hasConversions,
  type SecondaryChartInputs,
} from './secondaryChartData';
import {
  SYNTHETIC_TRAD_WITHDRAWAL_ID,
  SYNTHETIC_SS_AGGREGATE_ID,
} from '../../services/SimulationService';
import { goalSeriesColor, GOAL_SERIES_COLORS } from '../../styles/chartCategoryColors';
import type {
  AnnualAuditBreakdown,
  AnnualCashFlowBreakdown,
} from '../../services/SimulationService';

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

const inputs = (
  breakdowns: AnnualCashFlowBreakdown[],
  o: Partial<SecondaryChartInputs> = {},
): SecondaryChartInputs => ({
  breakdowns,
  inflation: breakdowns.map(() => 1),
  years: breakdowns.map((_, i) => 2026 + i),
  labels: breakdowns.map((_, i) => `${65 + i} (${2026 + i})`),
  displayCurrency: 'nominal',
  showConversions: false,
  ...o,
});

const datasetTotal = (built: ReturnType<typeof buildSecondaryChart>, index: number): number =>
  built.data.datasets.reduce((s, ds) => s + (Number(ds.data[index]) || 0), 0);

describe('income view', () => {
  const bd = breakdown({
    ssGross: 30000,
    otherTaxableGross: 20000,
    afterTaxIncome: 5000,
    cashInterest: 2000,
    rmdRequired: 15000,
    withdrawalFromTraditional: 45000, // 15k RMD + 10k discretionary + 20k conversion
    rothConversionGross: 20000,
    withdrawalFromBrokerage: 12000,
    withdrawalFromRoth: 3000,
    withdrawalFromCash: 4000,
  });

  it('splits RMD, additional Traditional, and conversion into separate series', () => {
    const built = buildSecondaryChart('income', inputs([bd], { showConversions: true }));
    const byLabel = Object.fromEntries(built.data.datasets.map(ds => [ds.label, Number(ds.data[0])]));
    expect(byLabel['RMD (required)']).toBe(15000);
    expect(byLabel['Additional 401(k)/IRA']).toBe(10000);
    expect(byLabel['Roth conversion']).toBe(20000);
    expect(byLabel['Social Security']).toBe(30000);
    // Other income excludes cash interest and includes after-tax.
    expect(byLabel['Other income']).toBe(20000 - 2000 + 5000);
  });

  it('never renders cash interest as an income series (it is inside the cash withdrawal)', () => {
    const built = buildSecondaryChart('income', inputs([bd], { showConversions: true }));
    expect(built.data.datasets.some(ds => ds.label === 'Cash interest')).toBe(false);
    expect(built.legend.some(l => l.key === 'cashInterest')).toBe(false);
  });

  it('adds pre-tax deferrals back so working years show the full wage gross', () => {
    const working = breakdown({
      otherTaxableGross: 80000,   // wage net of a $20k pre-tax deferral
      preTaxContributions: 20000,
    });
    const built = buildSecondaryChart('income', inputs([working]));
    const other = built.data.datasets.find(ds => ds.label === 'Other income');
    expect(Number(other?.data[0])).toBe(100000);
  });

  it('excludes the conversion segment unless toggled on', () => {
    const off = buildSecondaryChart('income', inputs([bd], { showConversions: false }));
    expect(off.data.datasets.some(ds => ds.label === 'Roth conversion')).toBe(false);
    expect(off.legend.some(l => l.key === 'conversion')).toBe(false);
    // Without conversions the stack totals spendable inflows only
    // (no cash-interest term — see the double-count fix).
    expect(datasetTotal(off, 0)).toBeCloseTo(
      30000 + (20000 - 2000 + 5000) + 15000 + 10000 + 12000 + 3000 + 4000, 6);
  });

  it('tooltip itemization lists real income events and excludes synthetic/non-income rows', () => {
    const withEvents = breakdown({
      ...bd,
      audit: audit({
        incomeEventTaxBreakdown: [
          { eventId: 'pen-1', eventName: 'Acme Pension', eventType: 'pension_income', gross: 30000, taxableContribution: 30000, marginalTax: 0, marginalRate: 0 },
          { eventId: 'wage-1', eventName: 'Salary', eventType: 'wage_income', gross: 50000, taxableContribution: 50000, marginalTax: 0, marginalRate: 0 },
          { eventId: SYNTHETIC_TRAD_WITHDRAWAL_ID, eventName: 'Traditional Withdrawal', eventType: 'traditional_withdrawal', gross: 45000, taxableContribution: 45000, marginalTax: 0, marginalRate: 0 },
          { eventId: SYNTHETIC_SS_AGGREGATE_ID, eventName: 'Social Security', eventType: 'social_security', gross: 30000, taxableContribution: 15000, marginalTax: 0, marginalRate: 0 },
          { eventId: 'conv-1', eventName: 'Roth Conversion', eventType: 'roth_conversion', gross: 20000, taxableContribution: 20000, marginalTax: 0, marginalRate: 0 },
          { eventId: 'contrib-1', eventName: '401k Contribution', eventType: 'retirement_contribution', gross: 10000, taxableContribution: -10000, marginalTax: 0, marginalRate: 0 },
          { eventId: 'zero-1', eventName: 'Ended Rental', eventType: 'rental_income', gross: 0, taxableContribution: 0, marginalTax: 0, marginalRate: 0 },
        ],
      }),
    });
    const built = buildSecondaryChart('income', inputs([withEvents]));
    const afterBody = built.options.plugins?.tooltip?.callbacks?.afterBody;
    expect(afterBody).toBeTypeOf('function');
    const lines = (afterBody as (items: { dataIndex: number }[]) => string[]).call(
      {}, [{ dataIndex: 0 }],
    );
    expect(lines[0]).toBe('Other income detail:');
    expect(lines.slice(1)).toHaveLength(2);
    expect(lines.join('\n')).toContain('Acme Pension');
    expect(lines.join('\n')).toContain('Salary');
    // Synthetic Trad withdrawal, SS aggregate, conversion, contribution, and
    // zero-gross rows never appear — a renamed synthetic ID would otherwise
    // itemize a $45k Traditional pull as "other income".
    expect(lines.join('\n')).not.toContain('Traditional Withdrawal');
    expect(lines.join('\n')).not.toContain('Social Security');
    expect(lines.join('\n')).not.toContain('Roth Conversion');
    expect(lines.join('\n')).not.toContain('401k Contribution');
    expect(lines.join('\n')).not.toContain('Ended Rental');
  });

  it('drops all-zero series from datasets and legend', () => {
    const built = buildSecondaryChart('income', inputs([breakdown({ ssGross: 10000 })]));
    expect(built.data.datasets.map(ds => ds.label)).toEqual(['Social Security']);
    expect(built.legend.map(l => l.label)).toEqual(['Social Security']);
  });

  it('hasConversions gates on any conversion year', () => {
    expect(hasConversions([breakdown()])).toBe(false);
    expect(hasConversions([breakdown(), breakdown({ rothConversionGross: 1 })])).toBe(true);
  });

  it('carries the zero-row tooltip filter (no "RMD: $0" rows on hover)', () => {
    const built = buildSecondaryChart('income', inputs([bd]));
    expect(built.options.plugins?.tooltip?.filter).toBeTypeOf('function');
  });

  it('tooltip footer totals the year, excluding the conversion segment', () => {
    const built = buildSecondaryChart('income', inputs([bd], { showConversions: true }));
    const footer = built.options.plugins?.tooltip?.callbacks?.footer as
      (items: { dataset: { label?: string }; parsed: { y: number } }[]) => string[];
    expect(footer).toBeTypeOf('function');
    const items = [
      { dataset: { label: 'Social Security' }, parsed: { y: 30000 } },
      { dataset: { label: 'Brokerage' }, parsed: { y: 12000 } },
      { dataset: { label: 'Roth conversion' }, parsed: { y: 20000 } },
    ];
    expect(footer(items)).toEqual(['Total income: $42K', '(excludes Roth conversion)']);
    // No conversion item hovered → no parenthetical.
    expect(footer(items.slice(0, 2))).toEqual(['Total income: $42K']);
  });
});

describe('expenses view', () => {
  const goals = [
    { goalId: 'g-med', goalName: 'Healthcare', goalType: 'healthcare', amountNet: 14000 },
    { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30000 },
    { goalId: 'g-live', goalName: 'Living', goalType: 'living_expenses', amountNet: 60000 },
  ];
  const bd = breakdown({
    baseSpendingNet: 60000,
    otherSpendingGoalsNet: 44000,
    totalSpendingNet: 104000,
    totalTax: 9000,
    audit: audit({ spendingGoalBreakdown: goals }),
  });

  it('renders one series per non-living goal plus living expenses and taxes', () => {
    const built = buildSecondaryChart('expenses', inputs([bd]));
    const byLabel = Object.fromEntries(built.data.datasets.map(ds => [ds.label, Number(ds.data[0])]));
    expect(byLabel['Living expenses']).toBe(60000);
    expect(byLabel['Healthcare']).toBe(14000);
    expect(byLabel['Mortgage Help']).toBe(30000);
    expect(byLabel['Taxes']).toBe(9000);
    expect(built.data.datasets.some(ds => ds.label === 'Other goals')).toBe(false);
    expect(datasetTotal(built, 0)).toBeCloseTo(60000 + 44000 + 9000, 6);
  });

  it('never folds — every goal gets its own named series, colors wrapping past the cycle', () => {
    const many = Array.from({ length: 6 }, (_, k) => ({
      goalId: `g${k}`, goalName: `Goal ${k}`, goalType: 'other', amountNet: 1000 * (k + 1),
    }));
    const b = breakdown({
      otherSpendingGoalsNet: many.reduce((s, g) => s + g.amountNet, 0),
      audit: audit({ spendingGoalBreakdown: many }),
    });
    const built = buildSecondaryChart('expenses', inputs([b]));
    for (const g of many) {
      const ds = built.data.datasets.find(d => d.label === g.goalName);
      expect(Number(ds?.data[0])).toBe(g.amountNet);
    }
    expect(built.data.datasets.some(ds => ds.label === 'Other goals' || ds.label === 'Goals')).toBe(false);
    // 6th goal wraps to the first cycle color.
    expect(goalSeriesColor(5)).toBe(GOAL_SERIES_COLORS[0]);
    const first = built.data.datasets.find(d => d.label === 'Goal 0');
    const sixth = built.data.datasets.find(d => d.label === 'Goal 5');
    expect(sixth?.backgroundColor).toBe(first?.backgroundColor);
    expect(datasetTotal(built, 0)).toBeCloseTo(21000, 6);
  });

  it('falls back to a single "Goals" aggregate when audit is absent', () => {
    const b = breakdown({ otherSpendingGoalsNet: 25000, audit: undefined });
    const built = buildSecondaryChart('expenses', inputs([b]));
    const goalsAgg = built.data.datasets.find(ds => ds.label === 'Goals');
    expect(Number(goalsAgg?.data[0])).toBe(25000);
  });

  it('hides zero-value rows from the hover tooltip (ended goals, inactive series)', () => {
    const built = buildSecondaryChart('expenses', inputs([bd]));
    const filter = built.options.plugins?.tooltip?.filter;
    expect(filter).toBeTypeOf('function');
    const item = (y: number) => ({ parsed: { y } }) as Parameters<NonNullable<typeof filter>>[0];
    expect(filter!(item(14000), 0, [], built.data as never)).toBe(true);
    expect(filter!(item(0), 0, [], built.data as never)).toBe(false);
  });

  it('orders per-goal colors by the scenario goal list, not first active year', () => {
    // g-kid starts in year 0, g-med only in year 1 — but the scenario lists
    // g-med first, so g-med gets cycle color 0 regardless of activation order.
    const y0 = breakdown({
      otherSpendingGoalsNet: 30000, totalSpendingNet: 30000,
      audit: audit({ spendingGoalBreakdown: [
        { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30000 },
      ] }),
    });
    const y1 = breakdown({
      otherSpendingGoalsNet: 44000, totalSpendingNet: 44000,
      audit: audit({ spendingGoalBreakdown: [
        { goalId: 'g-med', goalName: 'Healthcare', goalType: 'healthcare', amountNet: 14000 },
        { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30000 },
      ] }),
    });
    const built = buildSecondaryChart('expenses', inputs([y0, y1], { goalIdOrder: ['g-med', 'g-kid'] }));
    const med = built.data.datasets.find(d => d.label === 'Healthcare');
    const kid = built.data.datasets.find(d => d.label === 'Mortgage Help');
    expect(med?.backgroundColor).toBe(goalSeriesColor(0));
    expect(kid?.backgroundColor).toBe(goalSeriesColor(1));
  });

  it('shows retirement contributions as an expense series in working years', () => {
    const working = breakdown({
      preTaxContributions: 20000,
      rothContributions: 7000,
      afterTaxContributions: 3000,
      employerMatch: 5000, // deliberately NOT included — never touches cash
    });
    const built = buildSecondaryChart('expenses', inputs([working]));
    const contrib = built.data.datasets.find(ds => ds.label === 'Retirement contributions');
    expect(Number(contrib?.data[0])).toBe(30000);
  });

  it('scales funded spending and shows the unfunded remainder in depleted years', () => {
    const depleted = breakdown({
      baseSpendingNet: 60000,
      otherSpendingGoalsNet: 40000,
      totalSpendingNet: 100000,
      spendingShortfall: 50000, // only half funded
      totalTax: 2000,
      audit: audit({ spendingGoalBreakdown: [
        { goalId: 'g-live', goalName: 'Living', goalType: 'living_expenses', amountNet: 60000 },
        { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 40000 },
      ] }),
    });
    const built = buildSecondaryChart('expenses', inputs([depleted]));
    const byLabel = Object.fromEntries(built.data.datasets.map(ds => [ds.label, Number(ds.data[0])]));
    expect(byLabel['Living expenses']).toBe(30000);       // 60k × 0.5 funded
    expect(byLabel['Mortgage Help']).toBe(20000);         // 40k × 0.5 funded
    expect(byLabel['Unfunded shortfall']).toBe(50000);
    expect(byLabel['Taxes']).toBe(2000);                  // unscaled
    // Stack still totals requested spending + taxes.
    expect(datasetTotal(built, 0)).toBeCloseTo(100000 + 2000, 6);
    const shortfallLegend = built.legend.find(l => l.key === 'shortfall');
    expect(shortfallLegend?.hatched).toBe(true);
  });

  it('omits the shortfall series entirely in fully-funded projections', () => {
    const built = buildSecondaryChart('expenses', inputs([bd]));
    expect(built.data.datasets.some(ds => ds.label === 'Unfunded shortfall')).toBe(false);
  });

  it('tooltip footer totals all expense segments for the hovered year', () => {
    const built = buildSecondaryChart('expenses', inputs([bd]));
    const footer = built.options.plugins?.tooltip?.callbacks?.footer as
      (items: { dataset: { label?: string }; parsed: { y: number } }[]) => string[];
    expect(footer).toBeTypeOf('function');
    expect(footer([
      { dataset: { label: 'Living expenses' }, parsed: { y: 60000 } },
      { dataset: { label: 'Healthcare' }, parsed: { y: 14000 } },
      { dataset: { label: 'Taxes' }, parsed: { y: 9000 } },
    ])).toEqual(['Total: $83K']);
  });
});

describe('taxes view', () => {
  it('segments sum to totalTax and the strip carries the marginal bracket', () => {
    const bd = breakdown({
      ordinaryTax: 14000, // fed 10000 + state 3000 + locality 1000
      stateLocalitySurcharge: 1000,
      federalCapGainsTax: 2000,
      stateCapGainsTax: 500,
      niitTax: 300,
      irmaaSurcharge: 1200,
      totalTax: 18000,
      audit: audit({ federalOrdinaryTax: 10000, stateOrdinaryTax: 3000, federalMarginalRate: 0.22 }),
    });
    const built = buildSecondaryChart('taxes', inputs([bd]));
    expect(datasetTotal(built, 0)).toBeCloseTo(18000, 6);
    const byLabel = Object.fromEntries(built.data.datasets.map(ds => [ds.label, Number(ds.data[0])]));
    expect(byLabel['Federal income tax']).toBe(10000);
    expect(byLabel['State & local tax']).toBe(4000);
    expect(byLabel['Capital gains tax']).toBe(2500);
    // The bracket renders in a separate strip (never a second y-axis).
    expect(built.strip).toBeTruthy();
    expect(built.strip!.data.datasets[0].data[0]).toBe(22);
    // The strip deliberately has NO zero-row filter — a 0% bracket is real
    // information, not noise.
    expect(built.strip!.options.plugins?.tooltip?.filter).toBeUndefined();
    // The bar tooltip totals the year's tax; the single-line strip does not.
    const footer = built.options.plugins?.tooltip?.callbacks?.footer as
      (items: { dataset: { label?: string }; parsed: { y: number } }[]) => string[];
    expect(footer([
      { dataset: { label: 'Federal income tax' }, parsed: { y: 10000 } },
      { dataset: { label: 'State & local tax' }, parsed: { y: 4000 } },
    ])).toEqual(['Total tax: $14K']);
    expect(built.strip!.options.plugins?.tooltip?.callbacks?.footer).toBeUndefined();
  });

  it('omits the strip when no year carries audit data, but segments still sum to totalTax', () => {
    const bd = breakdown({
      ordinaryTax: 11000, // fed fallback = ordinary − locality
      stateLocalitySurcharge: 1000,
      federalCapGainsTax: 500,
      niitTax: 200,
      irmaaSurcharge: 300,
      totalTax: 12000,
      audit: undefined,
    });
    const built = buildSecondaryChart('taxes', inputs([bd]));
    expect(built.strip).toBeUndefined();
    expect(built.legend.some(l => l.key === 'bracket')).toBe(false);
    expect(datasetTotal(built, 0)).toBeCloseTo(12000, 6);
  });
});

describe('balances view', () => {
  it('stacks the four boyBalance fields and honors real-dollar mode', () => {
    const bd = breakdown({
      boyBalanceTraditional: 400000, boyBalanceRoth: 200000,
      boyBalanceBrokerage: 300000, boyBalanceCash: 100000,
    });
    const built = buildSecondaryChart('balances', inputs([bd], { inflation: [2], displayCurrency: 'real' }));
    // Real mode divides by the inflation factor.
    expect(datasetTotal(built, 0)).toBeCloseTo(1_000_000 / 2, 6);
    expect(built.data.datasets.every(ds => ds.type === 'line')).toBe(true);
  });

  it('drops account types with no balance anywhere and filters zero tooltip rows', () => {
    const bd = breakdown({ boyBalanceTraditional: 400000, boyBalanceBrokerage: 300000 });
    const built = buildSecondaryChart('balances', inputs([bd]));
    expect(built.data.datasets.map(ds => ds.label)).toEqual(['Traditional', 'Brokerage']);
    expect(built.legend.map(l => l.label)).toEqual(['Traditional', 'Brokerage']);
    // Same zero-row tooltip hygiene as the bar views (a drained type mid-
    // projection shouldn't show "$0" rows forever).
    expect(built.options.plugins?.tooltip?.filter).toBeTypeOf('function');
  });

  it('tooltip footer totals the portfolio for the hovered year', () => {
    const bd = breakdown({ boyBalanceTraditional: 400000, boyBalanceBrokerage: 300000 });
    const built = buildSecondaryChart('balances', inputs([bd]));
    const footer = built.options.plugins?.tooltip?.callbacks?.footer as
      (items: { dataset: { label?: string }; parsed: { y: number } }[]) => string[];
    expect(footer([
      { dataset: { label: 'Traditional' }, parsed: { y: 400000 } },
      { dataset: { label: 'Brokerage' }, parsed: { y: 300000 } },
    ])).toEqual(['Total balance: $700K']);
  });
});

