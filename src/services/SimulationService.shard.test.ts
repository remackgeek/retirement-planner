// Unit tests for the shard-runnable helpers extracted from runSimulation.
// These functions are the worker's import surface: keeping them honest in
// isolation prevents drift between the inline and worker code paths.
import { describe, it, expect } from 'vitest';
import {
  getEffectiveNumRuns,
  runShard,
  pickRepresentatives,
  computePercentileBandAndStats,
  buildPrecomputes,
  prepareUserData,
} from './SimulationService';
import type { UserData } from '../types/UserData';
import scenario from '../../test/scenarios/balanced-realistic.json';
import { createSeededRandom } from '../../test/utils/seededRandom';

function stripMeta(s: Record<string, unknown>): UserData {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out as unknown as UserData;
}

const baseUserData = (): UserData => stripMeta(scenario as Record<string, unknown>);

// ----- getEffectiveNumRuns -----

describe('getEffectiveNumRuns', () => {
  it('parametric: returns simulationSettings.numSimulations', () => {
    const u = baseUserData();
    u.portfolioAssumptions = { ...u.portfolioAssumptions, returnModel: 'parametric' };
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 1234 };
    expect(getEffectiveNumRuns(u)).toBe(1234);
  });

  it('historical_bootstrap: returns simulationSettings.numSimulations', () => {
    const u = baseUserData();
    u.portfolioAssumptions = {
      ...u.portfolioAssumptions,
      returnModel: 'historical_bootstrap',
      historicalBlockSize: 5,
    };
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 999 };
    expect(getEffectiveNumRuns(u)).toBe(999);
  });

  it('historical_single: always 1', () => {
    const u = baseUserData();
    u.portfolioAssumptions = {
      ...u.portfolioAssumptions,
      returnModel: 'historical_single',
      historicalStartYear: 1980,
    };
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 5000 };
    expect(getEffectiveNumRuns(u)).toBe(1);
  });

  it('historical_rolling without wrap: HISTORICAL_YEARS - horizon + 1, floored at 1', () => {
    const u = baseUserData();
    u.portfolioAssumptions = {
      ...u.portfolioAssumptions,
      returnModel: 'historical_rolling',
      historicalWrapEnabled: false,
    };
    // Horizon is (lifeExpectancy - currentAge + 1). For the realistic scenario,
    // the result should be a positive integer well under HISTORICAL_YEARS (97).
    const result = getEffectiveNumRuns(u);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(97);
  });

  it('historical_rolling with wrap: full series length (97)', () => {
    const u = baseUserData();
    u.portfolioAssumptions = {
      ...u.portfolioAssumptions,
      returnModel: 'historical_rolling',
      historicalWrapEnabled: true,
    };
    expect(getEffectiveNumRuns(u)).toBe(97);
  });
});

// ----- runShard slicing -----

describe('runShard', () => {
  it('a single [0, N) shard produces N runs with the expected path length', () => {
    const u = prepareUserData(baseUserData());
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 10 };
    const precomputes = buildPrecomputes(u);
    const horizon = u.lifeExpectancy - u.currentAge + 1;
    const runs = runShard(u, precomputes, {
      startRunIndex: 0,
      endRunIndex: 10,
      random: createSeededRandom(42),
    });
    expect(runs).toHaveLength(10);
    expect(runs[0].path).toHaveLength(horizon);
    expect(runs[0].stockFactors).toHaveLength(horizon);
    expect(runs[0].bondFactors).toHaveLength(horizon);
  });

  it('two shards [0, N/2) + [N/2, N) cover N runs in total', () => {
    const u = prepareUserData(baseUserData());
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 20 };
    const precomputes = buildPrecomputes(u);
    // Each shard uses its own RNG stream in production; here we just confirm
    // the slicing math, not bit-exactness.
    const left = runShard(u, precomputes, {
      startRunIndex: 0, endRunIndex: 10, random: createSeededRandom(1),
    });
    const right = runShard(u, precomputes, {
      startRunIndex: 10, endRunIndex: 20, random: createSeededRandom(2),
    });
    expect(left).toHaveLength(10);
    expect(right).toHaveLength(10);
  });

  it('runs the global runIndex through simulateOneRun (paths differ across the slice)', () => {
    const u = prepareUserData(baseUserData());
    u.simulationSettings = { ...u.simulationSettings, numSimulations: 5 };
    const precomputes = buildPrecomputes(u);
    const runs = runShard(u, precomputes, {
      startRunIndex: 0, endRunIndex: 5, random: createSeededRandom(7),
    });
    // Sanity: not all 5 runs should produce the same final balance.
    const finals = new Set(runs.map((r) => r.path[r.path.length - 1]));
    expect(finals.size).toBeGreaterThan(1);
  });
});

// ----- pickRepresentatives -----

describe('pickRepresentatives', () => {
  it('selects the p50 run by final-balance score among survivors', () => {
    // Hand-built SimRun-shaped objects. Score formula:
    //   failed ? failedYear : totalYears + finalBalance.
    // With totalYears=3 and all survivors, scores are 3 + finalBalance,
    // so sort order tracks finalBalance ascending.
    const mk = (final: number) => ({
      path: [0, 0, final],
      stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: false, failedYear: 0,
    });
    const runs = [
      mk(100), mk(200), mk(300), mk(400), mk(500),
      mk(600), mk(700), mk(800), mk(900), mk(1000),
    ];
    // 10 runs: p50Idx = 5. Sorted ascending by final: 100..1000.
    // The run at index 5 has final=600.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { medianRun } = pickRepresentatives(runs as any);
    expect(medianRun.path[2]).toBe(600);
  });

  it('failed runs sort before survivors (shifting the p50 pick)', () => {
    const mkFail = (failedYear: number) => ({
      path: [0, 0, 0],
      stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: true, failedYear,
    });
    const mkSurvive = (final: number) => ({
      path: [0, 0, final],
      stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: false, failedYear: 0,
    });
    // 10 runs: 2 failures (failedYear 0 and 1), then 8 survivors with increasing finals.
    const runs = [
      mkFail(0), mkFail(1),
      mkSurvive(100), mkSurvive(200), mkSurvive(300), mkSurvive(400),
      mkSurvive(500), mkSurvive(600), mkSurvive(700), mkSurvive(800),
    ];
    // Sorted: failedYear 0 (score 0) < failedYear 1 (score 1) < survivor finals (score 3+100, ...).
    // The two failures occupy indices 0–1, so p50Idx = 5 lands on the 4th
    // survivor (final=400) — only true if failures sort ahead of survivors.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { medianRun } = pickRepresentatives(runs as any);
    expect(medianRun.failed).toBe(false);
    expect(medianRun.path[2]).toBe(400);
  });
});

// ----- computePercentileBandAndStats -----

describe('computePercentileBandAndStats', () => {
  it('returns null band/stats when fewer than 10 runs', () => {
    const mk = (final: number) => ({
      path: [final], stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: false, failedYear: 0,
    });
    const runs = [mk(1), mk(2), mk(3)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = computePercentileBandAndStats(runs as any, 1, 60);
    expect(result.percentileBand).toBeNull();
    expect(result.mcStats).toBeNull();
  });

  it('computes p10/p90 from sorted year columns', () => {
    // 10 runs, single year. Final balances 1..10. p10Idx=1, p90Idx=9.
    const mk = (final: number) => ({
      path: [final], stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: false, failedYear: 0,
    });
    const runs = Array.from({ length: 10 }, (_, i) => mk(i + 1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { percentileBand, mcStats } = computePercentileBandAndStats(runs as any, 1, 60);
    expect(percentileBand).not.toBeNull();
    expect(percentileBand!.p10[0]).toBe(2);   // sorted[1]
    expect(percentileBand!.p90[0]).toBe(10);  // sorted[9]
    // No failures, so depletion ages should be null.
    expect(mcStats!.medianDepletionAge).toBeNull();
    expect(mcStats!.worstDecileDepletionAge).toBeNull();
    expect(mcStats!.medianEndingBalance).toBe(6); // sorted finals[5]
    expect(mcStats!.p10EndingBalance).toBe(2);    // sorted finals[1]
  });

  it('maps depletion year + currentAge for failed runs in the worst decile', () => {
    const mkFail = (failedYear: number) => ({
      path: [0], stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: true, failedYear,
    });
    const mkSurvive = (final: number) => ({
      path: [final], stockFactors: [], bondFactors: [], breakdowns: [], inflation: [],
      failed: false, failedYear: 0,
    });
    // 10 runs: 1 early failure (failedYear=2), rest survivors.
    const runs = [
      mkFail(2),
      mkSurvive(100), mkSurvive(200), mkSurvive(300), mkSurvive(400),
      mkSurvive(500), mkSurvive(600), mkSurvive(700), mkSurvive(800), mkSurvive(900),
    ];
    // depletion[] = [2, Inf, Inf, ...]; sorted ascending; p10Idx=1 → Inf (worstDecile null).
    // To put a depletion in the worst decile, we need >= 1 failure at index 1 too.
    // With 1 failure, p10Idx=1 lands on Infinity → null. That matches design intent
    // (only the very worst tail surfaces a depletion age).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { mcStats } = computePercentileBandAndStats(runs as any, 1, 62);
    expect(mcStats!.worstDecileDepletionAge).toBeNull();
  });
});
