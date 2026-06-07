import type { Scenario } from '../types/Scenario';
import type { IncomeEvent } from '../types/IncomeEvent';

/**
 * Replace all generator-tagged `roth_conversion` events with `newEvents`,
 * preserving manual conversions (`meta.generatedBy === 'user'` or absent) and
 * every non-conversion event. Pure — returns a new Scenario.
 *
 * Shared by the income-panel re-run path and the Tools-menu wizard so both
 * apply the same replace policy.
 */
export function applyGeneratedConversions(
  scenario: Scenario,
  newEvents: Omit<IncomeEvent, 'id'>[],
): Scenario {
  const survivors = scenario.incomeEvents.filter((e) => {
    if (e.type !== 'roth_conversion') return true;
    const gb = e.meta?.generatedBy;
    return gb === undefined || gb === 'user';
  });
  const tagged: IncomeEvent[] = newEvents.map((e) => ({ ...e, id: crypto.randomUUID() }));
  return { ...scenario, incomeEvents: [...survivors, ...tagged] };
}
