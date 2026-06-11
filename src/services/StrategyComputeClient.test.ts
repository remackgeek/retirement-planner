import { describe, it, expect } from 'vitest';
import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import { leanUserDataForWorker } from './StrategyComputeClient';
import { isGeneratorProducedConversion } from './strategies/syntheticEvents';

const makeUserData = (incomeEvents: IncomeEvent[]): UserData => ({
  currentAge: 60,
  lifeExpectancy: 70,
  referenceYear: 2026,
  accounts: [],
  spendingGoals: [],
  incomeEvents,
  portfolioAssumptions: {
    stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
    stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
    returnDistribution: 'lognormal', degreesOfFreedom: 4,
  },
  inflationRate: 0,
  inflationStdDev: 0,
  simulationSettings: { numSimulations: 10 },
  filingStatus: 'single',
  spouseAge: null,
  stateTimeline: [{ state: 'Florida' }],
  longTermCapGainsRate: 0.15,
});

const appliedWizardConversion: IncomeEvent = {
  id: 'evt-123',
  type: 'roth_conversion',
  name: 'Roth conversion 2027',
  amount: 50_000,
  startAge: 61,
  endAge: 61,
  isOneTime: true,
  taxStatus: 'before_tax',
  colaType: 'fixed',
  meta: { generatedBy: 'optimize', generatedAt: '2026-06-01', generatorRunId: 'run-abc' },
} as IncomeEvent;

describe('leanUserDataForWorker', () => {
  it('preserves meta.generatedBy so the worker can strip previously-applied wizard conversions', () => {
    // Regression: the original lean-clone dropped `meta` entirely, so
    // `isGeneratorProducedConversion` (which reads meta.generatedBy) treated
    // previously-applied wizard conversions as manual events on the worker
    // path. Candidate schedules then stacked new synthetic conversions on top
    // of the old applied batch — over-taxed candidates that always scored
    // below baseline, so wizard re-runs concluded "couldn't improve". The
    // inline (test) fallback never stripped meta, which is why no test caught
    // it.
    const lean = leanUserDataForWorker(makeUserData([appliedWizardConversion]));
    const e = lean.incomeEvents[0];
    expect(e.meta?.generatedBy).toBe('optimize');
    expect(isGeneratorProducedConversion(e)).toBe(true);
  });

  it('drops UI-only provenance (generatedAt / generatorRunId)', () => {
    const lean = leanUserDataForWorker(makeUserData([appliedWizardConversion]));
    const e = lean.incomeEvents[0];
    expect(e.meta?.generatedAt).toBeUndefined();
    expect(e.meta?.generatorRunId).toBeUndefined();
  });

  it('passes meta-less events through unchanged and never mutates the input', () => {
    const manual: IncomeEvent = {
      id: 'evt-9', type: 'pension_income', name: 'Pension', amount: 20_000, startAge: 65,
      taxStatus: 'before_tax', colaType: 'fixed',
    } as IncomeEvent;
    const original = makeUserData([manual, appliedWizardConversion]);
    const lean = leanUserDataForWorker(original);
    expect(lean.incomeEvents[0]).toBe(manual); // same reference — untouched
    // Original event still carries its full meta.
    expect(original.incomeEvents[1].meta?.generatorRunId).toBe('run-abc');
  });
});
