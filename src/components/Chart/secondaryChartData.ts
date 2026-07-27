import type { ChartData, ChartDataset, ChartOptions, TooltipItem } from 'chart.js';
import {
  type AnnualCashFlowBreakdown,
  SYNTHETIC_TRAD_WITHDRAWAL_ID,
  SYNTHETIC_SS_AGGREGATE_ID,
} from '../../services/SimulationService';
import { toDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { formatCurrencyShort } from '../../utils/formatCurrencyShort';
import { colors } from '../../styles/theme';
import { categoryColors, goalSeriesColor } from '../../styles/chartCategoryColors';
import { getHatchPattern } from './canvasPattern';

/**
 * Pure dataset builders for the secondary chart panel. No DOM access apart
 * from the cached canvas hatch pattern; unit-testable via the returned
 * dataset arrays.
 *
 * Stacking orders are FIXED — they were validated pairwise-adjacent for CVD
 * safety (see chartCategoryColors.ts). Don't re-order datasets without
 * re-validating the adjacency chain.
 *
 * All monetary values pass through `toDisplay(v, inflation[i], mode)` so the
 * charts follow the Today's-$/Future-$ toggle exactly like the data table.
 */

export type SecondaryView = 'income' | 'expenses' | 'balances' | 'taxes';

export const SECONDARY_VIEW_LABELS: Record<SecondaryView, string> = {
  income: 'Income',
  expenses: 'Expenses',
  balances: 'Balances',
  taxes: 'Taxes',
};

/**
 * Minimum y-axis width shared by the main chart, the panel chart, and the
 * bracket strip, enforced via each y-scale's `afterFit`. Without it the three
 * canvases fit different tick widths and the same year lands at a different
 * pixel x per canvas — bars stop sitting under the main chart's same-year
 * point. Sized to the main chart's widest tick ("1,400,000" at font 11).
 */
export const Y_AXIS_ALIGN_WIDTH = 80;

export interface SecondaryChartInputs {
  /** Breakdowns of the chart's primary path (Projected, or Median in
   *  historical rolling/bootstrap modes) — same source as the data table. */
  breakdowns: AnnualCashFlowBreakdown[];
  /** Cumulative inflation factors of the same path. */
  inflation: number[];
  years: number[];
  /** Shared x-axis labels from the main chart (age frame + year). */
  labels: string[];
  displayCurrency: DisplayCurrency;
  /** Income view only: include the hatched Roth-conversion segment. */
  showConversions: boolean;
  /**
   * Scenario spending-goal id order (userData.spendingGoals). Per-goal series
   * colors assign by position in THIS list so a goal keeps its color when its
   * start age changes or the horizon shifts; ids not listed (defensive) append
   * in first-appearance order.
   */
  goalIdOrder?: string[];
  /** Mobile: smaller tick font + capped x-label count, matching the main chart. */
  compact?: boolean;
}

export interface SecondaryLegendEntry {
  key: string;
  label: string;
  color: string;
  hatched?: boolean;
}

type MixedData = ChartData<'bar' | 'line', (number | null)[], string>;
type MixedDataset = ChartDataset<'bar' | 'line', (number | null)[]>;

export interface BuiltSecondaryChart {
  data: MixedData;
  options: ChartOptions<'bar'>;
  legend: SecondaryLegendEntry[];
  /** Slim aligned strip below the main canvas (Taxes view: the federal
   *  marginal-bracket step line). Separate canvas — never a second y-axis on
   *  the main chart (dual axes are a hard no). Omitted when no year has audit
   *  data (an all-null line would render an empty strip). */
  strip?: {
    data: MixedData;
    options: ChartOptions<'bar'>;
    /** Strip heading rendered above the strip canvas. */
    label: string;
  } | null;
  /** Muted footnote under the chart (e.g. conversion-segment explainer). */
  note?: string | null;
}

/** True when any projection year converts — drives the panel's toggle visibility. */
export const hasConversions = (breakdowns: AnnualCashFlowBreakdown[]): boolean =>
  breakdowns.some((b) => b.rothConversionGross > 0.005);

const NONZERO = (values: (number | null)[]): boolean =>
  values.some((v) => v != null && Math.abs(v) > 0.005);

const fmtShort = (v: number) => formatCurrencyShort(v);

// Hide tooltip rows that are $0 at the hovered year (an ended goal, a pre-RMD
// year, a drained account type). Applied to every view EXCEPT the bracket
// strip — a 0% marginal bracket is real information, not noise.
const ZERO_ROW_FILTER = (item: TooltipItem<'bar' | 'line'>) => Math.abs(item.parsed.y ?? 0) > 0.005;

// Bold total line at the bottom of the hover (Chart.js renders `footer` below
// body and afterBody). Sums the items the tooltip actually lists (post
// zero-filter), minus any excluded dataset labels — the Income view excludes
// the hatched Roth-conversion segment because a conversion isn't spendable
// income (a parenthetical explains the mismatch when it's visible).
function totalFooter(label: string, excludeLabels: string[] = []) {
  return (items: TooltipItem<'bar' | 'line'>[]): string[] => {
    const included = items.filter((it) => !excludeLabels.includes(it.dataset.label ?? ''));
    const total = included.reduce((s, it) => s + (it.parsed.y ?? 0), 0);
    const lines = [`${label}: ${fmtShort(total)}`];
    if (included.length !== items.length) lines.push('(excludes Roth conversion)');
    return lines;
  };
}

// Shared scaffolding: stacked category x, currency y, index-mode tooltip,
// legend disabled (the panel renders its own chips), no animation. The y-scale
// afterFit pins a shared minimum axis width so all canvases column-align.
function baseOptions(labels: string[], compact?: boolean): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<'bar' | 'line'>[]) =>
            items.length > 0 ? labels[items[0].dataIndex] : '',
          label: (ctx: TooltipItem<'bar' | 'line'>) =>
            ` ${ctx.dataset.label}: ${fmtShort(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          font: { size: compact ? 9 : 10 },
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 8,
          ...(compact ? { maxTicksLimit: 6 } : {}),
        },
      },
      y: {
        stacked: true,
        afterFit: (axis) => { axis.width = Math.max(axis.width, Y_AXIS_ALIGN_WIDTH); },
        ticks: { font: { size: compact ? 9 : 10 }, callback: (v) => fmtShort(Number(v)) },
        grid: { color: colors.borderLight },
      },
    },
  };
}

interface BarSeriesSpec {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  hatched?: boolean;
}

// Stacked-bar dataset with a 1px surface gap between segments (the mark-spec
// spacer that keeps sub-3:1 hues readable next to each other).
function barDataset(spec: BarSeriesSpec): MixedDataset {
  return {
    type: 'bar' as const,
    label: spec.label,
    data: spec.values,
    backgroundColor: spec.hatched ? getHatchPattern(spec.color) : spec.color,
    borderColor: colors.onPrimary,
    borderWidth: 1,
    borderSkipped: false,
  };
}

function buildBarChart(
  specs: BarSeriesSpec[],
  labels: string[],
  compact?: boolean,
  extraOptions?: (o: ChartOptions<'bar'>) => void,
): BuiltSecondaryChart {
  const active = specs.filter((s) => NONZERO(s.values));
  const options = baseOptions(labels, compact);
  options.plugins!.tooltip!.filter = ZERO_ROW_FILTER;
  extraOptions?.(options);
  return {
    data: { labels, datasets: active.map(barDataset) },
    options,
    legend: active.map((s) => ({ key: s.key, label: s.label, color: s.color, hatched: s.hatched })),
  };
}

// ---------------- Income by source ----------------
// Stack order (bottom→top): SS → Other income → RMD → Additional Traditional →
// Brokerage → Roth → Cash → [hatched conversion].
// Validated adjacency chain: green→magenta→violet→orange→blue→teal→yellow.
//
// Cash interest is deliberately NOT a series: the engine credits it into the
// cash balance (it's inside withdrawalFromCash when withdrawn) — rendering it
// as income would double-count spendable dollars. Its only standalone effect
// is tax, which the Taxes view shows.
function buildIncomeChart(inp: SecondaryChartInputs): BuiltSecondaryChart {
  const { breakdowns, inflation, displayCurrency: mode, labels } = inp;
  const disp = (f: (b: AnnualCashFlowBreakdown) => number) =>
    breakdowns.map((b, i) => toDisplay(f(b), inflation[i] ?? 1, mode));

  const specs: BarSeriesSpec[] = [
    { key: 'ss', label: 'Social Security', color: categoryColors.socialSecurity, values: disp((b) => b.ssGross) },
    {
      key: 'otherIncome', label: 'Other income', color: categoryColors.otherIncome,
      // Full paycheck framing: otherTaxableGross is net of pre-tax deferrals,
      // so add preTaxContributions back to show the wage the user actually
      // earned (the deferral shows as a Retirement-contributions expense).
      // Cash interest excluded (see the function comment). After-tax income
      // included. The tooltip itemizes the individual events.
      values: disp((b) => Math.max(0, b.otherTaxableGross + b.preTaxContributions - b.cashInterest) + b.afterTaxIncome),
    },
    { key: 'rmd', label: 'RMD (required)', color: categoryColors.rmd, values: disp((b) => b.rmdRequired) },
    {
      key: 'tradExtra', label: 'Additional 401(k)/IRA', color: categoryColors.traditionalExtra,
      values: disp((b) => Math.max(0, b.withdrawalFromTraditional - b.rmdRequired - b.rothConversionGross)),
    },
    { key: 'brokerage', label: 'Brokerage', color: categoryColors.brokerage, values: disp((b) => b.withdrawalFromBrokerage) },
    { key: 'roth', label: 'Roth', color: categoryColors.roth, values: disp((b) => b.withdrawalFromRoth) },
    { key: 'cash', label: 'Cash', color: categoryColors.cash, values: disp((b) => b.withdrawalFromCash) },
  ];
  if (inp.showConversions) {
    specs.push({
      key: 'conversion', label: 'Roth conversion', color: categoryColors.rothConversion, hatched: true,
      values: disp((b) => b.rothConversionGross),
    });
  }

  const built = buildBarChart(specs, labels, inp.compact, (o) => {
    const callbacks = o.plugins!.tooltip!.callbacks!;
    callbacks.footer = totalFooter('Total income', ['Roth conversion']);
    // Itemize the folded "Other income" segment per event when hovering a year.
    callbacks.afterBody = (items: TooltipItem<'bar' | 'line'>[]) => {
      const idx = items[0]?.dataIndex;
      if (idx == null) return [];
      const events = (breakdowns[idx]?.audit?.incomeEventTaxBreakdown ?? []).filter(
        (e) =>
          e.gross > 0.005 &&
          e.eventId !== SYNTHETIC_TRAD_WITHDRAWAL_ID &&
          e.eventId !== SYNTHETIC_SS_AGGREGATE_ID &&
          e.eventType !== 'roth_conversion' &&
          e.eventType !== 'social_security' &&
          e.eventType !== 'retirement_contribution',
      );
      if (events.length === 0) return [];
      const f = inflation[idx] ?? 1;
      return [
        'Other income detail:',
        ...events.map((e) => `  ${e.eventName}: ${fmtShort(toDisplay(e.gross, f, mode))}`),
      ];
    };
  });
  if (inp.showConversions && built.legend.some((l) => l.key === 'conversion')) {
    built.note = 'Roth conversions are shown hatched: converted dollars move into Roth and are not spendable income.';
  }
  return built;
}

// ---------------- Expenses by category ----------------
// Stack order (bottom→top): Living expenses → one series PER non-living goal
// (fixed cycle, wrapping past its length — never folded) → Retirement
// contributions (neutral gray, exempt from the hue chain) → Taxes → Unfunded
// shortfall (hatched — texture marks "not like the others", same channel as
// the Income view's conversion segment). Validated hue chain:
// red→violet→teal→blue→magenta→green→amber.
//
// Depleted-year honesty: living + per-goal segments scale by the same
// funded-fraction the Sankey uses, and the unmet remainder renders as its own
// "Unfunded shortfall" segment — so the stack still totals requested
// spending + taxes while agreeing with the Income view's actual withdrawals.
function buildExpensesChart(inp: SecondaryChartInputs): BuiltSecondaryChart {
  const { breakdowns, inflation, displayCurrency: mode, labels } = inp;
  const disp = (f: (b: AnnualCashFlowBreakdown) => number) =>
    breakdowns.map((b, i) => toDisplay(f(b), inflation[i] ?? 1, mode));

  // Funded fraction of the year's spending (1 when no shortfall or no
  // spending at all — a zero-spending year has nothing to scale).
  const spendScale = (b: AnnualCashFlowBreakdown) =>
    b.totalSpendingNet > 0
      ? Math.max(0, b.totalSpendingNet - b.spendingShortfall) / b.totalSpendingNet
      : 1;

  // Collect non-living goal identities, then order by the scenario's goal list
  // (goalIdOrder) so colors are stable under startAge/horizon edits; ids not
  // in the list (defensive) keep first-appearance order at the end.
  const found = new Map<string, string>(); // goalId -> goalName
  for (const b of breakdowns) {
    for (const g of b.audit?.spendingGoalBreakdown ?? []) {
      if (g.goalType === 'living_expenses' || found.has(g.goalId)) continue;
      found.set(g.goalId, g.goalName);
    }
  }
  const scenarioOrdered = (inp.goalIdOrder ?? []).filter((id) => found.has(id));
  const remaining = [...found.keys()].filter((id) => !scenarioOrdered.includes(id));
  const goalOrder = [...scenarioOrdered, ...remaining].map((goalId) => ({
    goalId,
    goalName: found.get(goalId)!,
  }));

  const goalAmount = (b: AnnualCashFlowBreakdown, goalId: string) =>
    (b.audit?.spendingGoalBreakdown ?? [])
      .filter((g) => g.goalId === goalId)
      .reduce((s, g) => s + g.amountNet, 0) * spendScale(b);
  // Defensive fallback only: a breakdown without audit can't be itemized, so
  // its whole non-living aggregate renders as one "Goals" series. Zero on
  // every audited breakdown (the itemized series carry the dollars there).
  const unitemizedGoals = (b: AnnualCashFlowBreakdown) =>
    b.audit ? 0 : b.otherSpendingGoalsNet * spendScale(b);

  const specs: BarSeriesSpec[] = [
    { key: 'living', label: 'Living expenses', color: categoryColors.livingExpenses, values: disp((b) => b.baseSpendingNet * spendScale(b)) },
    ...goalOrder.map((g, k) => ({
      key: `goal_${g.goalId}`,
      label: g.goalName,
      color: goalSeriesColor(k),
      values: disp((b) => goalAmount(b, g.goalId)),
    })),
    { key: 'goalOther', label: 'Goals', color: categoryColors.goalOther, values: disp(unitemizedGoals) },
    {
      key: 'contributions', label: 'Retirement contributions', color: categoryColors.contributions,
      // Employee dollars only. Employer match is deliberately in NEITHER view:
      // it moves account-to-account without ever touching spendable cash.
      values: disp((b) => b.preTaxContributions + b.rothContributions + b.afterTaxContributions),
    },
    { key: 'taxes', label: 'Taxes', color: categoryColors.taxesAggregate, values: disp((b) => b.totalTax) },
    {
      key: 'shortfall', label: 'Unfunded shortfall', color: categoryColors.shortfall, hatched: true,
      values: disp((b) => b.spendingShortfall),
    },
  ];
  return buildBarChart(specs, labels, inp.compact, (o) => {
    o.plugins!.tooltip!.callbacks!.footer = totalFooter('Total');
  });
}

// ---------------- Balances by account type ----------------
// Stacked area of beginning-of-year balances. Stack order (bottom→top):
// Traditional → Roth → Brokerage → Cash (validated orange→teal→blue→yellow).
// The stacked total equals the main chart's primary line at every year.
function buildBalancesChart(inp: SecondaryChartInputs): BuiltSecondaryChart {
  const { breakdowns, inflation, displayCurrency: mode, labels } = inp;
  const disp = (f: (b: AnnualCashFlowBreakdown) => number) =>
    breakdowns.map((b, i) => toDisplay(f(b), inflation[i] ?? 1, mode));

  const specs = [
    { key: 'traditional', label: 'Traditional', color: categoryColors.traditionalExtra, values: disp((b) => b.boyBalanceTraditional) },
    { key: 'roth', label: 'Roth', color: categoryColors.roth, values: disp((b) => b.boyBalanceRoth) },
    { key: 'brokerage', label: 'Brokerage', color: categoryColors.brokerage, values: disp((b) => b.boyBalanceBrokerage) },
    { key: 'cash', label: 'Cash', color: categoryColors.cash, values: disp((b) => b.boyBalanceCash) },
  ].filter((s) => NONZERO(s.values));

  const options = baseOptions(labels, inp.compact);
  // Same zero-row hygiene as the bar views: a drained account type shouldn't
  // show "$0" rows for the rest of the horizon.
  options.plugins!.tooltip!.filter = ZERO_ROW_FILTER;
  options.plugins!.tooltip!.callbacks!.footer = totalFooter('Total balance');
  return {
    data: {
      labels,
      datasets: specs.map((s): MixedDataset => ({
        type: 'line' as const,
        label: s.label,
        data: s.values,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 1,
        pointRadius: 0,
        fill: true,
      })),
    },
    options,
    legend: specs.map((s) => ({ key: s.key, label: s.label, color: s.color })),
    note: 'Balances at the start of each year, before growth — the stacked total matches the main chart line.',
  };
}

// ---------------- Taxes by component (+ bracket strip) ----------------
// Stack order (bottom→top): Federal income → State & local → Capital gains →
// NIIT → IRMAA (validated blue→orange→teal→yellow→magenta). The federal
// marginal bracket renders as a separate slim step strip sharing the x-axis —
// dollars and percent never share a canvas.
function buildTaxesChart(inp: SecondaryChartInputs): BuiltSecondaryChart {
  const { breakdowns, inflation, displayCurrency: mode, labels } = inp;
  const disp = (f: (b: AnnualCashFlowBreakdown) => number) =>
    breakdowns.map((b, i) => toDisplay(f(b), inflation[i] ?? 1, mode));

  // stateOrdinaryTax excludes the locality surcharge; ordinaryTax includes
  // both. Without audit (shouldn't happen on representative paths) fold
  // everything unsplittable into the federal segment so the stack still sums
  // to totalTax.
  const fed = (b: AnnualCashFlowBreakdown) =>
    b.audit ? b.audit.federalOrdinaryTax : b.ordinaryTax - b.stateLocalitySurcharge;
  const state = (b: AnnualCashFlowBreakdown) =>
    (b.audit?.stateOrdinaryTax ?? 0) + b.stateLocalitySurcharge;

  const built = buildBarChart(
    [
      { key: 'taxFederal', label: 'Federal income tax', color: categoryColors.taxFederal, values: disp(fed) },
      { key: 'taxState', label: 'State & local tax', color: categoryColors.taxState, values: disp(state) },
      { key: 'taxCapGains', label: 'Capital gains tax', color: categoryColors.taxCapGains, values: disp((b) => b.federalCapGainsTax + b.stateCapGainsTax) },
      { key: 'taxNiit', label: 'NIIT', color: categoryColors.taxNiit, values: disp((b) => b.niitTax) },
      { key: 'taxIrmaa', label: 'IRMAA', color: categoryColors.taxIrmaa, values: disp((b) => b.irmaaSurcharge) },
    ],
    labels,
    inp.compact,
    (o) => {
      o.plugins!.tooltip!.callbacks!.footer = totalFooter('Total tax');
    },
  );

  const bracketPct = breakdowns.map((b) =>
    b.audit ? Math.round(b.audit.federalMarginalRate * 1000) / 10 : null,
  );
  // No audit anywhere (defensive path) → no strip: an all-null line would
  // render an empty box plus a phantom legend chip.
  if (!bracketPct.some((v) => v != null)) return built;

  const stripOptions = baseOptions(labels, inp.compact);
  stripOptions.scales = {
    x: {
      stacked: false,
      grid: { display: false },
      // The main canvas above carries the x labels; the strip stays compact.
      ticks: { display: false },
    },
    y: {
      stacked: false,
      min: 0,
      afterFit: (axis) => { axis.width = Math.max(axis.width, Y_AXIS_ALIGN_WIDTH); },
      ticks: { font: { size: 9 }, callback: (v) => `${v}%`, maxTicksLimit: 4 },
      grid: { color: colors.borderLight },
    },
  };
  stripOptions.plugins!.tooltip!.callbacks!.label = (ctx: TooltipItem<'bar' | 'line'>) =>
    ` Marginal federal bracket: ${ctx.parsed.y}%`;

  built.strip = {
    label: 'Federal marginal bracket',
    data: {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'Federal marginal bracket',
          data: bracketPct,
          borderColor: colors.chartBracketLine,
          backgroundColor: colors.chartBracketLine,
          borderWidth: 2,
          pointRadius: 0,
          stepped: true,
        },
      ],
    },
    options: stripOptions,
  };
  built.legend.push({ key: 'bracket', label: 'Marginal bracket (strip below)', color: colors.chartBracketLine });
  return built;
}

export function buildSecondaryChart(view: SecondaryView, inp: SecondaryChartInputs): BuiltSecondaryChart {
  switch (view) {
    case 'income': return buildIncomeChart(inp);
    case 'expenses': return buildExpensesChart(inp);
    case 'balances': return buildBalancesChart(inp);
    case 'taxes': return buildTaxesChart(inp);
  }
}
