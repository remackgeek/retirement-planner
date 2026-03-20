import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import type { SpendingGoal } from '../types/SpendingGoal';

export const eventTypeLabels: Record<IncomeEventType, string> = {
  employment_savings: 'Employment Savings',
  social_security: 'Social Security',
  annuity_income: 'Annuity Income',
  inheritance: 'Inheritance',
  pension_income: 'Pension Income',
  rental_income: 'Rental Income',
  sale_of_property: 'Sale of Property/Downsize',
  work_during_retirement: 'Work During Retirement',
  other_income: 'Other Income',
};

export const goalTypeLabels: Record<SpendingGoal['type'], string> = {
  monthly_retirement: 'Monthly Retirement',
  charity: 'Charity/Gift',
  dependent_support: 'Dependent Support',
  healthcare: 'Healthcare',
  home_purchase: 'Home Purchase/Upgrade',
  education: 'Education',
  renovation: 'Renovation',
  vacation: 'Vacation',
  vehicle: 'Vehicle',
  wedding: 'Wedding',
  other: 'Other Expense',
};

export function generateDefaultIncomeEventName(
  type: IncomeEventType,
  existingEvents: IncomeEvent[]
): string {
  const label = eventTypeLabels[type];
  const sameTypeCount = existingEvents.filter((e) => e.type === type).length;
  return `${label} ${sameTypeCount + 1}`;
}

export function generateDefaultSpendingGoalName(
  type: SpendingGoal['type'],
  existingGoals: SpendingGoal[]
): string {
  const label = goalTypeLabels[type];
  const sameTypeCount = existingGoals.filter((g) => g.type === type).length;
  return `${label} ${sameTypeCount + 1}`;
}
