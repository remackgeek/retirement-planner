import type { IncomeEventType } from '../types/IncomeEvent';
import type { SpendingGoal } from '../types/SpendingGoal';

type SpendingGoalType = SpendingGoal['type'];

/** Build age dropdown options with year labels: "65 (2031)" */
export function buildAgeOptions(
  referenceYear: number,
  currentAge: number,
  minAge: number,
  maxAge: number,
): { label: string; value: number }[] {
  return Array.from({ length: maxAge - minAge + 1 }, (_, i) => {
    const age = minAge + i;
    const year = referenceYear + (age - currentAge);
    return { label: `${age} (${year})`, value: age };
  });
}

/** Build end-age dropdown options with a "None" entry for optional end age */
export function buildEndAgeOptions(
  referenceYear: number,
  currentAge: number,
  minAge: number,
  maxAge: number,
): { label: string; value: number }[] {
  return [
    { label: 'None', value: 0 },
    ...buildAgeOptions(referenceYear, currentAge, minAge, maxAge),
  ];
}

export const incomeEventAgeRanges: Record<IncomeEventType, { min: number; max: number }> = {
  employment_savings: { min: 18, max: 70 },
  social_security: { min: 62, max: 120 },
  annuity_income: { min: 50, max: 100 },
  inheritance: { min: 20, max: 100 },
  pension_income: { min: 50, max: 100 },
  rental_income: { min: 20, max: 100 },
  roth_conversion: { min: 50, max: 100 },
  sale_of_property: { min: 20, max: 100 },
  work_during_retirement: { min: 55, max: 90 },
  other_income: { min: 18, max: 100 },
};

export const spendingGoalAgeRanges: Record<SpendingGoalType, { min: number; max: number }> = {
  living_expenses: { min: 18, max: 100 },
  charity: { min: 18, max: 100 },
  dependent_support: { min: 18, max: 100 },
  healthcare: { min: 50, max: 100 },
  home_purchase: { min: 20, max: 100 },
  education: { min: 18, max: 100 },
  renovation: { min: 20, max: 100 },
  vacation: { min: 18, max: 100 },
  vehicle: { min: 18, max: 100 },
  wedding: { min: 18, max: 100 },
  other: { min: 18, max: 100 },
};
