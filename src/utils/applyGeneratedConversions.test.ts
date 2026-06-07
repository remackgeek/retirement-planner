import { describe, it, expect } from 'vitest';
import { applyGeneratedConversions } from './applyGeneratedConversions';
import type { Scenario } from '../types/Scenario';
import type { IncomeEvent } from '../types/IncomeEvent';

// Minimal event factory — only the fields the helper inspects matter
// (type, meta.generatedBy, id). Cast keeps the fixture light.
const ev = (over: Partial<IncomeEvent>): IncomeEvent =>
  ({ id: over.id ?? crypto.randomUUID(), type: 'pension_income', name: 'x', amount: 0, ...over } as IncomeEvent);

const scenarioWith = (incomeEvents: IncomeEvent[]): Scenario =>
  ({ incomeEvents } as Scenario);

describe('applyGeneratedConversions', () => {
  it('keeps non-conversion events untouched', () => {
    const wage = ev({ id: 'w1', type: 'wage_income' });
    const result = applyGeneratedConversions(scenarioWith([wage]), []);
    expect(result.incomeEvents).toContainEqual(wage);
  });

  it('keeps manual conversions (meta absent or generatedBy === user)', () => {
    const untagged = ev({ id: 'c1', type: 'roth_conversion' });
    const userTagged = ev({ id: 'c2', type: 'roth_conversion', meta: { generatedBy: 'user' } });
    const result = applyGeneratedConversions(scenarioWith([untagged, userTagged]), []);
    expect(result.incomeEvents.map((e) => e.id).sort()).toEqual(['c1', 'c2']);
  });

  it('removes generator-tagged conversions (fill/auto/optimize)', () => {
    const gens = (['fill_to_bracket', 'auto_bracket', 'optimize'] as const).map((g, i) =>
      ev({ id: `g${i}`, type: 'roth_conversion', meta: { generatedBy: g } }),
    );
    const result = applyGeneratedConversions(scenarioWith(gens), []);
    expect(result.incomeEvents).toHaveLength(0);
  });

  it('replaces the old generated batch with the new one and assigns fresh ids', () => {
    const oldGen = ev({ id: 'old', type: 'roth_conversion', meta: { generatedBy: 'optimize' } });
    const manual = ev({ id: 'man', type: 'roth_conversion', meta: { generatedBy: 'user' } });
    const batch: Omit<IncomeEvent, 'id'>[] = [
      { type: 'roth_conversion', name: 'gen 1', amount: 10000, meta: { generatedBy: 'optimize' } } as Omit<IncomeEvent, 'id'>,
      { type: 'roth_conversion', name: 'gen 2', amount: 20000, meta: { generatedBy: 'optimize' } } as Omit<IncomeEvent, 'id'>,
    ];
    const result = applyGeneratedConversions(scenarioWith([oldGen, manual]), batch);
    // Old generated gone, manual kept, two new appended with ids
    expect(result.incomeEvents.map((e) => e.id)).toContain('man');
    expect(result.incomeEvents.map((e) => e.id)).not.toContain('old');
    expect(result.incomeEvents).toHaveLength(3);
    const appended = result.incomeEvents.filter((e) => e.name?.startsWith('gen '));
    expect(appended).toHaveLength(2);
    appended.forEach((e) => expect(typeof e.id).toBe('string'));
  });

  it('does not mutate the input scenario', () => {
    const original = scenarioWith([ev({ id: 'g', type: 'roth_conversion', meta: { generatedBy: 'optimize' } })]);
    const snapshot = original.incomeEvents.slice();
    applyGeneratedConversions(original, [
      { type: 'roth_conversion', name: 'new', amount: 1, meta: { generatedBy: 'optimize' } } as Omit<IncomeEvent, 'id'>,
    ]);
    expect(original.incomeEvents).toEqual(snapshot);
  });
});
