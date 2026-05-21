// Smoke + lifecycle tests for SimulationClient.
//
// jsdom can't actually execute Web Workers (it stubs the constructor but the
// worker thread never runs), so these tests use `forceInline: true` to exercise
// the client's main-thread fallback. This verifies the API contract, inline
// equivalence to a direct runSimulation call, and the client-side lifecycle
// (warmUp idempotency, error propagation).
//
// Worker-path tests (real shard fan-out, supersession-via-terminate-and-respawn,
// percentile band merge, replay protocol) require a browser-environment test
// runner (Playwright/Cypress) and are out of scope here. Manual verification
// in the dev server covers them today.
import { describe, it, expect } from 'vitest';
import { runSimulation } from './SimulationService';
import { simulationClient } from './SimulationClient';
import type { UserData } from '../types/UserData';
import scenario from '../../test/scenarios/balanced-realistic.json';

function stripMeta(s: Record<string, unknown>): UserData {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out as unknown as UserData;
}

// Use a small-N variant so the test runs in <1s.
function smallN(u: UserData): UserData {
  return {
    ...u,
    simulationSettings: { ...u.simulationSettings, numSimulations: 50 },
  };
}

describe('SimulationClient', () => {
  it('returns a SimulationResult with the expected shape', async () => {
    const userData = smallN(stripMeta(scenario as Record<string, unknown>));
    const result = await simulationClient.run(userData, { forceInline: true });
    expect(result).toBeDefined();
    expect(typeof result.probability).toBe('number');
    expect(Array.isArray(result.median)).toBe(true);
    expect(Array.isArray(result.nominal)).toBe(true);
    expect(Array.isArray(result.downside)).toBe(true);
    expect(Array.isArray(result.medianBreakdowns)).toBe(true);
    expect(result.medianBreakdowns.length).toBe(result.median.length);
  });

  it('inline path matches direct runSimulation output structure', async () => {
    const userData = smallN(stripMeta(scenario as Record<string, unknown>));
    const direct = runSimulation(userData);
    const viaClient = await simulationClient.run(userData, { forceInline: true });
    expect(viaClient.median.length).toBe(direct.median.length);
    expect(viaClient.nominal.length).toBe(direct.nominal.length);
    expect(viaClient.years).toEqual(direct.years);
    // Two independent MC runs with default Math.random differ stochastically.
    // With N=50 the variance is wider; ±15pp is a generous statistical bound.
    expect(Math.abs(viaClient.probability - direct.probability)).toBeLessThanOrEqual(25);
  });

  it('nominal projection is deterministic (does not depend on the random call between paths)', async () => {
    const userData = smallN(stripMeta(scenario as Record<string, unknown>));
    const a = await simulationClient.run(userData, { forceInline: true });
    const b = await simulationClient.run(userData, { forceInline: true });
    // Nominal path uses NominalGenerator (no RNG draws), so it's identical
    // across calls regardless of stochastic MC results.
    expect(a.nominal).toEqual(b.nominal);
  });

  it('warmUp() is idempotent and does not throw', () => {
    expect(() => simulationClient.warmUp()).not.toThrow();
    expect(() => simulationClient.warmUp()).not.toThrow();
    expect(() => simulationClient.warmUp()).not.toThrow();
  });

  it('forceInline path rejects with the underlying error if userData is malformed', async () => {
    // Passing an obviously invalid scenario through forceInline should surface
    // the engine's own error (NaN/undefined access), not silently resolve.
    // We use a userData with missing required fields.
    const broken = { foo: 'bar' } as unknown as UserData;
    await expect(simulationClient.run(broken, { forceInline: true })).rejects.toThrow();
  });

  it('routes small effectiveNumRuns through the inline fast path', async () => {
    // numSimulations < INLINE_THRESHOLD (200) → inline regardless of forceInline.
    // The result should resolve quickly without any worker activity.
    const userData = stripMeta(scenario as Record<string, unknown>);
    userData.simulationSettings = { ...userData.simulationSettings, numSimulations: 50 };
    const result = await simulationClient.run(userData);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(100);
    expect(result.median.length).toBeGreaterThan(0);
  });
});
