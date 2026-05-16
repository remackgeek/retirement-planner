import { describe, it, expect } from 'vitest';
import { calculateIRMAA, calculateNIIT } from './IRMAA';

describe('calculateIRMAA', () => {
  it('returns 0 below the first MFJ threshold', () => {
    expect(calculateIRMAA(200_000, 'mfj', 2024, 0.03, 70, 68)).toBe(0);
  });

  it('returns first-tier surcharge per enrollee for MFJ above $206k (2024)', () => {
    // Tier 1: 69.90 + 12.90 = 82.80 / mo = 993.60 / yr. Both spouses ≥ 65.
    const surcharge = calculateIRMAA(220_000, 'mfj', 2024, 0, 70, 70);
    expect(surcharge).toBeCloseTo(993.6 * 2, 1);
  });

  it('only counts spouses who are 65+', () => {
    const surcharge = calculateIRMAA(220_000, 'mfj', 2024, 0, 70, 60);
    expect(surcharge).toBeCloseTo(993.6, 1);
  });

  it('returns 0 when nobody is 65+', () => {
    expect(calculateIRMAA(500_000, 'mfj', 2024, 0, 60, 58)).toBe(0);
  });

  it('inflation-indexes thresholds forward from 2024', () => {
    // At 3% inflation for 2 years, $206k threshold becomes ~$218.5k.
    // MAGI of $215k in 2026 should be below the threshold.
    expect(calculateIRMAA(215_000, 'mfj', 2026, 0.03, 70, 70)).toBe(0);
    // MAGI of $220k in 2026 crosses it.
    expect(calculateIRMAA(220_000, 'mfj', 2026, 0.03, 70, 70)).toBeGreaterThan(0);
  });

  it('returns top-tier surcharge for very high single MAGI', () => {
    // Single top tier (> $500k): (419.30 + 81.00) * 12 = 6003.60.
    const surcharge = calculateIRMAA(600_000, 'single', 2024, 0, 70, null);
    expect(surcharge).toBeCloseTo(6003.6, 1);
  });
});

describe('calculateNIIT', () => {
  it('returns 0 below the MFJ threshold', () => {
    expect(calculateNIIT(240_000, 50_000, 'mfj')).toBe(0);
  });

  it('returns 3.8% × min(investment, MAGI-threshold) above threshold', () => {
    // MFJ: MAGI $300k, investment $20k. Excess = $50k. Min = $20k. NIIT = $760.
    expect(calculateNIIT(300_000, 20_000, 'mfj')).toBeCloseTo(760, 2);
  });

  it('caps NIIT at investment income, not excess', () => {
    // MAGI $400k, investment $10k. Excess = $150k. Min = $10k. NIIT = $380.
    expect(calculateNIIT(400_000, 10_000, 'mfj')).toBeCloseTo(380, 2);
  });

  it('caps NIIT at excess MAGI when investment income exceeds it', () => {
    // MAGI $260k, investment $100k. Excess = $10k. Min = $10k. NIIT = $380.
    expect(calculateNIIT(260_000, 100_000, 'mfj')).toBeCloseTo(380, 2);
  });

  it('single threshold is $200k', () => {
    expect(calculateNIIT(195_000, 30_000, 'single')).toBe(0);
    expect(calculateNIIT(230_000, 30_000, 'single')).toBeCloseTo(0.038 * 30_000, 2);
  });
});
