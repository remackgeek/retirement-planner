import { describe, it, expect } from 'vitest';
import { createReturnGenerator, createNominalGenerator } from './ReturnGenerator';
import type { UserData } from '../types/UserData';
import type { ReturnModel } from '../types/IncomeEvent';
import {
  HISTORICAL_RETURNS,
  HISTORICAL_FIRST_YEAR,
} from '../data/historicalReturns';
import { createSeededRandom } from '../../test/utils/seededRandom';

function makeUserData(overrides: Partial<UserData['portfolioAssumptions']>, opts?: {
  currentAge?: number;
  lifeExpectancy?: number;
  numSimulations?: number;
}): UserData {
  return {
    currentAge: opts?.currentAge ?? 60,
    lifeExpectancy: opts?.lifeExpectancy ?? 69,
    accounts: [],
    spendingGoals: [],
    incomeEvents: [],
    referenceYear: 2026,
    inflationRate: 0,
    inflationStdDev: 0,
    simulationSettings: { numSimulations: opts?.numSimulations ?? 100 },
    filingStatus: 'single',
    spouseAge: null,
    stateTimeline: [{ state: 'Florida' }],
    longTermCapGainsRate: 0.15,
    portfolioAssumptions: {
      stockReturn: 0.07,
      stockStdDev: 0.15,
      bondReturn: 0.03,
      bondStdDev: 0.05,
      stockBondCorrelationEnabled: false,
      stockBondCorrelation: 0,
      returnDistribution: 'lognormal',
      degreesOfFreedom: 4,
      ...overrides,
    },
  };
}

describe('createReturnGenerator', () => {
  it('defaults to parametric when returnModel is unset', () => {
    const ud = makeUserData({});
    const gen = createReturnGenerator(ud);
    expect(gen.getNumRuns()).toBe(100);
  });

  it('historical_single returns one run', () => {
    const ud = makeUserData({
      returnModel: 'historical_single',
      historicalStartYear: 1966,
    });
    const gen = createReturnGenerator(ud);
    expect(gen.getNumRuns()).toBe(1);
    // Year 0 = 1966 historical row
    const expected = HISTORICAL_RETURNS[1966 - HISTORICAL_FIRST_YEAR];
    const factors = gen.drawFactors(0, 0, Math.random);
    expect(factors.stockFactor).toBe(expected.stockFactor);
    expect(factors.bondFactor).toBe(expected.bondFactor);
  });

  it('historical_single throws when historicalStartYear is missing', () => {
    const ud = makeUserData({ returnModel: 'historical_single' });
    expect(() => createReturnGenerator(ud)).toThrow(/historicalStartYear is required/);
  });

  it('historical_rolling without wrap gives one run per valid start year', () => {
    // 10-year horizon over 97 years: 88 valid start years.
    const ud = makeUserData({ returnModel: 'historical_rolling' });
    const gen = createReturnGenerator(ud);
    expect(gen.getNumRuns()).toBe(97 - 10 + 1);
  });

  it('historical_rolling with wrap uses every start year', () => {
    const ud = makeUserData({
      returnModel: 'historical_rolling',
      historicalWrapEnabled: true,
    });
    const gen = createReturnGenerator(ud);
    expect(gen.getNumRuns()).toBe(97);
  });

  describe('historical_bootstrap', () => {
    it('throws when historicalBlockSize is missing', () => {
      const ud = makeUserData({ returnModel: 'historical_bootstrap' });
      expect(() => createReturnGenerator(ud, createSeededRandom(1))).toThrow(
        /historicalBlockSize is required/
      );
    });

    it('throws on invalid block size', () => {
      const ud = makeUserData({
        returnModel: 'historical_bootstrap',
        historicalBlockSize: 4 as unknown as number,
      });
      expect(() => createReturnGenerator(ud, createSeededRandom(1))).toThrow(
        /historicalBlockSize 4 is invalid/
      );
    });

    it('uses simulationSettings.numSimulations as the run count', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 5 },
        { numSimulations: 250 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(1));
      expect(gen.getNumRuns()).toBe(250);
    });

    it('produces deterministic output for a given seed', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 5 },
        { numSimulations: 10 }
      );
      const a = createReturnGenerator(ud, createSeededRandom(42));
      const b = createReturnGenerator(ud, createSeededRandom(42));
      for (let r = 0; r < 10; r++) {
        for (let y = 0; y < 10; y++) {
          const fa = a.drawFactors(r, y, Math.random);
          const fb = b.drawFactors(r, y, Math.random);
          expect(fa.stockFactor).toBe(fb.stockFactor);
          expect(fa.bondFactor).toBe(fb.bondFactor);
        }
      }
    });

    it('different seeds produce different outputs', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 5 },
        { numSimulations: 10 }
      );
      const a = createReturnGenerator(ud, createSeededRandom(1));
      const b = createReturnGenerator(ud, createSeededRandom(2));
      // Compare full first-run sequences; at least one year should differ.
      let anyDifferent = false;
      for (let y = 0; y < 10; y++) {
        const fa = a.drawFactors(0, y, Math.random);
        const fb = b.drawFactors(0, y, Math.random);
        if (fa.stockFactor !== fb.stockFactor) {
          anyDifferent = true;
          break;
        }
      }
      expect(anyDifferent).toBe(true);
    });

    it('preserves block boundaries: consecutive years within a block are consecutive history', () => {
      const blockSize = 5;
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: blockSize },
        { numSimulations: 50, currentAge: 60, lifeExpectancy: 69 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(7));
      // Build a stockFactor → year-index reverse lookup. Some factors collide across
      // years (rare), but for boundary-preservation it's enough to check that within a
      // block the pattern stockFactor[y+1] / stockFactor[y] equals what's in HISTORICAL_RETURNS
      // at adjacent indices.
      const horizon = 10;
      // For each run, the first block fills years [0, blockSize), the second fills
      // years [blockSize, horizon). Within each block the indices should be consecutive.
      for (let r = 0; r < 50; r++) {
        // Find index of year 0 in HISTORICAL_RETURNS by matching stockFactor + bondFactor.
        const f0 = gen.drawFactors(r, 0, Math.random);
        const idx0 = HISTORICAL_RETURNS.findIndex(
          (h) => h.stockFactor === f0.stockFactor && h.bondFactor === f0.bondFactor
        );
        expect(idx0).toBeGreaterThanOrEqual(0);
        // Years 1..blockSize-1 should be at idx0+1, idx0+2, ...
        for (let y = 1; y < blockSize && y < horizon; y++) {
          const f = gen.drawFactors(r, y, Math.random);
          const expected = HISTORICAL_RETURNS[idx0 + y];
          expect(f.stockFactor).toBe(expected.stockFactor);
          expect(f.bondFactor).toBe(expected.bondFactor);
        }
      }
    });

    it('blockSize=1 reduces to iid year resampling: every year drawn independently', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 1 },
        { numSimulations: 100 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(99));
      // Confirm each draw resolves to some valid historical row.
      for (let r = 0; r < 100; r++) {
        for (let y = 0; y < 10; y++) {
          const f = gen.drawFactors(r, y, Math.random);
          const idx = HISTORICAL_RETURNS.findIndex(
            (h) => h.stockFactor === f.stockFactor && h.bondFactor === f.bondFactor
          );
          expect(idx).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('bootstrap inflation reads CPI from the same row as the return draw', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 3 },
        { numSimulations: 20 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(123));
      for (let r = 0; r < 20; r++) {
        for (let y = 0; y < 10; y++) {
          const f = gen.drawFactors(r, y, Math.random);
          const inflation = gen.drawInflation(r, y, Math.random);
          const idx = HISTORICAL_RETURNS.findIndex(
            (h) =>
              h.stockFactor === f.stockFactor &&
              h.bondFactor === f.bondFactor &&
              Math.abs(h.inflationFactor - 1 - inflation) < 1e-9
          );
          expect(idx).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  it('unknown returnModel falls back to parametric', () => {
    const ud = makeUserData({ returnModel: 'unknown_model' as ReturnModel });
    const gen = createReturnGenerator(ud);
    expect(gen.getNumRuns()).toBe(100);
  });

  describe('historical_bootstrap edge cases', () => {
    it('truncates the final block to fit the horizon', () => {
      // Horizon 5, blockSize 10: a single 10-year block must be cut to 5.
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 10 },
        { numSimulations: 20, currentAge: 60, lifeExpectancy: 64 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(7));
      const horizon = 5;
      // Each run should produce 5 consecutive historical years from a single block start.
      for (let r = 0; r < 20; r++) {
        const f0 = gen.drawFactors(r, 0, Math.random);
        const idx0 = HISTORICAL_RETURNS.findIndex(
          (h) => h.stockFactor === f0.stockFactor && h.bondFactor === f0.bondFactor
        );
        expect(idx0).toBeGreaterThanOrEqual(0);
        // Years 1..4 should be at idx0+1..idx0+4 (consecutive).
        for (let y = 1; y < horizon; y++) {
          const f = gen.drawFactors(r, y, Math.random);
          expect(f.stockFactor).toBe(HISTORICAL_RETURNS[idx0 + y].stockFactor);
        }
      }
    });

    it('horizon equals blockSize: exactly one block per run', () => {
      const ud = makeUserData(
        { returnModel: 'historical_bootstrap', historicalBlockSize: 10 },
        { numSimulations: 10, currentAge: 60, lifeExpectancy: 69 }
      );
      const gen = createReturnGenerator(ud, createSeededRandom(11));
      // All 10 years of each run come from one consecutive block.
      for (let r = 0; r < 10; r++) {
        const f0 = gen.drawFactors(r, 0, Math.random);
        const idx0 = HISTORICAL_RETURNS.findIndex(
          (h) => h.stockFactor === f0.stockFactor && h.bondFactor === f0.bondFactor
        );
        for (let y = 1; y < 10; y++) {
          const f = gen.drawFactors(r, y, Math.random);
          expect(f.stockFactor).toBe(HISTORICAL_RETURNS[idx0 + y].stockFactor);
        }
      }
    });
  });
});

describe('createNominalGenerator', () => {
  it('parametric mode uses blended mean returns', () => {
    const ud = makeUserData({});
    const gen = createNominalGenerator(ud);
    expect(gen.getNumRuns()).toBe(1);
    const factors = gen.drawFactors(0, 0, Math.random);
    expect(factors.stockFactor).toBeCloseTo(1.07);
    expect(factors.bondFactor).toBeCloseTo(1.03);
    expect(gen.drawInflation(0, 0, Math.random)).toBe(0);
  });

  it('historical_single delegates to the slice generator (matches the recorded year)', () => {
    const ud = makeUserData({
      returnModel: 'historical_single',
      historicalStartYear: 1966,
    });
    const gen = createNominalGenerator(ud);
    const expected = HISTORICAL_RETURNS[1966 - HISTORICAL_FIRST_YEAR];
    const factors = gen.drawFactors(0, 0, Math.random);
    expect(factors.stockFactor).toBe(expected.stockFactor);
    expect(factors.bondFactor).toBe(expected.bondFactor);
    // Inflation also from the historical row, not parametric.
    expect(gen.drawInflation(0, 0, Math.random)).toBeCloseTo(expected.inflationFactor - 1);
  });

  it('historical_rolling falls back to parametric mean (line is hidden in UI)', () => {
    const ud = makeUserData({ returnModel: 'historical_rolling' });
    const gen = createNominalGenerator(ud);
    const factors = gen.drawFactors(0, 0, Math.random);
    expect(factors.stockFactor).toBeCloseTo(1.07);
    expect(factors.bondFactor).toBeCloseTo(1.03);
  });

  it('historical_bootstrap falls back to parametric mean (line is hidden in UI)', () => {
    const ud = makeUserData({
      returnModel: 'historical_bootstrap',
      historicalBlockSize: 5,
    });
    const gen = createNominalGenerator(ud);
    const factors = gen.drawFactors(0, 0, Math.random);
    expect(factors.stockFactor).toBeCloseTo(1.07);
    expect(factors.bondFactor).toBeCloseTo(1.03);
  });
});

describe('survivor (widow\'s-penalty) horizon', () => {
  // Regression: the generators sized their horizon self-only
  // (lifeExpectancy − currentAge + 1), but the simulation loop runs to the
  // SURVIVOR's death. The bootstrap indexMap was under-sized: survivor years
  // read the next run's rows and the last run indexed past the typed array
  // (HISTORICAL_RETURNS[undefined] → TypeError).
  const withSurvivor = (pa: Partial<UserData['portfolioAssumptions']>, numSimulations = 10): UserData => ({
    ...makeUserData(pa, { currentAge: 65, lifeExpectancy: 80, numSimulations }),
    filingStatus: 'mfj',
    spouseAge: 60,
    spouseLifeExpectancy: 92, // spouse outlives self: horizon = 92 − 60 + 1 = 33
  });

  it('bootstrap draws stay finite for every run across the full survivor horizon', () => {
    const ud = withSurvivor({ returnModel: 'historical_bootstrap', historicalBlockSize: 5 });
    const gen = createReturnGenerator(ud, createSeededRandom(42));
    const horizon = 92 - 60 + 1;
    for (let run = 0; run < gen.getNumRuns(); run++) {
      for (let y = 0; y < horizon; y++) {
        const f = gen.drawFactors(run, y, Math.random);
        expect(Number.isFinite(f.stockFactor)).toBe(true);
        expect(Number.isFinite(f.bondFactor)).toBe(true);
        expect(Number.isFinite(gen.drawInflation(run, y, Math.random))).toBe(true);
      }
    }
  });

  it('rolling run count uses the survivor horizon, not the self-only horizon', () => {
    const ud = withSurvivor({ returnModel: 'historical_rolling' });
    const gen = createReturnGenerator(ud);
    // 97 − 33 + 1 = 65 valid start years (self-only 16-year horizon would give 82).
    expect(gen.getNumRuns()).toBe(65);
  });
});
