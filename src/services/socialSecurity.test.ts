import { describe, it, expect } from 'vitest';
import {
  computeFraMonths,
  benefitMultiplier,
  benefitAtAge,
  piaFromBenefit,
  formatFra,
} from './socialSecurity';

describe('computeFraMonths', () => {
  it('returns 66 for 1943–1954', () => {
    expect(computeFraMonths(1943)).toBe(66 * 12);
    expect(computeFraMonths(1954)).toBe(66 * 12);
  });

  it('ramps 2 months/year for 1955–1959', () => {
    expect(computeFraMonths(1955)).toBe(66 * 12 + 2); // 66y2m
    expect(computeFraMonths(1958)).toBe(66 * 12 + 8); // 66y8m
    expect(computeFraMonths(1959)).toBe(66 * 12 + 10); // 66y10m
  });

  it('returns 67 for 1960 and later', () => {
    expect(computeFraMonths(1960)).toBe(67 * 12);
    expect(computeFraMonths(1985)).toBe(67 * 12);
  });
});

describe('benefitMultiplier — actuarial anchors', () => {
  it('FRA 67: 62 → 70%, FRA → 100%, 70 → 124%', () => {
    const fra = 67 * 12;
    expect(benefitMultiplier(62 * 12, fra)).toBeCloseTo(0.7, 6);
    expect(benefitMultiplier(67 * 12, fra)).toBeCloseTo(1.0, 6);
    expect(benefitMultiplier(70 * 12, fra)).toBeCloseTo(1.24, 6);
  });

  it('FRA 66: 62 → 75%, 70 → 132%', () => {
    const fra = 66 * 12;
    expect(benefitMultiplier(62 * 12, fra)).toBeCloseTo(0.75, 6);
    expect(benefitMultiplier(70 * 12, fra)).toBeCloseTo(1.32, 6);
  });

  it('caps delayed credits at age 70', () => {
    const fra = 67 * 12;
    expect(benefitMultiplier(72 * 12, fra)).toBeCloseTo(benefitMultiplier(70 * 12, fra), 6);
  });

  it('monotonically increases with claim age', () => {
    const fra = computeFraMonths(1960);
    for (let age = 62; age < 70; age++) {
      expect(benefitMultiplier((age + 1) * 12, fra)).toBeGreaterThan(benefitMultiplier(age * 12, fra));
    }
  });
});

describe('benefitAtAge / piaFromBenefit round-trip', () => {
  it('benefitAtAge applies the multiplier to PIA', () => {
    const fra = 67 * 12;
    expect(benefitAtAge(30000, fra, 62)).toBeCloseTo(21000, 6); // 0.70 × 30k
    expect(benefitAtAge(30000, fra, 70)).toBeCloseTo(37200, 6); // 1.24 × 30k
  });

  it('piaFromBenefit inverts benefitAtAge for any entered age', () => {
    const fra = computeFraMonths(1958); // 66y8m
    const pia = 28800;
    for (const age of [62, 65, 67, 70]) {
      const benefit = benefitAtAge(pia, fra, age);
      expect(piaFromBenefit(benefit, fra, age * 12)).toBeCloseTo(pia, 4);
    }
  });

  it('FRA benefit equals PIA (multiplier 1)', () => {
    const fra = computeFraMonths(1958);
    expect(piaFromBenefit(28800, fra, fra)).toBeCloseTo(28800, 6);
  });
});

describe('formatFra', () => {
  it('renders whole years without months', () => {
    expect(formatFra(67 * 12)).toBe('67');
  });
  it('renders years + months', () => {
    expect(formatFra(66 * 12 + 8)).toBe('66y 8m');
  });
});
