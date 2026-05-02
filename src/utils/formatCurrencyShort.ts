/**
 * Format a dollar amount in compact form: "$1.2M", "$850K", "$500".
 * Negatives wrap as "-$1.2M". Zero returns "$0".
 */
export const formatCurrencyShort = (amount: number): string => {
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '-' : '';
  const n = Math.abs(amount);
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${sign}$${v >= 10 ? Math.round(v) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${sign}$${v >= 10 ? Math.round(v) : v.toFixed(1)}K`;
  }
  return `${sign}$${Math.round(n)}`;
};
