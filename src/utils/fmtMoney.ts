// Whole-dollar number formatter for tax-audit / income-detail tables
// (e.g. 28584 → "28,584"). Callers prepend the "$" so negatives can render
// as "-$1,200". For the compact at-a-glance style ($1.2M) use
// formatCurrencyShort; for full currency strings use toLocaleString with
// style: 'currency'.
export const fmtMoney = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
