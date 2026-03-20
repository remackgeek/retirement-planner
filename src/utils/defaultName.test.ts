import { describe, it, expect } from 'vitest';
import {
  generateDefaultIncomeEventName,
  generateDefaultSpendingGoalName,
  eventTypeLabels,
  goalTypeLabels,
} from './defaultName';
import type { IncomeEvent } from '../types/IncomeEvent';
import type { SpendingGoal } from '../types/SpendingGoal';

const makeEvent = (type: IncomeEvent['type'], name = ''): IncomeEvent => ({
  id: crypto.randomUUID(),
  name,
  type,
  amount: 10000,
  startAge: 65,
  taxStatus: 'before_tax',
  colaType: 'fixed',
});

const makeGoal = (type: SpendingGoal['type'], name = ''): SpendingGoal => ({
  id: crypto.randomUUID(),
  name,
  type,
  amount: 5000,
  startAge: 65,
  inflationAdjusted: false,
});

describe('generateDefaultIncomeEventName', () => {
  it('returns "Type 1" when no existing events', () => {
    expect(generateDefaultIncomeEventName('pension_income', [])).toBe('Pension Income 1');
    expect(generateDefaultIncomeEventName('social_security', [])).toBe('Social Security 1');
  });

  it('increments count based on same-type events', () => {
    const existing = [makeEvent('pension_income'), makeEvent('pension_income')];
    expect(generateDefaultIncomeEventName('pension_income', existing)).toBe('Pension Income 3');
  });

  it('ignores events of different types', () => {
    const existing = [makeEvent('pension_income'), makeEvent('social_security')];
    expect(generateDefaultIncomeEventName('inheritance', existing)).toBe('Inheritance 1');
  });

  it('produces correct labels for all types', () => {
    for (const [type, label] of Object.entries(eventTypeLabels)) {
      expect(generateDefaultIncomeEventName(type as IncomeEvent['type'], [])).toBe(`${label} 1`);
    }
  });
});

describe('generateDefaultSpendingGoalName', () => {
  it('returns "Type 1" when no existing goals', () => {
    expect(generateDefaultSpendingGoalName('vacation', [])).toBe('Vacation 1');
    expect(generateDefaultSpendingGoalName('home_purchase', [])).toBe('Home Purchase/Upgrade 1');
  });

  it('increments count based on same-type goals', () => {
    const existing = [makeGoal('vacation'), makeGoal('vacation'), makeGoal('vacation')];
    expect(generateDefaultSpendingGoalName('vacation', existing)).toBe('Vacation 4');
  });

  it('ignores goals of different types', () => {
    const existing = [makeGoal('vacation'), makeGoal('healthcare')];
    expect(generateDefaultSpendingGoalName('education', existing)).toBe('Education 1');
  });

  it('produces correct labels for all types', () => {
    for (const [type, label] of Object.entries(goalTypeLabels)) {
      expect(generateDefaultSpendingGoalName(type as SpendingGoal['type'], [])).toBe(`${label} 1`);
    }
  });
});
