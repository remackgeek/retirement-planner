import { describe, it, expect } from 'vitest';
import { buildSankeyModel } from './sankeyLayout';
import type {
  AnnualCashFlowBreakdown,
  AnnualAuditBreakdown,
  IncomeEventTaxAttribution,
  AccountFlowRow,
} from '../../services/SimulationService';
import type { IncomeEventType } from '../../types/IncomeEvent';

// Test fixture for an ordinary-classification event. eventType is typed against
// the real IncomeEventType union so a string typo is a compile-time error
// (the original v3 ship missed pension_income/sale_of_property because both
// production code and fixtures agreed on the wrong string).
const ordinaryEvent = (overrides: Partial<Omit<IncomeEventTaxAttribution, 'eventType'>> & {
  eventId: string; eventName: string; gross: number; eventType?: IncomeEventType;
}): IncomeEventTaxAttribution => ({
  eventType: 'pension_income', taxableContribution: overrides.gross, marginalTax: 0, marginalRate: 0,
  ...overrides,
});

const ssEvent = (overrides: Partial<IncomeEventTaxAttribution> & {
  eventId: string; eventName: string; gross: number;
}): IncomeEventTaxAttribution => ({
  eventType: 'social_security', taxableContribution: 0, marginalTax: 0, marginalRate: 0,
  ...overrides,
});

const convEvent = (overrides: Partial<IncomeEventTaxAttribution> & {
  eventId: string; eventName: string; gross: number;
}): IncomeEventTaxAttribution => ({
  eventType: 'roth_conversion', taxableContribution: overrides.gross, marginalTax: 0, marginalRate: 0,
  ...overrides,
});

const acctFlow = (
  accountId: string,
  accountName: string,
  accountType: AccountFlowRow['accountType'],
  withdrawal: number,
  deposit = 0,
): AccountFlowRow => ({ accountId, accountName, accountType, withdrawal, deposit });

const emptyAudit = (overrides: Partial<AnnualAuditBreakdown> = {}): AnnualAuditBreakdown => ({
  agi: 0, standardDeduction: 0, seniorAddOn: 0, obbbReduction: 0, totalDeductions: 0,
  taxableIncome: 0, federalBracketIndex: 0, federalMarginalRate: 0, federalOrdinaryTax: 0,
  stateOrdinaryTax: 0, federalBrackets: [], numQualifyingSeniors: 0, effectiveStateName: 'Texas',
  stateOrdinaryBaseGross: 0, stateStdDeduction: 0, stateRetirementExclusionApplied: 0,
  stateSsIncludedInState: 0, stateMarginalRate: 0, stateBracketIndex: 0, stateLocalitySurcharge: 0,
  stateLtcgTaxableAtState: 0, stateLtcgThresholdApplied: 0,
  ssProvisionalIncome: 0, ssProvisionalThreshold1: 0, ssProvisionalThreshold2: 0, ssZone: 'none',
  irmaaLookbackMagi: 0, irmaaTierIndex: 0, irmaaTierUpperScaled: 0, irmaaPerEnrolleeAnnual: 0,
  irmaaEnrolleeCount: 0, irmaaMonthlySurcharge: 0,
  niitMagi: 0, niitThreshold: 0, niitMagiExcess: 0, niitInvestmentIncome: 0, niitTaxableBase: 0,
  rmdDivisorSelf: 0, rmdDivisorSpouse: 0,
  rmdBoyBalanceSelf: 0, rmdBoyBalanceSpouse: 0,
  incomeEventTaxBreakdown: [],
  spendingGoalBreakdown: [],
  ...overrides,
});

const emptyBreakdown = (overrides: Partial<AnnualCashFlowBreakdown> = {}): AnnualCashFlowBreakdown => ({
  ssGross: 0, otherTaxableGross: 0, afterTaxIncome: 0, totalGrossIncome: 0, ssTaxableAmount: 0,
  baseSpendingNet: 0, otherSpendingGoalsNet: 0, totalSpendingNet: 0, portfolioWithdrawal: 0,
  withdrawalFromBrokerage: 0, withdrawalFromTraditional: 0, withdrawalFromRoth: 0, withdrawalFromCash: 0,
  cashInterest: 0, cashEndingBalance: 0, cashRefillFromSurplus: 0, cashSweepToBrokerage: 0,
  totalTax: 0, ordinaryTax: 0, federalCapGainsTax: 0, stateCapGainsTax: 0, stateLocalitySurcharge: 0,
  irmaaSurcharge: 0, niitTax: 0, netCashFlow: 0,
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
  audit: emptyAudit(),
  ...overrides,
});

// Helper: each bucket's inflow == its outflow within $1.
const assertBucketsBalance = (audits: { id: string; diff: number }[]) => {
  for (const a of audits) {
    expect(Math.abs(a.diff)).toBeLessThan(1);
  }
};

describe('buildSankeyModel — global conservation', () => {
  it('balances for a simple wage year (pre-tax routes to Traditional)', () => {
    const breakdown = emptyBreakdown({
      otherTaxableGross: 80_000,
      preTaxContributions: 20_000,
      baseSpendingNet: 65_000,
      totalSpendingNet: 65_000,
      ordinaryTax: 15_000,
      totalTax: 15_000,
      audit: emptyAudit({ federalOrdinaryTax: 15_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    expect(m.inflowTotal).toBe(100_000);
    assertBucketsBalance(m.bucketAudits);
  });

  it('balances for an RMD-only year with surplus going to Taxable', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 30_000,
      rmdRequired: 30_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 5_000,
      totalTax: 5_000,
      surplusContribution: 5_000,
      audit: emptyAudit({ federalOrdinaryTax: 5_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
  });

  // Regression: cash interest is credited INTO the cash balance by the engine and
  // is therefore already inside `withdrawalFromCash`. Before the fix, buildSankeyModel
  // counted it twice (once as the `src_cashint` Ordinary source, once embedded in the
  // Tax-Exempt cash withdrawal), so inflowTotal overshot outflowTotal by exactly
  // cashInterest — surfacing the dev-mode "engine drift" banner with worst-bucket and
  // worst-aggregator drift both $0 (only the un-audited After-Tax Cash node was off).
  it('balances when cash interest accrues AND cash is withdrawn (interest fully withdrawn)', () => {
    // availableCash = otherTaxableGross - cashInterest = 0, so all spending + tax is
    // funded by withdrawals: cash 70k + brokerage 10k + trad 100k = 180k = spend 168.5k + tax 11.5k.
    const breakdown = emptyBreakdown({
      otherTaxableGross: 3_000, // engine folds cashInterest into otherTaxableGross
      cashInterest: 3_000,
      withdrawalFromCash: 70_000,
      withdrawalFromBrokerage: 10_000,
      withdrawalFromTraditional: 100_000,
      baseSpendingNet: 168_500,
      totalSpendingNet: 168_500,
      ordinaryTax: 10_000,
      federalCapGainsTax: 1_500,
      totalTax: 11_500,
      audit: emptyAudit({ federalOrdinaryTax: 10_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
  });

  it('balances when cash interest accrues but cash is NOT withdrawn (interest retained)', () => {
    // Pension $300k covers $60k spending; cash interest $200k is reinvested in the cash
    // balance (not spent). otherTaxableGross = pension + interest = $500k. availableCash =
    // 500k - 200k = 300k; surplus = 300k - 8k tax - 60k spend = 232k.
    const breakdown = emptyBreakdown({
      otherTaxableGross: 500_000,
      cashInterest: 200_000,
      withdrawalFromCash: 0,
      baseSpendingNet: 60_000,
      totalSpendingNet: 60_000,
      ordinaryTax: 8_000,
      totalTax: 8_000,
      surplusContribution: 232_000,
      audit: emptyAudit({ federalOrdinaryTax: 8_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
  });

  it('balances for a Roth conversion year with Taxable-funded conv tax and no withholding', () => {
    const breakdown = emptyBreakdown({
      ssGross: 30_000,
      ssTaxableAmount: 25_500,
      withdrawalFromTraditional: 50_000,
      rothConversionGross: 50_000,
      rothConversionRequested: 50_000,
      rothConversionTaxFromBrokerage: 10_000,
      rothConversionTaxWithheld: 0,
      withdrawalFromBrokerage: 10_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 15_000,
      totalTax: 15_000,
      surplusContribution: 5_000,
      audit: emptyAudit({ federalOrdinaryTax: 15_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
  });

  it('balances when withholding funds part of the conversion', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 40_000,
      rothConversionGross: 40_000,
      rothConversionRequested: 40_000,
      rothConversionTaxWithheld: 8_000,
      ordinaryTax: 8_000,
      totalTax: 8_000,
      audit: emptyAudit({ federalOrdinaryTax: 8_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
    // Roth deposit edge value = gross - withheld = $32k.
    const rothDep = m.links.find(l => l.target === 'dst_rothdep');
    expect(rothDep?.value).toBe(32_000);
    // It originates at Ordinary Income (the conv pass-through chain).
    expect(rothDep?.source).toBe('bucket_ord');
  });

  it('scales spending outflows when there is a shortfall (and still balances)', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromCash: 30_000,
      baseSpendingNet: 50_000,
      totalSpendingNet: 50_000,
      spendingShortfall: 20_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.shortfall).toBe(20_000);
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
    const living = m.links.find(l => l.target === 'dst_living');
    expect(living?.value).toBe(30_000);
  });
});

describe('buildSankeyModel — Social Security split', () => {
  it('splits ssGross into Taxable + Tax-Free nodes when zone < 85%', () => {
    // ssTaxableAmount = 50% of ssGross → both nodes present.
    const breakdown = emptyBreakdown({
      ssGross: 40_000,
      ssTaxableAmount: 20_000,
      baseSpendingNet: 40_000,
      totalSpendingNet: 40_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const ssTaxable = m.nodes.find(n => n.id === 'src_ss_taxable');
    const ssFree = m.nodes.find(n => n.id === 'src_ss_free');
    expect(ssTaxable?.total).toBe(20_000);
    expect(ssFree?.total).toBe(20_000);
    // The taxable half feeds Ordinary Income; the tax-free half feeds Tax-Exempt.
    expect(m.links.find(l => l.source === 'src_ss_taxable')?.target).toBe('bucket_ord');
    expect(m.links.find(l => l.source === 'src_ss_free')?.target).toBe('bucket_exempt');
  });

  it('omits the Tax-Free SS node when SS is fully taxable (85% zone with rounding to gross)', () => {
    // Engine wouldn't realistically push to exactly 100% taxable, but we use it
    // to verify zero-edge omission.
    const breakdown = emptyBreakdown({
      ssGross: 40_000,
      ssTaxableAmount: 40_000,
      baseSpendingNet: 40_000,
      totalSpendingNet: 40_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'src_ss_taxable')).toBeDefined();
    expect(m.nodes.find(n => n.id === 'src_ss_free')).toBeUndefined();
  });

  it('omits both SS nodes when ssGross is zero', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromCash: 20_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'src_ss_taxable')).toBeUndefined();
    expect(m.nodes.find(n => n.id === 'src_ss_free')).toBeUndefined();
  });
});

describe('buildSankeyModel — bucket topology', () => {
  it('emits Capital Gains bucket only when Taxable withdrawal is non-zero', () => {
    const ssOnly = buildSankeyModel(
      emptyBreakdown({
        ssGross: 30_000, ssTaxableAmount: 15_000,
        baseSpendingNet: 30_000, totalSpendingNet: 30_000,
      }),
      1, 'nominal'
    );
    expect(ssOnly.nodes.find(n => n.id === 'bucket_capgains')).toBeUndefined();

    const withTaxable = buildSankeyModel(
      emptyBreakdown({
        withdrawalFromBrokerage: 20_000,
        federalCapGainsTax: 3_000,
        baseSpendingNet: 17_000, totalSpendingNet: 17_000,
        totalTax: 3_000,
        audit: emptyAudit(),
      }),
      1, 'nominal'
    );
    expect(withTaxable.nodes.find(n => n.id === 'bucket_capgains')).toBeDefined();
    const cgAudit = withTaxable.bucketAudits.find(a => a.id === 'bucket_capgains');
    expect(cgAudit?.inflow).toBe(20_000);
    expect(Math.abs(cgAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('routes LTCG and NIIT through the Capital Gains bucket', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromBrokerage: 50_000,
      federalCapGainsTax: 7_500,
      stateCapGainsTax: 2_500,
      niitTax: 1_900,
      baseSpendingNet: 38_100,
      totalSpendingNet: 38_100,
      totalTax: 11_900,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const fedLtcg = m.links.find(l => l.target === 'dst_fedltcg');
    const stateLtcg = m.links.find(l => l.target === 'dst_stateltcg');
    const niit = m.links.find(l => l.target === 'dst_niit');
    expect(fedLtcg?.source).toBe('bucket_capgains');
    expect(stateLtcg?.source).toBe('bucket_capgains');
    expect(niit?.source).toBe('bucket_capgains');
    assertBucketsBalance(m.bucketAudits);
  });

  it('routes IRMAA through the Ordinary Income bucket', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 80_000,
      rmdRequired: 80_000,
      baseSpendingNet: 50_000,
      totalSpendingNet: 50_000,
      ordinaryTax: 15_000,
      irmaaSurcharge: 5_000,
      totalTax: 20_000,
      surplusContribution: 10_000,
      audit: emptyAudit({ federalOrdinaryTax: 15_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const irmaa = m.links.find(l => l.target === 'dst_irmaa');
    expect(irmaa?.source).toBe('bucket_ord');
    expect(irmaa?.value).toBe(5_000);
  });

  it('Tax-Exempt bucket has full inflow == After-Tax Cash residual (no taxes)', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromRoth: 25_000,
      baseSpendingNet: 25_000,
      totalSpendingNet: 25_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const teAudit = m.bucketAudits.find(a => a.id === 'bucket_exempt');
    expect(teAudit?.inflow).toBe(25_000);
    expect(Math.abs(teAudit?.diff ?? 1)).toBeLessThan(1);
    // The single residual link from Tax-Exempt should carry the full inflow.
    const teResidual = m.links.find(l => l.source === 'bucket_exempt' && l.target === 'cashpool');
    expect(teResidual?.value).toBe(25_000);
  });

  it('Living Expenses pulls from After-Tax Cash, not directly from a bucket', () => {
    const breakdown = emptyBreakdown({
      ssGross: 40_000, ssTaxableAmount: 0,
      baseSpendingNet: 40_000, totalSpendingNet: 40_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const living = m.links.find(l => l.target === 'dst_living');
    expect(living?.source).toBe('cashpool');
  });
});

describe('buildSankeyModel — zero-edge omission', () => {
  it('omits inflow nodes whose source amount is zero', () => {
    const breakdown = emptyBreakdown({
      ssGross: 30_000, ssTaxableAmount: 15_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 10_000,
      totalTax: 10_000,
      audit: emptyAudit({ federalOrdinaryTax: 10_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const sourceIds = m.nodes.map(n => n.id);
    expect(sourceIds).toContain('src_ss_taxable');
    expect(sourceIds).toContain('src_ss_free');
    expect(sourceIds).not.toContain('src_rmd');
    expect(sourceIds).not.toContain('src_trad');
    expect(sourceIds).not.toContain('src_conv');
    expect(sourceIds).not.toContain('src_taxable');
    expect(sourceIds).not.toContain('src_cash');
    expect(sourceIds).not.toContain('src_roth');
  });

  it('omits outflow nodes whose amount is zero', () => {
    const breakdown = emptyBreakdown({
      ssGross: 30_000, ssTaxableAmount: 15_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 10_000,
      totalTax: 10_000,
      audit: emptyAudit({ federalOrdinaryTax: 10_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const outIds = m.nodes.map(n => n.id);
    expect(outIds).toContain('dst_living');
    expect(outIds).toContain('dst_fedord');
    expect(outIds).not.toContain('dst_goals');
    expect(outIds).not.toContain('dst_irmaa');
    expect(outIds).not.toContain('dst_niit');
    expect(outIds).not.toContain('dst_rothdep');
  });
});

describe('buildSankeyModel — cash and transfers', () => {
  it('surfaces withdrawalFromCash as a dedicated Tax-Exempt source', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromCash: 12_000,
      baseSpendingNet: 12_000,
      totalSpendingNet: 12_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const cashLink = m.links.find(l => l.source === 'src_cash');
    expect(cashLink).toBeDefined();
    expect(cashLink?.target).toBe('bucket_exempt');
    expect(cashLink?.value).toBe(12_000);
  });

  it('renders cash refill and sweep as transfer edges that do not affect conservation', () => {
    const breakdown = emptyBreakdown({
      ssGross: 30_000, ssTaxableAmount: 15_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 10_000,
      totalTax: 10_000,
      cashRefillFromSurplus: 5_000,
      cashSweepToBrokerage: 2_000,
      audit: emptyAudit({ federalOrdinaryTax: 10_000 }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
    assertBucketsBalance(m.bucketAudits);
    const refill = m.links.find(l => l.kind === 'transfer' && l.source === 'xfer_brokerage_src');
    const sweep = m.links.find(l => l.kind === 'transfer' && l.source === 'xfer_cash_src');
    expect(refill?.value).toBe(5_000);
    expect(sweep?.value).toBe(2_000);
  });
});

describe('buildSankeyModel — column-0 detail (per income event)', () => {
  it('emits one detail node per ordinary event feeding the Wage & Other aggregator', () => {
    const breakdown = emptyBreakdown({
      otherTaxableGross: 80_000,
      baseSpendingNet: 65_000, totalSpendingNet: 65_000,
      ordinaryTax: 15_000, totalTax: 15_000,
      audit: emptyAudit({
        federalOrdinaryTax: 15_000,
        incomeEventTaxBreakdown: [
          ordinaryEvent({ eventId: 'pension-1', eventName: 'Acme Pension', eventType: 'pension_income', gross: 30_000 }),
          ordinaryEvent({ eventId: 'rental-1',  eventName: 'Boston Rental', eventType: 'rental_income', gross: 20_000 }),
          ordinaryEvent({ eventId: 'wage-1',    eventName: 'Wage', eventType: 'wage_income', gross: 30_000 }),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'detail_pension-1')?.label).toBe('Acme Pension');
    expect(m.nodes.find(n => n.id === 'detail_rental-1')?.label).toBe('Boston Rental');
    expect(m.nodes.find(n => n.id === 'detail_wage-1')?.label).toBe('Wage');
    // All three detail edges target the Wage & Other aggregator.
    const detailLinks = m.links.filter(l => l.target === 'src_wage');
    expect(detailLinks.map(l => l.value).sort((a, b) => a - b)).toEqual([20_000, 30_000, 30_000]);
    // Aggregator audit: detailSum should equal expected.
    const wageAudit = m.aggregatorAudits.find(a => a.id === 'src_wage');
    expect(wageAudit?.expected).toBe(80_000);
    expect(Math.abs(wageAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('falls back to single-aggregator node when no ordinary events are present', () => {
    const breakdown = emptyBreakdown({
      otherTaxableGross: 50_000,
      baseSpendingNet: 40_000, totalSpendingNet: 40_000,
      ordinaryTax: 10_000, totalTax: 10_000,
      audit: emptyAudit({ federalOrdinaryTax: 10_000 /* no events */ }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'src_wage')?.total).toBe(50_000);
    // No detail nodes targeting src_wage.
    expect(m.links.filter(l => l.target === 'src_wage' && l.kind === 'main')).toHaveLength(0);
    expect(m.aggregatorAudits.find(a => a.id === 'src_wage')).toBeUndefined();
  });

  it('emits a residual detail node when event sum < aggregator amount', () => {
    // Only one event listed; aggregator amount is higher.
    const breakdown = emptyBreakdown({
      otherTaxableGross: 100_000,
      baseSpendingNet: 90_000, totalSpendingNet: 90_000,
      ordinaryTax: 10_000, totalTax: 10_000,
      audit: emptyAudit({
        federalOrdinaryTax: 10_000,
        incomeEventTaxBreakdown: [
          ordinaryEvent({ eventId: 'pension-only', eventName: 'Pension', eventType: 'pension_income', gross: 60_000 }),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const residual = m.nodes.find(n => n.id === 'detail_residual_src_wage');
    expect(residual?.label).toBe('Other ordinary');
    expect(residual?.total).toBeCloseTo(40_000, 0);
    const wageAudit = m.aggregatorAudits.find(a => a.id === 'src_wage');
    expect(Math.abs(wageAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('splits each SS event into taxable + tax-free edges by the year-aggregate ratio', () => {
    const breakdown = emptyBreakdown({
      ssGross: 40_000,
      ssTaxableAmount: 20_000, // 50% taxable
      baseSpendingNet: 40_000, totalSpendingNet: 40_000,
      audit: emptyAudit({
        incomeEventTaxBreakdown: [
          ssEvent({ eventId: 'ss-self',   eventName: 'SS Self',   gross: 30_000 }),
          ssEvent({ eventId: 'ss-spouse', eventName: 'SS Spouse', gross: 10_000 }),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    // Each SS detail node carries the full event gross.
    expect(m.nodes.find(n => n.id === 'detail_ss-self')?.total).toBe(30_000);
    expect(m.nodes.find(n => n.id === 'detail_ss-spouse')?.total).toBe(10_000);
    // Each emits a taxable edge (50% of gross) and a tax-free edge (50%).
    const selfTaxable = m.links.find(l => l.source === 'detail_ss-self' && l.target === 'src_ss_taxable');
    const selfFree    = m.links.find(l => l.source === 'detail_ss-self' && l.target === 'src_ss_free');
    expect(selfTaxable?.value).toBe(15_000);
    expect(selfFree?.value).toBe(15_000);
    // Per-aggregator conservation.
    const taxAudit = m.aggregatorAudits.find(a => a.id === 'src_ss_taxable');
    expect(taxAudit?.detailSum).toBeCloseTo(20_000, 0);
    expect(Math.abs(taxAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('emits a detail node for each Roth conversion event', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 50_000,
      rothConversionGross: 50_000,
      rothConversionRequested: 50_000,
      audit: emptyAudit({
        incomeEventTaxBreakdown: [
          convEvent({ eventId: 'conv-2030', eventName: 'Roth Conversion 2030', gross: 50_000 }),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const detailLink = m.links.find(l => l.source === 'detail_conv-2030');
    expect(detailLink?.target).toBe('src_conv');
    expect(detailLink?.value).toBe(50_000);
    const convAudit = m.aggregatorAudits.find(a => a.id === 'src_conv');
    expect(Math.abs(convAudit?.diff ?? 1)).toBeLessThan(1);
  });
});

describe('buildSankeyModel — column-0 detail (per account withdrawal)', () => {
  it('emits one detail node per brokerage account, summing to withdrawalFromBrokerage', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromBrokerage: 50_000,
      federalCapGainsTax: 7_500,
      baseSpendingNet: 42_500, totalSpendingNet: 42_500,
      totalTax: 7_500,
      audit: emptyAudit({
        accountFlows: [
          acctFlow('brk-a', 'Vanguard Brokerage', 'brokerage', 30_000),
          acctFlow('brk-b', 'Fidelity Brokerage', 'brokerage', 20_000),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'detail_acct_brk-a')?.label).toBe('Vanguard Brokerage');
    expect(m.nodes.find(n => n.id === 'detail_acct_brk-b')?.label).toBe('Fidelity Brokerage');
    const links = m.links.filter(l => l.target === 'src_brokerage');
    expect(links.map(l => l.value).sort((a, b) => a - b)).toEqual([20_000, 30_000]);
    const audit = m.aggregatorAudits.find(a => a.id === 'src_brokerage');
    expect(Math.abs(audit?.diff ?? 1)).toBeLessThan(1);
  });

  it('emits per-account detail for cash and Roth withdrawals', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromCash: 15_000,
      withdrawalFromRoth: 25_000,
      baseSpendingNet: 40_000, totalSpendingNet: 40_000,
      audit: emptyAudit({
        accountFlows: [
          acctFlow('cash-a', 'HYSA',     'cash',   15_000),
          acctFlow('roth-a', 'Roth IRA', 'roth',   25_000),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.links.find(l => l.source === 'detail_acct_cash-a')?.target).toBe('src_cash');
    expect(m.links.find(l => l.source === 'detail_acct_roth-a')?.target).toBe('src_roth');
  });

  it('emits one detail node per Traditional account contributing RMD, summing to rmdRequired', () => {
    // Self age 75 + Spouse age 65, both have Trad. Per-owner RMD discipline
    // means Self-Trad gets all the RMD; Spouse-Trad has zero RMD share.
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 32_000,
      rmdRequired: 32_000,
      audit: emptyAudit({
        rmdByAccount: [
          acctFlow('trad-self', 'Self Trad', 'traditional', 32_000),
          // Spouse-Trad row is omitted by the engine when withdrawal is zero.
        ],
      }),
      baseSpendingNet: 32_000,
      totalSpendingNet: 32_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const detail = m.nodes.find(n => n.id === 'detail_rmd_acct_trad-self');
    expect(detail?.label).toBe('Self Trad');
    expect(detail?.total).toBe(32_000);
    const link = m.links.find(l => l.source === 'detail_rmd_acct_trad-self');
    expect(link?.target).toBe('src_rmd');
    expect(link?.value).toBe(32_000);
    // Per-aggregator conservation.
    const rmdAudit = m.aggregatorAudits.find(a => a.id === 'src_rmd');
    expect(Math.abs(rmdAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('emits multiple detail nodes when both spouses contribute RMD', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 40_000,
      rmdRequired: 40_000,
      audit: emptyAudit({
        rmdByAccount: [
          acctFlow('trad-self',   'Self Trad',   'traditional', 25_000),
          acctFlow('trad-spouse', 'Spouse Trad', 'traditional', 15_000),
        ],
      }),
      baseSpendingNet: 40_000,
      totalSpendingNet: 40_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const links = m.links.filter(l => l.target === 'src_rmd');
    expect(links.map(l => l.value).sort((a, b) => a - b)).toEqual([15_000, 25_000]);
    const rmdAudit = m.aggregatorAudits.find(a => a.id === 'src_rmd');
    expect(Math.abs(rmdAudit?.diff ?? 1)).toBeLessThan(1);
  });

  it('emits detail nodes downstream of dst_rothdep when rothConvDepositByAccount has rows', () => {
    // Self conversion $50k landing in two Self-owned Roth accounts proportionally.
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 50_000,
      rothConversionGross: 50_000,
      rothConversionRequested: 50_000,
      rothConversionGrossSelf: 50_000,
      audit: emptyAudit({
        rothConvDepositByAccount: [
          acctFlow('roth-a', 'Vanguard Roth', 'roth', 0, 15_000),
          acctFlow('roth-b', 'Fidelity Roth', 'roth', 0, 35_000),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const a = m.links.find(l => l.source === 'dst_rothdep' && l.target === 'detail_rothdep_acct_roth-a');
    const b = m.links.find(l => l.source === 'dst_rothdep' && l.target === 'detail_rothdep_acct_roth-b');
    expect(a?.value).toBe(15_000);
    expect(b?.value).toBe(35_000);
    // Aggregator audit added for dst_rothdep.
    const audit = m.aggregatorAudits.find(x => x.id === 'dst_rothdep');
    expect(audit).toBeDefined();
    expect(Math.abs(audit?.diff ?? 1)).toBeLessThan(1);
  });

  it('single-account Roth deposit emits one identity detail node', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 25_000,
      rothConversionGross: 25_000,
      rothConversionRequested: 25_000,
      rothConversionGrossSelf: 25_000,
      audit: emptyAudit({
        rothConvDepositByAccount: [
          acctFlow('roth-only', 'Roth IRA', 'roth', 0, 25_000),
        ],
      }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    const link = m.links.find(l => l.source === 'dst_rothdep' && l.target === 'detail_rothdep_acct_roth-only');
    expect(link?.value).toBe(25_000);
  });

  it('falls back to single dst_rothdep node when rothConvDepositByAccount is missing', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 25_000,
      rothConversionGross: 25_000,
      rothConversionRequested: 25_000,
      rothConversionGrossSelf: 25_000,
      audit: emptyAudit({ /* rothConvDepositByAccount intentionally undefined */ }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    // dst_rothdep still present as a use node.
    expect(m.nodes.find(n => n.id === 'dst_rothdep')?.total).toBe(25_000);
    // No downstream detail emitted.
    expect(m.nodes.find(n => n.id.startsWith('detail_rothdep_acct_'))).toBeUndefined();
    expect(m.aggregatorAudits.find(a => a.id === 'dst_rothdep')).toBeUndefined();
  });

  it('emits no RMD detail when rmdByAccount is empty (pre-RMD or no Trad)', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromCash: 25_000,
      baseSpendingNet: 25_000,
      totalSpendingNet: 25_000,
      audit: emptyAudit({ rmdByAccount: [] }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    // No detail node prefixed with detail_rmd_acct_.
    expect(m.nodes.find(n => n.id.startsWith('detail_rmd_acct_'))).toBeUndefined();
    expect(m.aggregatorAudits.find(a => a.id === 'src_rmd')).toBeUndefined();
  });

  it('falls back to single-aggregator RMD node when rmdByAccount is missing', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromTraditional: 10_000,
      rmdRequired: 10_000,
      audit: emptyAudit({ /* rmdByAccount intentionally undefined */ }),
      baseSpendingNet: 10_000,
      totalSpendingNet: 10_000,
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    // RMD aggregator still present, but no upstream detail.
    expect(m.nodes.find(n => n.id === 'src_rmd')?.total).toBe(10_000);
    expect(m.nodes.find(n => n.id.startsWith('detail_rmd_acct_'))).toBeUndefined();
  });

  it('falls back to single-aggregator node when accountFlows is missing', () => {
    const breakdown = emptyBreakdown({
      withdrawalFromBrokerage: 30_000,
      baseSpendingNet: 30_000, totalSpendingNet: 30_000,
      audit: emptyAudit({ /* no accountFlows */ }),
    });
    const m = buildSankeyModel(breakdown, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'src_brokerage')?.total).toBe(30_000);
    expect(m.links.filter(l => l.target === 'src_brokerage' && l.source.startsWith('detail_acct_'))).toHaveLength(0);
  });
});

describe('buildSankeyModel — display currency', () => {
  it('deflates all flows by pathFactor in real mode', () => {
    const breakdown = emptyBreakdown({
      ssGross: 30_000, ssTaxableAmount: 0,
      baseSpendingNet: 30_000,
      totalSpendingNet: 30_000,
    });
    const nominalModel = buildSankeyModel(breakdown, 2, 'nominal');
    const realModel = buildSankeyModel(breakdown, 2, 'real');
    expect(nominalModel.inflowTotal).toBe(30_000);
    expect(realModel.inflowTotal).toBe(15_000);
  });
});

describe('per-goal spending sink nodes', () => {
  const goalBreakdown = () => emptyBreakdown({
    otherTaxableGross: 110_000,
    baseSpendingNet: 60_000,
    otherSpendingGoalsNet: 44_000,
    totalSpendingNet: 104_000,
    ordinaryTax: 6_000,
    totalTax: 6_000,
    audit: emptyAudit({
      federalOrdinaryTax: 6_000,
      spendingGoalBreakdown: [
        { goalId: 'g-live', goalName: 'Living', goalType: 'living_expenses', amountNet: 60_000 },
        { goalId: 'g-med', goalName: 'Healthcare', goalType: 'healthcare', amountNet: 14_000 },
        { goalId: 'g-kid', goalName: 'Mortgage Help', goalType: 'dependent_support', amountNet: 30_000 },
      ],
    }),
  });

  it('emits one sink node per non-living goal and drops the aggregate node', () => {
    const m = buildSankeyModel(goalBreakdown(), 1, 'nominal');
    const med = m.nodes.find(n => n.id === 'dst_goal_g-med');
    const kid = m.nodes.find(n => n.id === 'dst_goal_g-kid');
    expect(med?.label).toBe('Healthcare');
    expect(med?.total).toBe(14_000);
    expect(kid?.total).toBe(30_000);
    expect(m.nodes.some(n => n.id === 'dst_goals')).toBe(false);
    // Living expenses stay on the aggregate dst_living node.
    expect(m.nodes.find(n => n.id === 'dst_living')?.total).toBe(60_000);
    expect(Math.abs(m.conservationDiff)).toBeLessThan(1);
  });

  it('scales per-goal nodes by the shortfall factor like the aggregates', () => {
    const b = goalBreakdown();
    b.spendingShortfall = 52_000; // half the year's spending unfunded
    b.otherTaxableGross = 58_000;
    b.ordinaryTax = 0; b.totalTax = 0;
    b.audit!.federalOrdinaryTax = 0;
    const m = buildSankeyModel(b, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'dst_goal_g-med')?.total).toBe(7_000);
    expect(m.nodes.find(n => n.id === 'dst_goal_g-kid')?.total).toBe(15_000);
  });

  it('falls back to the aggregate node when audit is absent', () => {
    const b = goalBreakdown();
    delete b.audit;
    const m = buildSankeyModel(b, 1, 'nominal');
    expect(m.nodes.some(n => n.id === 'dst_goals')).toBe(true);
    expect(m.nodes.some(n => n.id.startsWith('dst_goal_'))).toBe(false);
  });

  it('falls back when the per-goal sum does not reconcile with the aggregate', () => {
    const b = goalBreakdown();
    b.audit!.spendingGoalBreakdown = [
      { goalId: 'g-med', goalName: 'Healthcare', goalType: 'healthcare', amountNet: 10_000 },
    ];
    const m = buildSankeyModel(b, 1, 'nominal');
    expect(m.nodes.find(n => n.id === 'dst_goals')?.total).toBe(44_000);
    expect(m.nodes.some(n => n.id.startsWith('dst_goal_'))).toBe(false);
  });
});
