import { describe, it, expect } from 'vitest';
import { calculateSSTaxableAmount } from './TaxCalculator';

describe('calculateSSTaxableAmount', () => {
  describe('edge cases', () => {
    it('returns 0 when SS gross is 0', () => {
      expect(calculateSSTaxableAmount(0, 50000, 'single')).toBe(0);
    });

    it('returns 0 when SS gross is negative', () => {
      expect(calculateSSTaxableAmount(-1000, 50000, 'single')).toBe(0);
    });
  });

  describe('single filer thresholds ($25k / $34k)', () => {
    it('returns 0 when provisional income is below $25k', () => {
      // PI = 0 + 0.5 * 24000 = 12000 < 25000
      expect(calculateSSTaxableAmount(24000, 0, 'single')).toBe(0);
    });

    it('returns 0 at exactly the $25k threshold', () => {
      // PI = 20000 + 0.5 * 10000 = 25000 = threshold
      expect(calculateSSTaxableAmount(10000, 20000, 'single')).toBe(0);
    });

    it('applies 50% rate between $25k and $34k', () => {
      // PI = 20000 + 0.5 * 20000 = 30000, in 50% zone
      // taxable = min(0.5 * (30000 - 25000), 0.5 * 20000) = min(2500, 10000) = 2500
      expect(calculateSSTaxableAmount(20000, 20000, 'single')).toBe(2500);
    });

    it('caps 50% zone at 50% of SS benefits', () => {
      // PI = 30000 + 0.5 * 4000 = 32000, in 50% zone
      // taxable = min(0.5 * (32000 - 25000), 0.5 * 4000) = min(3500, 2000) = 2000
      expect(calculateSSTaxableAmount(4000, 30000, 'single')).toBe(2000);
    });

    it('applies 85% rate above $34k', () => {
      // PI = 30000 + 0.5 * 24000 = 42000, above 34000
      // taxable = min(0.85 * (42000 - 34000) + 4500, 0.85 * 24000)
      //         = min(6800 + 4500, 20400) = min(11300, 20400) = 11300
      expect(calculateSSTaxableAmount(24000, 30000, 'single')).toBe(11300);
    });

    it('caps 85% zone at 85% of SS benefits', () => {
      // PI = 200000 + 0.5 * 20000 = 210000, well above 34000
      // adjustedBase = min(4500, 0.5 * 20000) = 4500
      // taxable = min(0.85 * (210000 - 34000) + 4500, 0.85 * 20000)
      //         = min(154100, 17000) = 17000
      expect(calculateSSTaxableAmount(20000, 200000, 'single')).toBe(17000);
    });

    it('adjusts base when SS is small (base capped at 0.5 * ssGross)', () => {
      // PI = 31000 + 0.5 * 8000 = 35000, above 34000 → 85% zone
      // adjustedBase = min(4500, 0.5 * 8000) = min(4500, 4000) = 4000
      // taxable = min(0.85 * (35000 - 34000) + 4000, 0.85 * 8000)
      //         = min(850 + 4000, 6800) = min(4850, 6800) = 4850
      expect(calculateSSTaxableAmount(8000, 31000, 'single')).toBe(4850);
    });
  });

  describe('MFJ thresholds ($32k / $44k)', () => {
    it('returns 0 when provisional income is below $32k', () => {
      // PI = 10000 + 0.5 * 30000 = 25000 < 32000
      expect(calculateSSTaxableAmount(30000, 10000, 'mfj')).toBe(0);
    });

    it('applies 50% rate between $32k and $44k', () => {
      // PI = 20000 + 0.5 * 30000 = 35000, in 50% zone
      // taxable = min(0.5 * (35000 - 32000), 0.5 * 30000) = min(1500, 15000) = 1500
      expect(calculateSSTaxableAmount(30000, 20000, 'mfj')).toBe(1500);
    });

    it('applies 85% rate above $44k with base amount $6000', () => {
      // PI = 50000 + 0.5 * 30000 = 65000, above 44000
      // taxable = min(0.85 * (65000 - 44000) + 6000, 0.85 * 30000)
      //         = min(17850 + 6000, 25500) = min(23850, 25500) = 23850
      expect(calculateSSTaxableAmount(30000, 50000, 'mfj')).toBe(23850);
    });
  });

  describe('HoH (same thresholds as single)', () => {
    it('applies 50% rate between $25k and $34k', () => {
      // PI = 20000 + 0.5 * 20000 = 30000
      // taxable = min(0.5 * (30000 - 25000), 0.5 * 20000) = 2500
      expect(calculateSSTaxableAmount(20000, 20000, 'hoh')).toBe(2500);
    });
  });

  describe('MFS (always 85% taxable)', () => {
    it('returns 85% of SS regardless of income level', () => {
      expect(calculateSSTaxableAmount(20000, 0, 'mfs')).toBe(17000);
    });

    it('returns 85% even with zero other income', () => {
      expect(calculateSSTaxableAmount(10000, 0, 'mfs')).toBe(8500);
    });

    it('returns 85% with high other income', () => {
      expect(calculateSSTaxableAmount(30000, 100000, 'mfs')).toBe(25500);
    });
  });
});
