export interface SpendingGoal {
  id: string;
  type:
    | 'living_expenses'
    | 'charity'
    | 'dependent_support'
    | 'healthcare'
    | 'home_purchase'
    | 'education'
    | 'renovation'
    | 'vacation'
    | 'vehicle'
    | 'wedding'
    | 'other';
  name: string;
  amount: number; // Annual amount
  startAge: number;
  endAge?: number; // Optional for one-time or ongoing
  isOneTime?: boolean; // If true, spending occurs only in the start year
  inflationAdjusted: boolean;
  amountType?: 'full_price' | 'down_payment'; // home_purchase only
  amountPeriod?: 'monthly' | 'annual'; // UI hint for input/display period (default 'annual')
  yearlyDecreasePercent?: number; // Optional percentage decrease after inflation (living_expenses)
}
