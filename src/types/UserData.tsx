export interface UserData {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  currentSavings: number;
  annualSavings: number;
  monthlyRetirementSpending: number;
  ssAmount: number;
  riskLevel: 'conservative' | 'moderate' | 'high';
}