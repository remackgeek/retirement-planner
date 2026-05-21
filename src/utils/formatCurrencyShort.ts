/**
 * Format a dollar amount in compact form: "$1.2M", "$850K", "$500".
 *
 * Precision modes:
 *   'compact' (default) — used in sidebar, scenario rows, and the normal chart
 *      popup. Mild precision: millions get 2 decimals below 10M, 1 decimal below
 *      100M; K-values follow the same pattern below 10K.
 *   'precise' — used in the what-if / compare chart popup, where small
 *      differences between scenarios need to be visible. Adds one extra
 *      significant figure per band so e.g. $2.448M vs $2.402M render as
 *      "$2.448M" vs "$2.402M" instead of collapsing to "$2.4M".
 *
 * Negatives wrap as "-$1.2M". Non-finite returns "—".
 */
export const formatCurrencyShort = (
  amount: number,
  precision: 'compact' | 'precise' = 'compact'
): string => {
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '-' : '';
  const n = Math.abs(amount);

  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    let digits: number;
    if (precision === 'precise') {
      digits = v >= 100 ? 0 : v >= 10 ? 2 : 3;
    } else {
      digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    }
    return `${sign}$${v.toFixed(digits)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    let digits: number;
    if (precision === 'precise') {
      digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    } else {
      digits = v >= 100 ? 0 : v >= 10 ? 0 : 1;
    }
    return `${sign}$${v.toFixed(digits)}K`;
  }
  return `${sign}$${Math.round(n)}`;
};
