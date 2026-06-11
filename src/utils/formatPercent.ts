// Percent formatters for compact UI display.
// fmtPct: 2 decimal places (e.g., "9.50%"). For marginal rates that need precision.
// fmtPct1: 1 decimal place (e.g., "9.5%"). For effective-rate callouts.
// fmtPctRound: nearest integer (e.g., "10%"). For bracket rates, allocation labels.
export const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
export const fmtPctRound = (v: number) => `${Math.round(v * 100)}%`;
