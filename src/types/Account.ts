import type { PortfolioType } from './IncomeEvent';

export type AccountType = 'traditional' | 'roth' | 'brokerage' | 'cash';

export type AccountKind = '401k' | 'ira' | 'brokerage';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  owner?: 'self' | 'spouse';
  stockAllocation: number;         // 0.0–1.0; drives simulation growth per-account
  portfolioBalance: PortfolioType; // UI preset tracker — always one of the three fixed presets
  // Contribution-cap classification. When absent: 'traditional' / 'roth' default to
  // IRA-kind, 'brokerage' defaults to brokerage. 401(k)/403(b)/TSP must be explicitly set.
  accountKind?: AccountKind;
}
