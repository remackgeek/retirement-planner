export type AccountType = 'traditional' | 'roth' | 'taxable';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  owner?: 'self' | 'spouse';
}
