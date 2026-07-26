import { colors } from './theme';

/**
 * Shared categorical color map for the secondary charts (and their legend
 * chips). One place decides what hue a flow category wears so the Income bars,
 * Balances areas, and legends can never drift apart.
 *
 * Design rules (see the dataviz palette validation notes in theme.ts):
 * - Account types (traditional/brokerage/roth/cash) keep the same hue in every
 *   view — color follows the entity, not the chart.
 * - Stacking orders are fixed and were validated pairwise-adjacent for CVD
 *   safety. Builders must stack series in the orders documented on each view
 *   in secondaryChartData.ts; don't re-order without re-validating.
 * - Sub-3:1-contrast hues (teal/yellow/magenta/amber) are relieved by the
 *   legend chips, hover tooltips, and the yearly Data table — the required
 *   secondary channel. Stacked segments additionally get a 1px surface-white
 *   border gap.
 * - The Roth-conversion segment wears the Roth hue with a diagonal hatch
 *   (see canvasPattern.ts) because it is a transfer INTO Roth, not spendable
 *   income — the texture marks it as "not like the others".
 */
export type FlowCategoryKey =
  | 'socialSecurity'   // ssGross
  | 'otherIncome'      // non-SS income events, folded (tooltip itemizes)
  | 'rmd'              // forced Traditional distribution
  | 'traditionalExtra' // discretionary Traditional withdrawal above RMD
  | 'brokerage'
  | 'roth'
  | 'cash'
  | 'rothConversion'   // hatched — transfer, not spendable income
  | 'livingExpenses'
  | 'goalOther'        // audit-absent fallback aggregate ONLY (never a fold)
  | 'contributions'    // employee retirement contributions (Expenses view)
  | 'shortfall'        // hatched — unfunded spending in depleted years
  | 'taxesAggregate'   // single taxes segment in the Expenses view
  | 'taxFederal'
  | 'taxState'         // state ordinary + locality
  | 'taxCapGains'      // federal + state LTCG
  | 'taxNiit'
  | 'taxIrmaa';

export const categoryColors: Record<FlowCategoryKey, string> = {
  socialSecurity: colors.chartSocialSecurity,
  otherIncome: colors.chartOtherIncome,
  rmd: colors.chartRmd,
  traditionalExtra: colors.chartTraditional,
  brokerage: colors.chartBrokerage,
  roth: colors.chartRoth,
  cash: colors.chartCash,
  rothConversion: colors.chartRoth,
  livingExpenses: colors.chartLivingExpenses,
  goalOther: colors.chartMinorSeries,
  contributions: colors.chartMinorSeries,
  shortfall: colors.chartLivingExpenses,
  taxesAggregate: colors.chartTaxes,
  taxFederal: colors.taxFederalSeries,
  taxState: colors.taxStateSeries,
  taxCapGains: colors.taxCapGainsSeries,
  taxNiit: colors.taxNiitSeries,
  taxIrmaa: colors.taxIrmaaSeries,
};

/**
 * Fixed-order color cycle for per-goal series in the Expenses view. Assigned
 * by the goals' stable order in the scenario (never by size/rank, so a goal
 * keeps its color when amounts change). Every goal gets its own named series;
 * past the cycle length the colors wrap (rare — goals are user-created, and
 * the 1px surface gaps + legend chips + tooltip carry identity on a wrap).
 */
export const GOAL_SERIES_COLORS: readonly string[] = [
  colors.seriesCycle1,
  colors.seriesCycle2,
  colors.seriesCycle3,
  colors.seriesCycle4,
  colors.seriesCycle5,
];

/** Color for the k-th non-living goal (scenario order), wrapping past the cycle. */
export const goalSeriesColor = (k: number): string =>
  GOAL_SERIES_COLORS[k % GOAL_SERIES_COLORS.length];
