import type { CSSProperties } from 'react';

/**
 * Centralized design tokens for consistent, compact styling.
 * See CLAUDE.md "Styling Guidelines" for rationale.
 *
 * Two-tier color system:
 *   palette — private primitives (hex/rgba values, named by hue+shade)
 *   colors  — public semantic aliases (named by purpose, reference palette)
 *
 * When swapping the palette, only change `palette`. Semantic names stay stable.
 * Components always import from `colors`; never reference `palette` directly.
 */

// --- Primitive palette (private) ---
const palette = {
  // Neutral grays (light → dark)
  gray25:  '#f8f9fa',
  gray50:  '#f5f5f5',
  gray75:  '#f0f1f3',
  gray100: '#eee',
  gray150: '#e0e0e0',
  gray200: '#ddd',
  gray250: '#d0d0d0',
  gray300: '#ccc',
  gray400: '#9ca3af',
  gray500: '#999',
  gray550: '#6c757d',
  gray600: '#666',
  gray900: '#333',

  // Blues (chart only)
  blue600: '#2563eb',

  // Secondary-chart categorical series hues. These eight are a CVD-validated
  // categorical set (dataviz palette, light mode); the stacking orders used by
  // the secondary charts were validated pairwise-adjacent with the palette
  // validator. Don't substitute eyeballed values — re-validate any change.
  blue500:    '#2a78d6',
  orange500:  '#eb6834',
  teal500:    '#1baf7a',
  yellow500:  '#eda100',
  magenta400: '#e87ba4',
  green800:   '#008300',
  violet700:  '#4a3aa7',
  red500:     '#e34948',

  // Greens (primary action)
  green50:   '#d8e6dd',
  green500:  '#3d7a5f',
  green700:  '#2f6049',
  greenDark: '#2a4f3d',

  // Siennas (danger action)
  sienna500: '#b06b4f',
  sienna600: '#965a42',

  // Reds (chart only)
  red700:  '#dc2626',

  // Black swan shading (semi-transparent red band on chart)
  red500Alpha08: 'rgba(220, 38, 38, 0.08)',

  // Percentile band shading (semi-transparent neutral on chart)
  gray400Alpha12: 'rgba(156, 163, 175, 0.18)',

  // Greens
  green600: '#008000',
  green100: '#dcfce7',

  // Limes (status: good)
  lime600: '#65a30d',
  lime100: '#ecfccb',

  // Ambers (status: fair)
  amber700: '#b45309',
  amber500: '#f59e0b',
  amber100: '#fef3c7',

  // Reds (status: at risk)
  red100: '#fee2e2',

  // Oranges
  orange600: '#d2691e',

  // Semi-transparent
  green25:  'rgba(61, 122, 95, 0.08)',
  green10:  'rgba(0, 128, 0, 0.1)',
  orange10: 'rgba(210, 105, 30, 0.1)',
  black06:  'rgba(0, 0, 0, 0.06)',
  black10:  'rgba(0, 0, 0, 0.1)',
  black20:  'rgba(0, 0, 0, 0.2)',
  white20:  'rgba(255, 255, 255, 0.2)',
  white70:  'rgba(255, 255, 255, 0.7)',
  white95:  'rgba(255, 255, 255, 0.95)',
  white97:  'rgba(255, 255, 255, 0.97)',

  // Pure white (text/icons on solid primary fills)
  white: '#fff',
} as const;

// --- Spacing ---
export const spacing = {
  /** 0.25rem — tight inner padding (chips, tiny elements) */
  xs: '0.25rem',
  /** 0.5rem — standard element padding, form field gaps */
  sm: '0.5rem',
  /** 0.75rem — form/card containers, dialog form gaps */
  md: '0.75rem',
  /** 1rem — container padding, section gaps */
  lg: '1rem',
  /** 1.25rem — outer container padding (content body) */
  xl: '1.25rem',
} as const;

// --- Colors (semantic aliases) ---
export const colors = {
  // Surfaces
  bgLight:  palette.gray25,
  bgMedium: palette.gray50,
  bgHover:  palette.gray75,

  // Borders
  border:       palette.gray200,
  borderLight:  palette.gray100,
  borderMedium: palette.gray150,

  // Text
  textPrimary:   palette.gray900,
  textSecondary: palette.gray600,
  textMuted:     palette.gray500,
  textFooter:    palette.gray550,
  textSeparator: palette.gray300,

  // Actions
  primary:      palette.green500,
  primaryHover: palette.green700,
  danger:       palette.sienna500,
  dangerHover:  palette.sienna600,

  // Domain accents — income / spending
  income:     palette.green600,
  incomeBg:   palette.green10,
  spending:   palette.orange600,
  spendingBg: palette.orange10,

  // Sankey tax-treatment buckets (per-year Cash Flow tab)
  bucketOrdinary: palette.amber500,
  bucketCapGains: palette.orange600,
  bucketExempt:   palette.lime600,
  // Sankey column-0 detail nodes (per-event / per-account upstream of aggregators).
  // MUST be a solid color (no alpha) — the SVG link stroke multiplies the stroke
  // color's alpha with `strokeOpacity={0.32}`, so an already-translucent base
  // becomes invisible. green500 is solid forest green; reads as a darker
  // "tributary" feeding the brighter green600 income aggregator. We escalated
  // here from green50 because that mint was still too faint in practice.
  bucketDetail:   palette.green500,

  // Chart view lines
  chartMedian:   palette.green500,
  chartNominal:  palette.gray400,

  // Secondary-chart categorical series (see src/styles/chartCategoryColors.ts
  // for the per-view stacking orders — all validated pairwise-adjacent for
  // CVD safety; re-validate if any hue changes).
  // Account-type colors are shared across the Income and Balances views so a
  // type keeps its identity everywhere.
  chartSocialSecurity: palette.green800,
  chartOtherIncome:    palette.magenta400,
  chartRmd:            palette.violet700,
  chartTraditional:    palette.orange500,
  chartBrokerage:      palette.blue500,
  chartRoth:           palette.teal500,
  chartCash:           palette.yellow500,
  /** Neutral gray for minor/neutral series (retirement contributions, the
   *  audit-absent "Goals" fallback). Exempt from the hue adjacency chain. */
  chartMinorSeries:    palette.gray400,
  chartLivingExpenses: palette.red500,
  /** Aggregate taxes segment in the Expenses view — same hue family as the
   *  Sankey's ordinary-tax bucket so "taxes" reads consistently. */
  chartTaxes:          palette.amber500,
  /** Marginal-bracket step strip under the Taxes view. */
  chartBracketLine:    palette.gray900,
  // Taxes-view component segments (stack order blue→orange→teal→yellow→magenta,
  // the validated canonical adjacency order).
  taxFederalSeries:  palette.blue500,
  taxStateSeries:    palette.orange500,
  taxCapGainsSeries: palette.teal500,
  taxNiitSeries:     palette.yellow500,
  taxIrmaaSeries:    palette.magenta400,
  // Generic categorical cycle for unbounded per-item series (spending goals).
  // Fixed assignment order (never re-ranked); every item gets its own series —
  // past the 5th the cycle wraps (legend chips + 1px surface gaps + tooltip
  // carry identity for any wrap collision). Order chosen so the full Expenses
  // stack chain (livingExpenses red → violet → teal → blue → magenta → green →
  // taxes amber) validates pairwise-adjacent for CVD + normal vision.
  seriesCycle1: palette.violet700,
  seriesCycle2: palette.teal500,
  seriesCycle3: palette.blue500,
  seriesCycle4: palette.magenta400,
  seriesCycle5: palette.green800,

  // Black swan event shading (semi-transparent vertical band) + the stock-%
  // multiplier label drawn above each band.
  blackSwanShade: palette.red500Alpha08,
  blackSwanStockLabel: palette.sienna500,

  // Monte Carlo 10th–90th percentile band (filled region under projected line)
  chartBand: palette.gray400Alpha12,

  // What If draft overlay (dashed line for the experimental scenario)
  draftOverlay: palette.amber500,

  // Shadows & overlays (used in annotations and dialog hover states)
  shadowLight:  palette.black10,
  shadowMedium: palette.black20,
  overlayLight: palette.white20,

  // Text/icons rendered on top of a solid primary/danger fill
  onPrimary: palette.white,
  // Neutral (non-primary) button hover tint
  hoverNeutral: palette.black06,
  // Near-opaque background for the chart hover popup
  popupBg: palette.white97,
  // Chart.js dark-tooltip text tiers (label = dimmer, value = brighter;
  // the separator uses overlayLight)
  chartTooltipLabel: palette.white70,
  chartTooltipValue: palette.white95,

  // Sidebar
  activeRow: palette.green50,
  hoverRow:  palette.green25,
  chipBg:    palette.green50,
  chipText:  palette.greenDark,

  // Status (success-tier scale for chance-of-success badges, etc.)
  success:         palette.green600,
  successBg:       palette.green100,
  successMuted:    palette.lime600,
  successMutedBg:  palette.lime100,
  warning:         palette.amber700,
  warningBg:       palette.amber100,
  dangerBg:        palette.red100,
  dangerStrong:    palette.red700,
  dangerStrongBg:  palette.red100,
} as const;

// --- Typography ---
export const fontSize = {
  /** 0.65rem — chips, badges */
  xs: '0.65rem',
  /** 0.75rem — hints, small labels */
  sm: '0.75rem',
  /** 0.85rem — default body text */
  base: '0.85rem',
  /** 0.9rem — icon labels, secondary headings */
  md: '0.9rem',
  /** 1rem — dialog buttons, standard UI */
  lg: '1rem',
  /** 1.1rem — section headings, large buttons */
  xl: '1.1rem',
} as const;

// --- Borders ---
export const border = {
  standard: `1px solid ${colors.border}`,
  light: `1px solid ${colors.borderLight}`,
  medium: `1px solid ${colors.borderMedium}`,
  radius: '4px',
  radiusRound: '8px',
  radiusCircle: '50%',
} as const;

// --- Breakpoints ---
export const breakpoints = {
  /** 768px — phones below, tablet/desktop above */
  mobile: 768,
} as const;

/** Pre-built media query strings for use inside styled-components template literals.
 *  Always use these — never write raw @media strings in components.
 *  Derived from `breakpoints.mobile` so the value can't drift from the token. */
export const mediaQuery = {
  /** Targets screens 767px wide and below (phones) */
  mobile: `@media (max-width: ${breakpoints.mobile - 1}px)`,
  /** Targets screens 768px wide and above (tablet / desktop) */
  desktop: `@media (min-width: ${breakpoints.mobile}px)`,
} as const;

/** The same mobile breakpoint as a bare `matchMedia` condition (no `@media`
 *  prefix) for JS-side viewport checks: `window.matchMedia(mobileMatchMedia)`.
 *  Use this instead of hand-building the string in a component — that's how the
 *  Chart and AppContent copies drifted apart. */
export const mobileMatchMedia = `(max-width: ${breakpoints.mobile - 1}px)`;

/**
 * Mobile-safe Dialog width style. PrimeReact's `<Dialog>` honors a fixed
 * `width` (in rems) but doesn't shrink for narrow viewports — at 360 px,
 * a 34rem (~544 px) dialog overflows by 50%. This helper returns the
 * desktop width capped at 95vw on phones, plus a hard `maxWidth` so the
 * dialog never breaks out of the viewport.
 *
 * Usage:
 *   <Dialog style={dialogWidth('34rem')}>
 *
 * Prefer this over hand-writing `{ width: '34rem' }` style props.
 */
export const dialogWidth = (rem: string): CSSProperties => ({
  width: `min(${rem}, 95vw)`,
  maxWidth: '95vw',
});

// --- Layout constants ---
export const layout = {
  /** Minimum width for manager panels before wrapping to next row.
   *  With flex-wrap, adding a third panel just works — no media query update needed. */
  managerMinWidth: '280px',
  /** Fixed height for manager panel headers — keeps Accounts/Income/Spending headers aligned. */
  managerHeaderHeight: '2.5rem',
  /** Expanded sidebar width on desktop */
  sidebarExpanded: '300px',
  /** Collapsed sidebar width on desktop (icon-only strip) */
  sidebarCollapsed: '50px',
} as const;
