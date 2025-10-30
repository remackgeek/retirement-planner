export interface SpendingGoal {
  id: string;
  type:
    | 'monthly_retirement'
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
  name?: string; // For 'other' type
  amount: number; // Annual amount
  startAge: number;
  endAge?: number; // Optional for one-time or ongoing
  isOneTime?: boolean; // If true, spending occurs only in the start year
  inflationAdjusted: boolean;
}

export interface RetirementSpending {
  monthlyAmount: number;
  yearlyDecreasePercent?: number; // Optional percentage decrease after inflation
  startAge: number; // Usually 65 or later
}
