import { describe, it, expect } from 'vitest';
import type { AnnualCashFlowBreakdown } from '../services/SimulationService';
import {
  alignCompareResults,
  compareIndexFor,
  compareYearOffset,
  realDollarRebaseFactor,
} from './compareAlignment';

describe('compareYearOffset', () => {
  it('is positive when the compared plan is older, negative when newer', () => {
    expect(compareYearOffset({ referenceYear: 2026 }, { referenceYear: 2025 })).toBe(1);
    expect(compareYearOffset({ referenceYear: 2025 }, { referenceYear: 2026 })).toBe(-1);
    expect(compareYearOffset({ referenceYear: 2026 }, { referenceYear: 2026 })).toBe(0);
  });

  it('falls back to 0 on non-finite years', () => {
    expect(compareYearOffset({ referenceYear: NaN }, { referenceYear: 2026 })).toBe(0);
  });
});

describe('compareIndexFor', () => {
  it('maps the active index onto the compared index for the same calendar year (older compared plan)', () => {
    // Active = 2026 plan (30 pts), compared = 2025 plan (31 pts). offset = +1.
    const offset = compareYearOffset({ referenceYear: 2026 }, { referenceYear: 2025 });
    expect(compareIndexFor(0, offset, 31)).toBe(1);
    expect(compareIndexFor(29, offset, 31)).toBe(30);
    expect(compareIndexFor(30, offset, 31)).toBeNull();
  });

  it('yields a gap before the compared projection starts (active is the older plan)', () => {
    const offset = compareYearOffset({ referenceYear: 2025 }, { referenceYear: 2026 });
    expect(offset).toBe(-1);
    expect(compareIndexFor(0, offset, 30)).toBeNull();
    expect(compareIndexFor(1, offset, 30)).toBe(0);
  });

  it('is the identity when the reference years match', () => {
    for (let i = 0; i < 5; i++) expect(compareIndexFor(i, 0, 5)).toBe(i);
    expect(compareIndexFor(5, 0, 5)).toBeNull();
  });
});

describe('realDollarRebaseFactor', () => {
  // Cumulative inflation arrays as simulateOneRun produces them (index 0 = 1).
  const cmp = [1, 1.03, 1.0609, 1.092727];
  const act = [1, 1.05, 1.1025];

  it('is 1 for a zero offset', () => {
    expect(realDollarRebaseFactor(0, cmp, act)).toBe(1);
  });

  it('uses the compared run\'s own cumulative inflation when the compared plan is older', () => {
    expect(realDollarRebaseFactor(1, cmp, act)).toBeCloseTo(1.03, 12);
    expect(realDollarRebaseFactor(2, cmp, act)).toBeCloseTo(1.0609, 12);
  });

  it('uses the active run\'s cumulative inflation, inverted, when the compared plan is newer', () => {
    expect(realDollarRebaseFactor(-1, cmp, act)).toBeCloseTo(1 / 1.05, 12);
    expect(realDollarRebaseFactor(-2, cmp, act)).toBeCloseTo(1 / 1.1025, 12);
  });

  it('is 1 when the needed index is missing or degenerate', () => {
    expect(realDollarRebaseFactor(5, cmp, act)).toBe(1);
    expect(realDollarRebaseFactor(-5, cmp, act)).toBe(1);
    expect(realDollarRebaseFactor(1, [1, 0], act)).toBe(1);
  });
});

describe('alignCompareResults', () => {
  const bd = (tag: number) => ({ totalTax: tag } as unknown as AnnualCashFlowBreakdown);

  it('re-indexes an older compared plan into the active frame with a trailing gap', () => {
    // Compared = 2025 plan (4 pts), active = 2026 plan (4 pts) → offset +1.
    const compared = {
      path: [100, 110, 120, 130],            // real, in 2025 dollars
      inflation: [1, 1.02, 1.0404, 1.0612],  // cumulative from 2025
      breakdowns: [bd(0), bd(1), bd(2), bd(3)],
    };
    const a = alignCompareResults(compared, 1, 4, [1, 1.03, 1.0609, 1.0927]);
    expect(a.rebase).toBeCloseTo(1.02, 12);
    // Active col 0 (2026) ↔ compared idx 1, restated in 2026 dollars.
    expect(a.path[0]).toBeCloseTo(110 * 1.02, 9);
    expect(a.path[2]).toBeCloseTo(130 * 1.02, 9);
    expect(a.path[3]).toBeNull();
    expect(a.breakdowns[0]).toBe(compared.breakdowns[1]);
    expect(a.breakdowns[3]).toBeNull();
    // Deflating the compared nominal with the aligned deflator lands in active
    // year-0 dollars: nominal[ci] / inflation[i] === real[ci] × rebase.
    const nominal1 = compared.path[1] * compared.inflation[1];
    expect(nominal1 / a.inflation[0]).toBeCloseTo(a.path[0]!, 9);
    expect(a.inflation[3]).toBe(1);
  });

  it('leaves a leading gap when the compared plan is newer', () => {
    const compared = { path: [200, 210], inflation: [1, 1.01], breakdowns: [bd(0), bd(1)] };
    const a = alignCompareResults(compared, -1, 3, [1, 1.04, 1.0816]);
    expect(a.rebase).toBeCloseTo(1 / 1.04, 12);
    expect(a.path[0]).toBeNull();
    expect(a.path[1]).toBeCloseTo(200 / 1.04, 9);
    expect(a.path[2]).toBeCloseTo(210 / 1.04, 9);
  });

  it('is the identity (no rebase, no gaps) when offsets match', () => {
    const compared = { path: [1, 2, 3], inflation: [1, 1.1, 1.21], breakdowns: [bd(0), bd(1), bd(2)] };
    const a = alignCompareResults(compared, 0, 3, [1, 1.2, 1.44]);
    expect(a.rebase).toBe(1);
    expect(a.path).toEqual([1, 2, 3]);
    expect(a.inflation).toEqual([1, 1.1, 1.21]);
    expect(a.breakdowns).toEqual(compared.breakdowns);
  });
});
