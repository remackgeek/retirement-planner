/**
 * Centralized design tokens for consistent, compact styling.
 * See CLAUDE.md "Styling Guidelines" for rationale.
 */

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

// --- Colors ---
export const colors = {
  // Surfaces
  bgLight: '#f8f9fa',
  bgMedium: '#f5f5f5',
  bgHover: '#f0f1f3',

  // Borders
  border: '#ddd',
  borderLight: '#eee',
  borderMedium: '#e0e0e0',

  // Text
  textPrimary: '#333',
  textSecondary: '#666',
  textMuted: '#999',
  textFooter: '#6c757d',
  textSeparator: '#ccc',

  // Actions
  primary: '#007bff',
  primaryHover: '#0056b3',
  danger: '#dc3545',
  dangerHover: '#c82333',

  // Accent — semantic colors for domain concepts
  income: 'green',
  incomeBg: 'rgba(0, 128, 0, 0.1)',
  spending: '#d2691e',
  spendingBg: 'rgba(210, 105, 30, 0.1)',

  // Sidebar
  activeRow: '#e0e0e0',
  hoverRow: '#d0d0d0',
  chipBg: '#d8e8f8',
  chipText: '#335',
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
