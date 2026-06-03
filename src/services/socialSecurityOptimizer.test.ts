import { describe, it, expect } from 'vitest';
import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import { optimizeClaimingAge, buildClaimingEvent, findCrossoverAge } from './socialSecurityOptimizer';
import { computeFraMonths } from './socialSecurity';

function baseUserData(overrides: Partial<UserData> = {}): UserData {
  return {
    currentAge: 62,
    lifeExpectancy: 92,
    accounts: [
      { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 600000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
    ],
    spendingGoals: [
      { id: 'live', type: 'living_expenses', name: 'Living', amount: 40000, startAge: 62, inflationAdjusted: true },
    ],
    incomeEvents: [],
    portfolioAssumptions: {
      stockReturn: 0.05,
      stockStdDev: 0,
      bondReturn: 0.03,
      bondStdDev: 0,
      stockBondCorrelationEnabled: false,
      stockBondCorrelation: 0,
      returnDistribution: 'lognormal',
      degreesOfFreedom: 4,
    },
    referenceYear: 2026,
    inflationRate: 0,
    inflationStdDev: 0,
    simulationSettings: { numSimulations: 100 },
    filingStatus: 'single',
    spouseAge: null,
    stateTimeline: [{ state: 'Florida' }],
    longTermCapGainsRate: 0.15,
    ...overrides,
  };
}

const FRA_1964 = computeFraMonths(2026 - 62); // born 1964 → FRA 67

describe('optimizeClaimingAge', () => {
  it('produces one result per age with benefit increasing in claim age', () => {
    const userData = baseUserData();
    const sweep = optimizeClaimingAge(userData, {
      owner: 'self',
      pia: 30000,
      fraMonths: FRA_1964,
      ageMin: 62,
      ageMax: 70,
    });

    expect(sweep.results).toHaveLength(9);
    expect(sweep.results[0].age).toBe(62);
    expect(sweep.results[8].age).toBe(70);

    // Actuarial benefit is strictly increasing with claim age.
    for (let i = 1; i < sweep.results.length; i++) {
      expect(sweep.results[i].annualBenefit).toBeGreaterThan(sweep.results[i - 1].annualBenefit);
    }

    // Anchors: 62 → 70% of PIA, 70 → 124%.
    expect(sweep.results[0].annualBenefit).toBeCloseTo(21000, 0);
    expect(sweep.results[8].annualBenefit).toBeCloseTo(37200, 0);

    expect(sweep.bestAge).not.toBeNull();
    expect(sweep.bestAge!).toBeGreaterThanOrEqual(62);
    expect(sweep.bestAge!).toBeLessThanOrEqual(70);
  });

  it('reports the current claim age from the existing SS event template', () => {
    const template: IncomeEvent = {
      id: 'ss', type: 'social_security', owner: 'self', name: 'SS',
      amount: 30000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted',
      ssAmountBasis: 'today',
    };
    const userData = baseUserData({ incomeEvents: [template] });
    const sweep = optimizeClaimingAge(userData, {
      owner: 'self', pia: 30000, fraMonths: FRA_1964, ageMin: 62, ageMax: 70, template,
    });
    expect(sweep.currentClaimAge).toBe(67);
    expect(sweep.inflationFactors.length).toBeGreaterThan(0);
    expect(sweep.results.length).toBe(9);
  });

  it('only sweeps the requested age range', () => {
    // Mirrors the dialog clamping the start to the owner's current age.
    const sweep = optimizeClaimingAge(baseUserData(), {
      owner: 'self', pia: 30000, fraMonths: FRA_1964, ageMin: 66, ageMax: 70,
    });
    expect(sweep.results.map((r) => r.age)).toEqual([66, 67, 68, 69, 70]);
  });

  it('propagates the 2034 haircut into the candidate projections', () => {
    // baseUserData spans 2026–2056, so every candidate has post-2034 benefit
    // years. Turning the haircut on must lower terminal value (less SS income
    // → more portfolio drawdown). Anchored on the age-62 candidate.
    const params = { owner: 'self' as const, pia: 30000, fraMonths: FRA_1964, ageMin: 62, ageMax: 70 };
    const off = optimizeClaimingAge(baseUserData(), { ...params, haircutEnabled: false });
    const on = optimizeClaimingAge(baseUserData(), { ...params, haircutEnabled: true, haircutPercent: 23 });
    expect(on.results[0].terminalReal).toBeLessThan(off.results[0].terminalReal);
  });

  it('includes enteredPlanPath only when a saved SS entry exists', () => {
    const noEntry = optimizeClaimingAge(baseUserData(), {
      owner: 'self', pia: 30000, fraMonths: FRA_1964, ageMin: 62, ageMax: 70,
    });
    expect(noEntry.enteredPlanPath).toBeUndefined();

    const template: IncomeEvent = {
      id: 'ss', type: 'social_security', owner: 'self', name: 'SS',
      amount: 30000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted',
      ssAmountBasis: 'today',
    };
    const withEntry = optimizeClaimingAge(baseUserData({ incomeEvents: [template] }), {
      owner: 'self', pia: 30000, fraMonths: FRA_1964, ageMin: 62, ageMax: 70, template,
    });
    expect(withEntry.enteredPlanPath).toBeDefined();
    expect(withEntry.enteredPlanPath!.length).toBeGreaterThan(0);
  });
});

describe('buildClaimingEvent', () => {
  it('emits a today-dollar SS event inheriting haircut settings', () => {
    const template: IncomeEvent = {
      id: 'ss', type: 'social_security', owner: 'self', name: 'My SS',
      amount: 30000, startAge: 67, taxStatus: 'before_tax', colaType: 'fixed',
      ssHaircutEnabled: false, ssHaircutPercent: 19,
    };
    const built = buildClaimingEvent(template, 'self', 70, 37200);
    expect(built.type).toBe('social_security');
    expect(built.ssAmountBasis).toBe('today');
    expect(built.amount).toBe(37200);
    expect(built.startAge).toBe(70);
    expect(built.colaType).toBe('fixed');
    expect(built.ssHaircutEnabled).toBe(false);
    expect(built.ssHaircutPercent).toBe(19);
    expect(built.name).toBe('My SS');
  });

  it('defaults haircut on/23% and generates a name when no template', () => {
    const built = buildClaimingEvent(undefined, 'spouse', 67, 25000);
    expect(built.ssHaircutEnabled).toBe(true);
    expect(built.ssHaircutPercent).toBe(23);
    expect(built.colaType).toBe('inflation_adjusted');
    expect(built.name).toBe('Social Security (Spouse)');
  });

  it('explicit haircut opts override the template (false and custom % honored)', () => {
    const template: IncomeEvent = {
      id: 'ss', type: 'social_security', owner: 'self', name: 'SS',
      amount: 30000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted',
      ssHaircutEnabled: true, ssHaircutPercent: 23,
    };
    const off = buildClaimingEvent(template, 'self', 70, 37200, { haircutEnabled: false });
    expect(off.ssHaircutEnabled).toBe(false);

    const custom = buildClaimingEvent(template, 'self', 70, 37200, { haircutEnabled: true, haircutPercent: 19 });
    expect(custom.ssHaircutEnabled).toBe(true);
    expect(custom.ssHaircutPercent).toBe(19);
  });
});

describe('findCrossoverAge', () => {
  it('finds the age where the later path overtakes the earlier path', () => {
    const earlier = [100, 90, 80, 70, 60]; // claiming sooner: ahead early, fades
    const later = [100, 85, 80, 75, 70]; //   claiming later: behind then overtakes
    expect(findCrossoverAge(later, earlier, 62)).toBe(64); // index 2 → age 64
  });

  it('returns null when the later path never falls behind', () => {
    expect(findCrossoverAge([10, 11, 12], [9, 9, 9], 62)).toBeNull();
  });
});
