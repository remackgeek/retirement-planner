import type { IncomeEvent, IncomeEventType } from '../types/IncomeEvent';
import type { SpendingGoal } from '../types/SpendingGoal';
import type { Account, AccountType } from '../types/Account';

export const eventTypeLabels: Record<IncomeEventType, string> = {
  wage_income: 'Salary',
  retirement_contribution: 'Retirement Contribution',
  social_security: 'Social Security',
  annuity_income: 'Annuity Income',
  inheritance: 'Inheritance',
  pension_income: 'Pension Income',
  rental_income: 'Rental Income',
  roth_conversion: 'Roth Conversion',
  sale_of_property: 'Sale of Property/Downsize',
  work_during_retirement: 'Work During Retirement',
  other_income: 'Other Income',
};

export const eventTypeIcons: Record<IncomeEventType, string> = {
  wage_income: 'pi pi-wallet',
  retirement_contribution: 'pi pi-database',
  social_security: 'pi pi-shield',
  annuity_income: 'pi pi-money-bill',
  inheritance: 'pi pi-gift',
  pension_income: 'pi pi-briefcase',
  rental_income: 'pi pi-home',
  roth_conversion: 'pi pi-sync',
  sale_of_property: 'pi pi-arrow-right-arrow-left',
  work_during_retirement: 'pi pi-cog',
  other_income: 'pi pi-ellipsis-h',
};

export const goalTypeIcons: Record<SpendingGoal['type'], string> = {
  living_expenses: 'pi pi-dollar',
  charity: 'pi pi-heart',
  dependent_support: 'pi pi-users',
  healthcare: 'pi pi-heart-fill',
  home_purchase: 'pi pi-home',
  education: 'pi pi-book',
  renovation: 'pi pi-wrench',
  vacation: 'pi pi-map',
  vehicle: 'pi pi-car',
  wedding: 'pi pi-star',
  other: 'pi pi-ellipsis-h',
};

export const goalTypeLabels: Record<SpendingGoal['type'], string> = {
  living_expenses: 'Living Expenses',
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

export const accountTypeLabels: Record<AccountType, string> = {
  traditional: 'Traditional IRA/401k',
  roth: 'Roth IRA/401k',
  taxable: 'Taxable Brokerage',
  cash: 'Cash / Money Market',
};

export const accountTypeIcons: Record<AccountType, string> = {
  traditional: 'pi pi-building',
  roth: 'pi pi-shield',
  taxable: 'pi pi-chart-line',
  cash: 'pi pi-wallet',
};

export const accountTypeShortLabels: Record<AccountType, string> = {
  traditional: 'Traditional',
  roth: 'Roth',
  taxable: 'Taxable',
  cash: 'Cash',
};

export function generateDefaultAccountName(
  type: AccountType,
  existingAccounts: Account[]
): string {
  const label = accountTypeShortLabels[type];
  const sameTypeCount = existingAccounts.filter((a) => a.type === type).length;
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
