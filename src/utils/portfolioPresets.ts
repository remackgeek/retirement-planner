import type { PortfolioType } from '../types/IncomeEvent';

export const PORTFOLIO_PRESETS: Record<PortfolioType, { stockAllocation: number; label: string }> = {
  '80_20': { stockAllocation: 0.80, label: '80/20 (Stocks/Bonds)' },
  '60_40': { stockAllocation: 0.60, label: '60/40 (Stocks/Bonds)' },
  '50_50': { stockAllocation: 0.50, label: '50/50 (Stocks/Bonds)' },
};
