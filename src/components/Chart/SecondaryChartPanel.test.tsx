import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SecondaryChartPanel from './SecondaryChartPanel';
import type {
  AnnualAuditBreakdown,
  AnnualCashFlowBreakdown,
} from '../../services/SimulationService';

// jsdom has no canvas — stub the chart component; the panel's markup (pills,
// legend chips, conversion toggle, strip block) is what's under test here.
// Dataset math is covered by secondaryChartData.test.ts.
vi.mock('react-chartjs-2', () => ({
  Chart: () => <canvas data-testid="mock-chart" />,
}));

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

const renderPanel = (opts: {
  view?: 'income' | 'expenses' | 'balances' | 'taxes';
  breakdowns?: AnnualCashFlowBreakdown[];
  showConversions?: boolean;
} = {}) => {
  const breakdowns = opts.breakdowns ?? [breakdown({ ssGross: 30000 })];
  return render(
    <SecondaryChartPanel
      view={opts.view ?? 'income'}
      onViewChange={() => {}}
      inputs={{
        breakdowns,
        inflation: breakdowns.map(() => 1),
        years: breakdowns.map((_, i) => 2026 + i),
        labels: breakdowns.map((_, i) => `${65 + i} (${2026 + i})`),
        displayCurrency: 'nominal',
      }}
      showConversions={opts.showConversions ?? false}
      onToggleConversions={() => {}}
      hoveredIndex={null}
      onHoverIndex={() => {}}
      onYearClick={() => {}}
    />,
  );
};

describe('SecondaryChartPanel', () => {
  it('renders the four view pills and legend chips for the active view', () => {
    renderPanel();
    for (const label of ['Income', 'Expenses', 'Balances', 'Taxes']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('Social Security')).toBeTruthy();
  });

  it('shows the conversions toggle only on the income view when conversions exist', () => {
    const conv = [breakdown({ ssGross: 30000, rothConversionGross: 20000, withdrawalFromTraditional: 20000 })];
    const { unmount } = renderPanel({ breakdowns: conv });
    expect(screen.getByRole('button', { name: /Show conversions/ })).toBeTruthy();
    unmount();

    // No conversions anywhere → no toggle.
    const { unmount: u2 } = renderPanel();
    expect(screen.queryByRole('button', { name: /conversions/ })).toBeNull();
    u2();

    // Conversions exist but a different view is active → no toggle.
    renderPanel({ breakdowns: conv, view: 'expenses' });
    expect(screen.queryByRole('button', { name: /conversions/ })).toBeNull();
  });

  it('renders the bracket strip block only for the taxes view', () => {
    const bd = [breakdown({ ordinaryTax: 5000, totalTax: 5000, audit: audit({ federalOrdinaryTax: 5000, federalMarginalRate: 0.22 }) })];
    const { unmount } = renderPanel({ breakdowns: bd, view: 'taxes' });
    expect(screen.getByText('Federal marginal bracket')).toBeTruthy();
    expect(screen.getAllByTestId('mock-chart')).toHaveLength(2);
    unmount();

    renderPanel({ breakdowns: bd, view: 'income' });
    expect(screen.queryByText('Federal marginal bracket')).toBeNull();
    expect(screen.getAllByTestId('mock-chart')).toHaveLength(1);
  });
});
