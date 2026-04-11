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

  // Blues
  blue50:  '#d8e8f8',
  blue500: '#007bff',
  blue600: '#2563eb',
  blue700: '#0056b3',
  navy:    '#333355',

  // Reds
  red500:  '#dc3545',
  red600:  '#c82333',
  red700:  '#dc2626',

  // Greens
  green600: '#008000',

  // Oranges
  orange600: '#d2691e',

  // Semi-transparent
  green10:  'rgba(0, 128, 0, 0.1)',
  orange10: 'rgba(210, 105, 30, 0.1)',
  black10:  'rgba(0, 0, 0, 0.1)',
  black20:  'rgba(0, 0, 0, 0.2)',
  white20:  'rgba(255, 255, 255, 0.2)',
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
  primary:      palette.blue500,
  primaryHover: palette.blue700,
  danger:       palette.red500,
  dangerHover:  palette.red600,

  // Domain accents — income / spending
  income:     palette.green600,
  incomeBg:   palette.green10,
  spending:   palette.orange600,
  spendingBg: palette.orange10,

  // Chart view lines
  chartMedian:   palette.blue600,
  chartNominal:  palette.gray400,
  chartDownside: palette.red700,

  // Shadows & overlays (used in annotations and dialog hover states)
  shadowLight:  palette.black10,
  shadowMedium: palette.black20,
  overlayLight: palette.white20,

  // Sidebar
  activeRow: palette.gray150,
  hoverRow:  palette.gray250,
  chipBg:    palette.blue50,
  chipText:  palette.navy,
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
