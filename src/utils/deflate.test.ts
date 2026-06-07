import { describe, it, expect } from 'vitest';
import { deflateToYearZero } from './deflate';

describe('deflateToYearZero', () => {
  it('is identity at yearIndex 0', () => {
    expect(deflateToYearZero(1000, 0, 0.03)).toBe(1000);
  });

  it('is identity at inflationRate 0 for any yearIndex', () => {
    expect(deflateToYearZero(1000, 10, 0)).toBe(1000);
    expect(deflateToYearZero(1000, 50, 0)).toBe(1000);
  });

  it('divides by (1 + r)^yearIndex', () => {
    // 3% inflation × 10 years: 1.03^10 ≈ 1.34392. $1000 / 1.34392 ≈ $744.09.
    expect(deflateToYearZero(1000, 10, 0.03)).toBeCloseTo(1000 / Math.pow(1.03, 10), 6);
  });

  it('handles negative yearIndex by inflating (mathematically consistent)', () => {
    // Not the typical use case, but the formula extrapolates: year -1 with 3%
    // inflation means "1 year before the reference year", so the year-0 value
    // is 1.03× higher. This guards against an accidental sign flip.
    expect(deflateToYearZero(1000, -1, 0.03)).toBeCloseTo(1030, 6);
  });

  it('round-trips with re-inflation', () => {
    const nominal = 5000;
    const yearIdx = 7;
    const rate = 0.025;
    const real = deflateToYearZero(nominal, yearIdx, rate);
    const reInflated = real * Math.pow(1 + rate, yearIdx);
    expect(reInflated).toBeCloseTo(nominal, 6);
  });
});
