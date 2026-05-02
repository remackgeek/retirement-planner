export type DisplayCurrency = 'real' | 'nominal';

// Convert a nominal (simulation-internal) value to display value.
// Used for cash flow breakdown fields (income, spending, tax, withdrawals).
export const toDisplay = (
  nominalValue: number,
  inflationFactor: number,
  mode: DisplayCurrency,
): number => (mode === 'nominal' ? nominalValue : nominalValue / inflationFactor);

// Convert a real portfolio-path value to display value.
// Used for portfolio balances (runSimulation returns paths pre-deflated to real).
export const pathToDisplay = (
  realValue: number,
  inflationFactor: number,
  mode: DisplayCurrency,
): number => (mode === 'nominal' ? realValue * inflationFactor : realValue);
