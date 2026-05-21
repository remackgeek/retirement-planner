// Percent formatters for compact UI display.
// fmtPct: 2 decimal places (e.g., "9.50%"). For marginal rates that need precision.
// fmtPctRound: nearest integer (e.g., "10%"). For bracket rates, allocation labels.
export const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const fmtPctRound = (v: number) => `${Math.round(v * 100)}%`;
