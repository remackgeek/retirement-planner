import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import YearCashFlowSankey from './YearCashFlowSankey';
import type {
  AnnualCashFlowBreakdown,
  AnnualAuditBreakdown,
} from '../../services/SimulationService';

// Minimal audit + breakdown factories. Kept inline so this test stays
// self-contained (sankeyLayout.test.ts has the deeper conservation coverage).
const audit = (o: Partial<AnnualAuditBreakdown> = {}): AnnualAuditBreakdown => ({
  agi: 0, standardDeduction: 0, seniorAddOn: 0, obbbReduction: 0, totalDeductions: 0,
  taxableIncome: 0, federalBracketIndex: 0, federalMarginalRate: 0, federalOrdinaryTax: 0,
  stateOrdinaryTax: 0, federalBrackets: [], numQualifyingSeniors: 0, effectiveStateName: 'TX',
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
  ...o,
});

const makeBreakdown = (o: Partial<AnnualCashFlowBreakdown> = {}): AnnualCashFlowBreakdown => ({
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
  audit: audit(),
  ...o,
});

describe('YearCashFlowSankey', () => {
  it('mounts with a representative breakdown and renders an SVG with nodes and links', () => {
    const breakdown = makeBreakdown({
      ssGross: 30_000,
      withdrawalFromTraditional: 50_000,
      rothConversionGross: 50_000,
      rothConversionRequested: 50_000,
      rothConversionTaxFromBrokerage: 10_000,
      withdrawalFromBrokerage: 10_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 15_000,
      totalTax: 15_000,
      surplusContribution: 5_000,
      audit: audit({ federalOrdinaryTax: 15_000 }),
    });
    const { container } = render(
      <YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />
    );
    expect(screen.getByTestId('year-cash-flow-sankey')).toBeTruthy();
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // At least the inflow nodes (SS, Trad pull is folded into RMD/conv split — only conv here), plus center + outflows.
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBeGreaterThan(3);
    // Conversion Roth deposit label must appear once.
    expect(screen.getByText(/Roth Deposit/)).toBeTruthy();
  });

  it('renders the depletion banner when spendingShortfall > 0', () => {
    const breakdown = makeBreakdown({
      withdrawalFromCash: 30_000,
      baseSpendingNet: 50_000,
      totalSpendingNet: 50_000,
      spendingShortfall: 20_000,
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    const banner = screen.getByTestId('depletion-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Portfolio depleted/);
    expect(banner.textContent).toMatch(/\$20,000/);
  });

  it('renders the transfer block when cash refill / sweep are non-zero', () => {
    const breakdown = makeBreakdown({
      ssGross: 30_000,
      baseSpendingNet: 20_000,
      totalSpendingNet: 20_000,
      ordinaryTax: 10_000,
      totalTax: 10_000,
      cashRefillFromSurplus: 5_000,
      cashSweepToBrokerage: 0,
      audit: audit({ federalOrdinaryTax: 10_000 }),
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    const xfer = screen.getByTestId('sankey-transfers');
    expect(xfer.textContent).toMatch(/Cash refill/);
  });

  it('renders the empty-state message when no flows are present', () => {
    const breakdown = makeBreakdown();
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/No cash flow recorded/)).toBeTruthy();
  });

  it('renders SS as two distinct labels (Taxable + Tax-Free) when the zone is < 85%', () => {
    const breakdown = makeBreakdown({
      ssGross: 40_000,
      ssTaxableAmount: 20_000,
      baseSpendingNet: 40_000,
      totalSpendingNet: 40_000,
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Social Security \(Taxable\)/)).toBeTruthy();
    expect(screen.getByText(/Social Security \(Tax-Free\)/)).toBeTruthy();
  });

  it('renders per-event detail nodes in column 0 when multiple ordinary events are present', () => {
    const breakdown = makeBreakdown({
      otherTaxableGross: 80_000,
      baseSpendingNet: 65_000, totalSpendingNet: 65_000,
      ordinaryTax: 15_000, totalTax: 15_000,
      audit: audit({
        federalOrdinaryTax: 15_000,
        incomeEventTaxBreakdown: [
          { eventId: 'p-1', eventName: 'Acme Pension',   eventType: 'pension_income', gross: 50_000, taxableContribution: 50_000, marginalTax: 0, marginalRate: 0 },
          { eventId: 'r-1', eventName: 'Boston Rental',  eventType: 'rental_income', gross: 30_000, taxableContribution: 30_000, marginalTax: 0, marginalRate: 0 },
        ],
      }),
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Acme Pension/)).toBeTruthy();
    expect(screen.getByText(/Boston Rental/)).toBeTruthy();
  });

  it('renders per-account detail nodes for multiple brokerage accounts', () => {
    const breakdown = makeBreakdown({
      withdrawalFromBrokerage: 50_000,
      federalCapGainsTax: 7_500,
      baseSpendingNet: 42_500, totalSpendingNet: 42_500,
      totalTax: 7_500,
      audit: audit({
        accountFlows: [
          { accountId: 'brk-a', accountName: 'Vanguard Brokerage', accountType: 'brokerage', withdrawal: 30_000, deposit: 0 },
          { accountId: 'brk-b', accountName: 'Fidelity Brokerage', accountType: 'brokerage', withdrawal: 20_000, deposit: 0 },
        ],
      }),
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Vanguard Brokerage/)).toBeTruthy();
    expect(screen.getByText(/Fidelity Brokerage/)).toBeTruthy();
  });

  it('renders per-Roth-account deposit detail downstream of Roth Deposit (conversion)', () => {
    const breakdown = makeBreakdown({
      withdrawalFromTraditional: 40_000,
      rothConversionGross: 40_000,
      rothConversionRequested: 40_000,
      rothConversionGrossSelf: 40_000,
      audit: audit({
        rothConvDepositByAccount: [
          { accountId: 'rA', accountName: 'Vanguard Roth', accountType: 'roth', withdrawal: 0, deposit: 12_000 },
          { accountId: 'rB', accountName: 'Fidelity Roth', accountType: 'roth', withdrawal: 0, deposit: 28_000 },
        ],
      }),
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Vanguard Roth/)).toBeTruthy();
    expect(screen.getByText(/Fidelity Roth/)).toBeTruthy();
  });

  it('renders per-account RMD detail when multiple Traditional accounts contribute', () => {
    const breakdown = makeBreakdown({
      withdrawalFromTraditional: 40_000,
      rmdRequired: 40_000,
      baseSpendingNet: 40_000, totalSpendingNet: 40_000,
      audit: audit({
        rmdByAccount: [
          { accountId: 't-1', accountName: 'Vanguard Trad', accountType: 'traditional', withdrawal: 25_000, deposit: 0 },
          { accountId: 't-2', accountName: 'Fidelity Trad', accountType: 'traditional', withdrawal: 15_000, deposit: 0 },
        ],
      }),
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Vanguard Trad/)).toBeTruthy();
    expect(screen.getByText(/Fidelity Trad/)).toBeTruthy();
  });

  it('renders the three middle buckets when Ordinary, LTCG, and Tax-Exempt are all present', () => {
    const breakdown = makeBreakdown({
      ssGross: 30_000, ssTaxableAmount: 15_000,
      withdrawalFromBrokerage: 20_000,
      withdrawalFromRoth: 10_000,
      federalCapGainsTax: 3_000,
      baseSpendingNet: 57_000, totalSpendingNet: 57_000,
      totalTax: 3_000,
    });
    render(<YearCashFlowSankey breakdown={breakdown} pathFactor={1} displayCurrency="nominal" />);
    expect(screen.getByText(/Ordinary Income/)).toBeTruthy();
    expect(screen.getByText(/Capital Gains/)).toBeTruthy();
    expect(screen.getByText(/Tax-Exempt/)).toBeTruthy();
    expect(screen.getByText(/After-Tax Cash/)).toBeTruthy();
  });
});
