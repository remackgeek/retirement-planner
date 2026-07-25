import { describe, it, expect } from 'vitest';
import type { Scenario } from '../types/Scenario';
import { CURRENT_SCHEMA_VERSION } from '../types/Scenario';
import {
  validateImportedScenario,
  runMigrationPipeline,
  normalizeScenario,
  migrateCashBucketMonthsToAmounts,
  repairInflatedCashBucketBand,
} from './scenarioMigration';

function makeValidScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 's1',
    name: 'Valid',
    currentAge: 50,
    lifeExpectancy: 90,
    referenceYear: 2026,
    inflationRate: 0.03,
    inflationStdDev: 0,
    filingStatus: 'single',
    spouseAge: null,
    longTermCapGainsRate: 0.15,
    stateTimeline: [{ state: 'Florida' }],
    simulationSettings: { numSimulations: 100 },
    accounts: [
      { id: 'a1', name: 'Trad', type: 'traditional', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' },
    ],
    incomeEvents: [],
    spendingGoals: [],
    portfolioAssumptions: {
      stockReturn: 0.07,
      stockStdDev: 0.15,
      bondReturn: 0.03,
      bondStdDev: 0.05,
      stockBondCorrelationEnabled: false,
      stockBondCorrelation: -0.2,
      returnDistribution: 'lognormal',
      degreesOfFreedom: 4,
      returnModel: 'parametric',
    },
    ...overrides,
  } as Scenario;
}

describe('validateImportedScenario', () => {
  it('accepts a fully valid scenario', () => {
    expect(() => validateImportedScenario(makeValidScenario())).not.toThrow();
  });

  it('rejects a file from a newer app version (forward-compat guard)', () => {
    const s = makeValidScenario({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(() => validateImportedScenario(s)).toThrow(/newer version of YARP/);
  });

  it('rejects non-finite core numerics (JSON 1e400 parses to Infinity and would hang the projection loop)', () => {
    // typeof Infinity === 'number', so the old typeof checks admitted these.
    expect(() => validateImportedScenario(makeValidScenario({ lifeExpectancy: Infinity })))
      .toThrow(/lifeExpectancy/);
    expect(() => validateImportedScenario(makeValidScenario({ currentAge: NaN })))
      .toThrow(/currentAge/);
    expect(() => validateImportedScenario(makeValidScenario({ referenceYear: Infinity })))
      .toThrow(/referenceYear/);
    expect(() => validateImportedScenario(makeValidScenario({ inflationRate: NaN })))
      .toThrow(/inflationRate/);
  });

  it('accepts the legacy "taxable" account type (migration rewrites it later)', () => {
    const s = makeValidScenario({
      accounts: [
        { id: 'a1', name: 'Brk', type: 'taxable' as never, balance: 50000, stockAllocation: 0.6, portfolioBalance: '60_40' },
      ],
    });
    expect(() => validateImportedScenario(s)).not.toThrow();
  });

  it('rejects an account with an invalid type', () => {
    const s = makeValidScenario({
      accounts: [
        { id: 'a1', name: 'Weird', type: 'crypto' as never, balance: 1, stockAllocation: 0.6, portfolioBalance: '60_40' },
      ],
    });
    expect(() => validateImportedScenario(s)).toThrow(/accounts\[0\].*invalid type/);
  });

  it('rejects an account with a non-numeric balance', () => {
    const s = makeValidScenario({
      accounts: [
        { id: 'a1', name: 'NoBal', type: 'cash', balance: 'lots' as never, stockAllocation: 0, portfolioBalance: '60_40' },
      ],
    });
    expect(() => validateImportedScenario(s)).toThrow(/balance must be a number/);
  });

  it('rejects an income event with an invalid type', () => {
    const s = makeValidScenario({
      incomeEvents: [
        { id: 'e1', name: 'Bad', type: 'lottery' as never, amount: 100, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
    });
    expect(() => validateImportedScenario(s)).toThrow(/incomeEvents\[0\].*invalid type/);
  });

  it('rejects an income event missing amount', () => {
    const s = makeValidScenario({
      incomeEvents: [
        { id: 'e1', name: 'Pension', type: 'pension_income', amount: undefined as never, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
    });
    expect(() => validateImportedScenario(s)).toThrow(/amount must be a number/);
  });

  it('rejects a spending goal with a non-boolean inflationAdjusted', () => {
    const s = makeValidScenario({
      spendingGoals: [
        { id: 'g1', name: 'Living', type: 'living_expenses', amount: 40000, startAge: 50, inflationAdjusted: 'yes' as never },
      ],
    });
    expect(() => validateImportedScenario(s)).toThrow(/inflationAdjusted must be a boolean/);
  });

  it('rejects missing portfolioAssumptions stdDev fields', () => {
    const s = makeValidScenario();
    (s.portfolioAssumptions as { stockStdDev?: number }).stockStdDev = undefined;
    expect(() => validateImportedScenario(s)).toThrow(/stockStdDev and bondStdDev must be numbers/);
  });

  it('requires historicalStartYear for the single-sequence model', () => {
    const s = makeValidScenario();
    s.portfolioAssumptions.returnModel = 'historical_single';
    expect(() => validateImportedScenario(s)).toThrow(/historicalStartYear is required/);
  });

  it('requires historicalBlockSize for the bootstrap model', () => {
    const s = makeValidScenario();
    s.portfolioAssumptions.returnModel = 'historical_bootstrap';
    expect(() => validateImportedScenario(s)).toThrow(/historicalBlockSize is required/);
  });

  it('rejects a non-object file (null / array / primitive)', () => {
    expect(() => validateImportedScenario(null as never)).toThrow(/does not contain a scenario object/);
    expect(() => validateImportedScenario([] as never)).toThrow(/does not contain a scenario object/);
    expect(() => validateImportedScenario(42 as never)).toThrow(/does not contain a scenario object/);
  });
});

describe('normalizeScenario', () => {
  it('reports no change for a fully-valid current scenario', () => {
    const { changed } = normalizeScenario(makeValidScenario({ schemaVersion: CURRENT_SCHEMA_VERSION }));
    expect(changed).toBe(false);
  });

  it('fills portfolioAssumptions defaults on a legacy scenario', () => {
    const legacy = makeValidScenario({
      portfolioAssumptions: {
        stockReturn: 0.07,
        stockStdDev: 0.15,
        bondReturn: 0.03,
        bondStdDev: 0.05,
      } as never,
    });
    const { scenario, changed } = normalizeScenario(legacy);
    expect(changed).toBe(true);
    expect(scenario.portfolioAssumptions.returnDistribution).toBe('lognormal');
    expect(scenario.portfolioAssumptions.degreesOfFreedom).toBe(4);
    expect(scenario.portfolioAssumptions.returnModel).toBe('parametric');
    expect(scenario.portfolioAssumptions.stockBondCorrelationEnabled).toBe(false);
  });

  it('preserves a valid historical_bootstrap returnModel (does not downgrade to parametric)', () => {
    // Regression guard: the old import-only normalization clobbered
    // historical_bootstrap → parametric. The shared pipeline must keep it.
    const s = makeValidScenario();
    s.portfolioAssumptions.returnModel = 'historical_bootstrap';
    s.portfolioAssumptions.historicalBlockSize = 5;
    const { scenario } = normalizeScenario(s);
    expect(scenario.portfolioAssumptions.returnModel).toBe('historical_bootstrap');
  });

  it('coerces an unrecognized returnModel to parametric', () => {
    const s = makeValidScenario();
    (s.portfolioAssumptions as { returnModel?: string }).returnModel = 'quantum';
    const { scenario, changed } = normalizeScenario(s);
    expect(changed).toBe(true);
    expect(scenario.portfolioAssumptions.returnModel).toBe('parametric');
  });

  it('clamps stockBondCorrelation into [-1, 1]', () => {
    const s = makeValidScenario();
    s.portfolioAssumptions.stockBondCorrelation = 5;
    const { scenario } = normalizeScenario(s);
    expect(scenario.portfolioAssumptions.stockBondCorrelation).toBe(1);
  });

  it('backfills account allocation defaults', () => {
    const s = makeValidScenario({
      accounts: [
        { id: 'a1', name: 'Old', type: 'brokerage', balance: 1000 } as never,
      ],
    });
    const { scenario, changed } = normalizeScenario(s);
    expect(changed).toBe(true);
    expect(scenario.accounts[0].stockAllocation).toBe(0.6);
    expect(scenario.accounts[0].portfolioBalance).toBe('60_40');
  });
});

describe('runMigrationPipeline', () => {
  it('stamps schemaVersion on an unstamped scenario', () => {
    const result = runMigrationPipeline(makeValidScenario());
    expect(result.scenario.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.stamped).toBe(true);
  });

  it('is idempotent — second run reports no changes', () => {
    const first = runMigrationPipeline(makeValidScenario());
    const second = runMigrationPipeline(first.scenario);
    expect(second.normalized).toBe(false);
    expect(second.stamped).toBe(false);
    expect(second.addedConversions).toBe(0);
    expect(second.brokerageRenamed).toBe(false);
    expect(second.spendingStripped).toBe(false);
    expect(second.scenario).toEqual(first.scenario);
  });

  it('renames a legacy taxable account through the pipeline', () => {
    const s = makeValidScenario({
      accounts: [
        { id: 'a1', name: 'Brk', type: 'taxable' as never, balance: 50000, stockAllocation: 0.6, portfolioBalance: '60_40' },
      ],
    });
    const result = runMigrationPipeline(s);
    expect(result.brokerageRenamed).toBe(true);
    expect(result.scenario.accounts[0].type).toBe('brokerage');
  });

  it('strips a deprecated spendingWithdrawalOrder field', () => {
    const s = makeValidScenario();
    (s as Scenario & { spendingWithdrawalOrder?: string }).spendingWithdrawalOrder = 'brokerage_first';
    const result = runMigrationPipeline(s);
    expect(result.spendingStripped).toBe(true);
    expect((result.scenario as Scenario & { spendingWithdrawalOrder?: string }).spendingWithdrawalOrder).toBeUndefined();
  });

  it('converts a month-based cash bucket policy through the pipeline', () => {
    const s = makeValidScenario({
      currentAge: 60,
      spendingGoals: [
        { id: 'le', type: 'living_expenses', name: 'Living', amount: 60000, startAge: 60, inflationAdjusted: false },
      ],
      cashBucketPolicy: { minMonths: 6, targetMonths: 12, maxMonths: 24, refillTrigger: 'gains_only' } as never,
    });
    const result = runMigrationPipeline(s);
    expect(result.cashBucketConverted).toBe(true);
    // monthly = $60k/12 = $5k → min 6×$5k=$30k, target 12×$5k=$60k, max 24×$5k=$120k.
    expect(result.scenario.cashBucketPolicy).toEqual({
      minAmount: 30000,
      targetAmount: 60000,
      maxAmount: 120000,
      refillTrigger: 'gains_only',
    });
  });
});

describe('migrateCashBucketMonthsToAmounts', () => {
  it('is a no-op when the policy is already amount-based', () => {
    const s = makeValidScenario({
      cashBucketPolicy: { minAmount: 10000, targetAmount: 30000, maxAmount: 60000, refillTrigger: 'always' },
    });
    const { scenario, changed } = migrateCashBucketMonthsToAmounts(s);
    expect(changed).toBe(false);
    expect(scenario).toBe(s);
  });

  it('is a no-op when no policy exists', () => {
    const { changed } = migrateCashBucketMonthsToAmounts(makeValidScenario());
    expect(changed).toBe(false);
  });

  it('falls back to default amounts when no living-expenses spending is found', () => {
    const s = makeValidScenario({
      spendingGoals: [],
      cashBucketPolicy: { minMonths: 6, targetMonths: 12, maxMonths: 24, refillTrigger: 'gains_only' } as never,
    });
    const { scenario, changed } = migrateCashBucketMonthsToAmounts(s);
    expect(changed).toBe(true);
    expect(scenario.cashBucketPolicy).toEqual({
      minAmount: 20000,
      targetAmount: 60000,
      maxAmount: 120000,
      refillTrigger: 'gains_only',
    });
  });

  it('is idempotent — a second pass leaves the converted policy unchanged', () => {
    const s = makeValidScenario({
      currentAge: 60,
      spendingGoals: [
        { id: 'le', type: 'living_expenses', name: 'Living', amount: 60000, startAge: 60, inflationAdjusted: false },
      ],
      cashBucketPolicy: { minMonths: 6, targetMonths: 12, maxMonths: 24, refillTrigger: 'gains_only' } as never,
    });
    const first = migrateCashBucketMonthsToAmounts(s);
    const second = migrateCashBucketMonthsToAmounts(first.scenario);
    expect(second.changed).toBe(false);
    expect(second.scenario.cashBucketPolicy).toEqual(first.scenario.cashBucketPolicy);
  });

  it('treats a monthly-period goal identically to an annual one — amount is always stored annual', () => {
    // Regression: `goal.amount` is stored annual regardless of amountPeriod
    // (the dialog multiplies by 12 on save; the field is a display hint), but
    // the migration annualized AGAIN for amountPeriod === 'monthly' — the
    // dialog default for living expenses — persisting 12× inflated bands
    // ($5k/mo × minMonths 6 became a $360k floor instead of $30k).
    const s = makeValidScenario({
      currentAge: 60,
      spendingGoals: [
        { id: 'le', type: 'living_expenses', name: 'Living', amount: 60000, startAge: 60, inflationAdjusted: false, amountPeriod: 'monthly' },
      ],
      cashBucketPolicy: { minMonths: 6, targetMonths: 12, maxMonths: 24, refillTrigger: 'gains_only' } as never,
    });
    const { scenario, changed } = migrateCashBucketMonthsToAmounts(s);
    expect(changed).toBe(true);
    expect(scenario.cashBucketPolicy).toEqual({
      minAmount: 30000,
      targetAmount: 60000,
      maxAmount: 120000,
      refillTrigger: 'gains_only',
    });
  });
});

describe('repairInflatedCashBucketBand (v1 → v2)', () => {
  // The released buggy build annualized a monthly-period goal twice, so it
  // multiplied the months counts by the ANNUAL spend. $60k/yr with
  // {min 6, target 12, max 24} months persisted as 360k/720k/1.44M instead of
  // 30k/60k/120k — and deleted the months fields, so only this repair can undo it.
  const corrupted = (overrides: Partial<Scenario> = {}) =>
    makeValidScenario({
      currentAge: 60,
      spendingGoals: [
        { id: 'le', type: 'living_expenses', name: 'Living', amount: 60000, startAge: 60, inflationAdjusted: false, amountPeriod: 'monthly' },
      ],
      cashBucketPolicy: { minAmount: 360000, targetAmount: 720000, maxAmount: 1440000, refillTrigger: 'gains_only' },
      ...overrides,
    });

  it('divides the inflated band back by the reconstructed 12× ratio', () => {
    const { scenario, changed } = repairInflatedCashBucketBand(corrupted());
    expect(changed).toBe(true);
    expect(scenario.cashBucketPolicy).toEqual({
      minAmount: 30000,
      targetAmount: 60000,
      maxAmount: 120000,
      refillTrigger: 'gains_only',
    });
  });

  it('produces exactly what the fixed months migration would have written', () => {
    const viaMonths = migrateCashBucketMonthsToAmounts(makeValidScenario({
      currentAge: 60,
      spendingGoals: corrupted().spendingGoals,
      cashBucketPolicy: { minMonths: 6, targetMonths: 12, maxMonths: 24, refillTrigger: 'gains_only' } as never,
    }));
    const viaRepair = repairInflatedCashBucketBand(corrupted());
    expect(viaRepair.scenario.cashBucketPolicy).toEqual(viaMonths.scenario.cashBucketPolicy);
  });

  it('leaves a correctly-migrated band alone (no monthly-period goal)', () => {
    const healthy = corrupted({
      spendingGoals: [
        { id: 'le', type: 'living_expenses', name: 'Living', amount: 60000, startAge: 60, inflationAdjusted: false, amountPeriod: 'annual' },
      ],
    });
    expect(repairInflatedCashBucketBand(healthy).changed).toBe(false);
  });

  it('leaves a plausible hand-entered dollar band alone', () => {
    // Ceiling is under two years of real spending → not the inflation tell.
    const handEntered = corrupted({
      cashBucketPolicy: { minAmount: 30000, targetAmount: 60000, maxAmount: 100000, refillTrigger: 'gains_only' },
    });
    expect(repairInflatedCashBucketBand(handEntered).changed).toBe(false);
  });

  it('leaves a large band alone when it is not an integer number of months', () => {
    // Big, but not `round(months × buggyMonthly)` — so it was typed by a user,
    // not written by the buggy migration.
    const notFingerprinted = corrupted({
      cashBucketPolicy: { minAmount: 355000, targetAmount: 717777, maxAmount: 1400001, refillTrigger: 'gains_only' },
    });
    expect(repairInflatedCashBucketBand(notFingerprinted).changed).toBe(false);
  });

  it('runs exactly once through the pipeline — a v2 record is untouched', () => {
    const first = runMigrationPipeline(corrupted());
    expect(first.cashBucketRepaired).toBe(true);
    expect(first.scenario.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(first.scenario.cashBucketPolicy?.minAmount).toBe(30000);

    // Re-running must not divide again (the registry gates on schemaVersion).
    const second = runMigrationPipeline(first.scenario);
    expect(second.cashBucketRepaired).toBe(false);
    expect(second.scenario.cashBucketPolicy).toEqual(first.scenario.cashBucketPolicy);
  });

  it('reaches MIGRATORS[1] from an unstamped (v0) record, despite no v0 migrator', () => {
    const legacy = corrupted();
    delete legacy.schemaVersion;
    const result = runMigrationPipeline(legacy);
    expect(result.cashBucketRepaired).toBe(true);
    expect(result.scenario.cashBucketPolicy?.minAmount).toBe(30000);
  });

  it('is a no-op for scenarios with no cash bucket policy', () => {
    const none = corrupted({ cashBucketPolicy: undefined });
    expect(repairInflatedCashBucketBand(none).changed).toBe(false);
  });
});
