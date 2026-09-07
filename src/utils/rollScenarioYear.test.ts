import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Scenario } from '../types/Scenario';
import {
  getPlanYearDelta,
  isStaleScenario,
  rollScenarioToYear,
} from './rollScenarioYear';

function loadFixture(name: string): Scenario {
  const raw = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'test', 'scenarios', name), 'utf-8'),
  ) as Record<string, unknown>;
  // Strip the `_`-prefixed test metadata; the fixtures carry no `id`, add one
  // so the object is a full Scenario.
  const clean: Record<string, unknown> = { id: 'fixture' };
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith('_')) clean[k] = v;
  return clean as unknown as Scenario;
}

const base: Scenario = {
  id: 's1',
  name: 'Base',
  currentAge: 60,
  lifeExpectancy: 90,
  referenceYear: 2025,
  filingStatus: 'mfj',
  spouseAge: 58,
  spouseLifeExpectancy: 92,
  accounts: [],
  incomeEvents: [
    {
      id: 'e-self', type: 'pension_income', name: 'P', amount: 1, startAge: 65,
      taxStatus: 'before_tax', colaType: 'fixed',
    },
    {
      id: 'e-spouse', type: 'social_security', owner: 'spouse', name: 'S', amount: 1,
      startAge: 67, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutYear: 2032,
    },
    {
      id: 'e-wage', type: 'wage_income', name: 'Salary', amount: 1, startAge: 40, endAge: 61,
      taxStatus: 'before_tax', colaType: 'fixed',
    },
    {
      id: 'e-old', type: 'inheritance', name: 'Old one-time', amount: 1, startAge: 55, isOneTime: true,
      taxStatus: 'after_tax', colaType: 'fixed',
    },
  ],
  spendingGoals: [
    { id: 'g', type: 'living_expenses', name: 'L', amount: 1, startAge: 60, inflationAdjusted: true },
    { id: 'g-trip', type: 'vacation', name: 'Trip', amount: 1, startAge: 60, isOneTime: true, inflationAdjusted: false },
    { id: 'g-future', type: 'vehicle', name: 'Car', amount: 1, startAge: 63, isOneTime: true, inflationAdjusted: false },
  ],
  portfolioAssumptions: {
    stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.03, bondStdDev: 0.05,
    stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
    returnDistribution: 'lognormal', degreesOfFreedom: 4, returnModel: 'parametric',
    historicalStartYear: 1966,
    blackSwanEvents: [{ year: 2027, stockMultiplier: 0.6, bondMultiplier: 1 }],
  },
  inflationRate: 0.03,
  inflationStdDev: 0,
  simulationSettings: { numSimulations: 100 },
  stateTimeline: [{ state: 'Florida' }, { state: 'Texas', startYear: 2028 }],
  longTermCapGainsRate: 0.15,
  lastSuccessProbability: 77,
};

describe('getPlanYearDelta / isStaleScenario', () => {
  it('is zero for a current-year scenario and never negative for a future one', () => {
    expect(getPlanYearDelta(base, 2025)).toBe(0);
    expect(getPlanYearDelta(base, 2024)).toBe(0);
    expect(isStaleScenario(base, 2025)).toBe(false);
    expect(isStaleScenario(base, 2024)).toBe(false);
  });

  it('counts the years behind the calendar', () => {
    expect(getPlanYearDelta(base, 2026)).toBe(1);
    expect(getPlanYearDelta(base, 2029)).toBe(4);
    expect(isStaleScenario(base, 2026)).toBe(true);
  });

  it('treats a non-finite referenceYear as not stale', () => {
    expect(getPlanYearDelta({ referenceYear: NaN }, 2026)).toBe(0);
  });
});

describe('rollScenarioToYear', () => {
  it('returns the SAME reference and delta 0 when not stale', () => {
    const r = rollScenarioToYear(base, 2025);
    expect(r.scenario).toBe(base);
    expect(r.delta).toBe(0);
    expect(r.changes).toBeNull();
    expect(rollScenarioToYear(base, 2020).scenario).toBe(base);
  });

  it('advances referenceYear and both ages by the delta, nothing else', () => {
    const { scenario: r, delta, changes } = rollScenarioToYear(base, 2027);
    expect(delta).toBe(2);
    expect(r.referenceYear).toBe(2027);
    expect(r.currentAge).toBe(62);
    expect(r.spouseAge).toBe(60);
    expect(r.lifeExpectancy).toBe(90);
    expect(r.spouseLifeExpectancy).toBe(92);
    expect(changes).toMatchObject({
      fromYear: 2025, toYear: 2027, delta: 2,
      currentAge: { from: 60, to: 62 },
      spouseAge: { from: 58, to: 60 },
      lifeExpectancyBumped: null,
      spouseLifeExpectancyBumped: null,
      historicalStartYear: null, // parametric: untouched
    });
    // Untouched: absolute-year fields, events/goals, balances, display cache.
    expect(r.stateTimeline).toEqual(base.stateTimeline);
    expect(r.portfolioAssumptions).toBe(base.portfolioAssumptions);
    expect(r.incomeEvents).toBe(base.incomeEvents);
    expect(r.spendingGoals).toBe(base.spendingGoals);
    expect(r.accounts).toBe(base.accounts);
    expect(r.lastSuccessProbability).toBe(77);
    expect(r.id).toBe(base.id);
    // Input not mutated.
    expect(base.referenceYear).toBe(2025);
    expect(base.currentAge).toBe(60);
  });

  it('preserves every age→calendar-year mapping (self and spouse-owned)', () => {
    const r = rollScenarioToYear(base, 2028).scenario;
    const yearOf = (s: Scenario, startAge: number, owner?: 'self' | 'spouse') => {
      const ownerAge = owner === 'spouse' && s.spouseAge != null ? s.spouseAge : s.currentAge;
      return s.referenceYear + (startAge - ownerAge);
    };
    for (const e of base.incomeEvents) {
      expect(yearOf(r, e.startAge, e.owner)).toBe(yearOf(base, e.startAge, e.owner));
    }
    for (const g of base.spendingGoals) {
      expect(yearOf(r, g.startAge)).toBe(yearOf(base, g.startAge));
    }
    // Birth year (drives RMD start age and SS FRA) is invariant too.
    expect(r.referenceYear - r.currentAge).toBe(base.referenceYear - base.currentAge);
    expect(r.referenceYear - r.spouseAge!).toBe(base.referenceYear - base.spouseAge!);
  });

  it('handles a null spouse', () => {
    const single: Scenario = { ...base, filingStatus: 'single', spouseAge: null, spouseLifeExpectancy: null };
    const { scenario: r, changes } = rollScenarioToYear(single, 2026);
    expect(r.spouseAge).toBeNull();
    expect(r.spouseLifeExpectancy).toBeNull();
    expect(changes?.spouseAge).toBeNull();
    expect(changes?.spouseLifeExpectancyBumped).toBeNull();
  });

  it('bumps life expectancies only when the roll would reach them', () => {
    const short: Scenario = { ...base, lifeExpectancy: 62, spouseLifeExpectancy: 59 };
    const { scenario: r, changes } = rollScenarioToYear(short, 2028); // delta 3
    expect(r.currentAge).toBe(63);
    expect(r.lifeExpectancy).toBe(64);
    expect(r.spouseAge).toBe(61);
    expect(r.spouseLifeExpectancy).toBe(62);
    expect(changes?.lifeExpectancyBumped).toEqual({ from: 62, to: 64 });
    expect(changes?.spouseLifeExpectancyBumped).toEqual({ from: 59, to: 62 });
    // Exactly at the boundary (le === new age) also bumps; one above does not.
    expect(rollScenarioToYear({ ...base, lifeExpectancy: 61 }, 2026).scenario.lifeExpectancy).toBe(62);
    expect(rollScenarioToYear({ ...base, lifeExpectancy: 62 }, 2026).scenario.lifeExpectancy).toBe(62);
  });

  it('moves historicalStartYear with the plan year only for historical_single', () => {
    const single: Scenario = {
      ...base,
      portfolioAssumptions: { ...base.portfolioAssumptions, returnModel: 'historical_single', historicalStartYear: 1966 },
    };
    const { scenario: r, changes } = rollScenarioToYear(single, 2027);
    expect(r.portfolioAssumptions.historicalStartYear).toBe(1968);
    expect(changes?.historicalStartYear).toEqual({ from: 1966, to: 1968 });
    // Calendar 2027 (was index 2 → 1968) is still 1968 (now index 0).
    expect(r.portfolioAssumptions.historicalStartYear! + (2027 - r.referenceYear)).toBe(1968);
    // Other fields of portfolioAssumptions untouched; input not mutated.
    expect(r.portfolioAssumptions.blackSwanEvents).toBe(base.portfolioAssumptions.blackSwanEvents);
    expect(single.portfolioAssumptions.historicalStartYear).toBe(1966);

    for (const returnModel of ['historical_rolling', 'historical_bootstrap'] as const) {
      const other: Scenario = {
        ...base,
        portfolioAssumptions: { ...base.portfolioAssumptions, returnModel, historicalStartYear: 1966 },
      };
      const rr = rollScenarioToYear(other, 2027);
      expect(rr.scenario.portfolioAssumptions).toBe(other.portfolioAssumptions);
      expect(rr.changes?.historicalStartYear).toBeNull();
    }
  });

  it('lists the items that fall into the past because of this roll', () => {
    const { changes } = rollScenarioToYear(base, 2027); // 2025 → 2027
    // Salary ends at age 61 = 2026 (< 2027): newly past. Trip one-time at age
    // 60 = 2025: newly past. "Old one-time" at age 55 = 2020: was already past
    // before the roll → not listed. Car at 63 = 2028: still ahead. Pension /
    // SS / living: ongoing → never listed.
    expect(changes?.pastItems).toEqual([
      { id: 'e-wage', name: 'Salary', kind: 'income', lastYear: 2026 },
      { id: 'g-trip', name: 'Trip', kind: 'spending', lastYear: 2025 },
    ]);
    // A one-year roll drops only the age-60 trip.
    expect(rollScenarioToYear(base, 2026).changes?.pastItems.map((p) => p.id)).toEqual(['g-trip']);
  });

  it('uses the spouse age for spouse-owned items', () => {
    const s: Scenario = {
      ...base,
      incomeEvents: [{
        id: 'sp', type: 'wage_income', owner: 'spouse', name: 'Spouse job', amount: 1,
        startAge: 40, endAge: 58, taxStatus: 'before_tax', colaType: 'fixed',
      }],
      spendingGoals: [],
    };
    // Spouse 58 → endAge 58 = 2025; rolling to 2026 drops it.
    expect(rollScenarioToYear(s, 2026).changes?.pastItems.map((p) => p.id)).toEqual(['sp']);
  });

  it('is idempotent', () => {
    const once = rollScenarioToYear(base, 2026).scenario;
    const again = rollScenarioToYear(once, 2026);
    expect(again.delta).toBe(0);
    expect(again.scenario).toBe(once);
  });

  it('turns the 2025 fixture into the 2026 twin exactly', () => {
    const stale = loadFixture('stale-plan-2025.json');
    const twin = loadFixture('stale-plan-2026-twin.json');
    const rolled = rollScenarioToYear(stale, 2026);
    expect(rolled.delta).toBe(1);
    expect(rolled.scenario).toEqual(twin);
    expect(rolled.changes?.pastItems).toEqual([
      { id: 'vacation-2025', name: 'Vacation 1', kind: 'spending', lastYear: 2025 },
    ]);
  });
});
