import type { PortfolioType } from '../types/IncomeEvent';

export const PORTFOLIO_PRESETS: Record<
  PortfolioType,
  { expectedReturn: number; standardDeviation: number }
> = {
  conservative: { expectedReturn: 0.048, standardDeviation: 0.065 },
  balanced: { expectedReturn: 0.065, standardDeviation: 0.105 },
  aggressive: { expectedReturn: 0.080, standardDeviation: 0.165 },
};
