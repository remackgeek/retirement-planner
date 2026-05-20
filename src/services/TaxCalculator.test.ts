import { describe, it, expect } from 'vitest';
import {
  calculateSSTaxableAmount,
  calculateSSTaxableAmountDetailed,
  calculateNetFromGross,
  calculateNetFromGrossDetailed,
} from './TaxCalculator';

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

describe('calculateSSTaxableAmountDetailed', () => {
  it('reports the zone hit and provisional income', () => {
    const d1 = calculateSSTaxableAmountDetailed(24000, 0, 'single');
    expect(d1.zone).toBe('none');
    expect(d1.provisionalIncome).toBe(12000);

    const d2 = calculateSSTaxableAmountDetailed(20000, 20000, 'single');
    expect(d2.zone).toBe('50%');
    expect(d2.taxable).toBe(2500);

    const d3 = calculateSSTaxableAmountDetailed(24000, 30000, 'single');
    expect(d3.zone).toBe('85%');
    expect(d3.threshold2).toBe(34000);

    const d4 = calculateSSTaxableAmountDetailed(20000, 100000, 'mfs');
    expect(d4.zone).toBe('mfs-flat');
    expect(d4.taxable).toBe(17000);

    const d5 = calculateSSTaxableAmountDetailed(0, 50000, 'single');
    expect(d5.zone).toBe('none');
    expect(d5.taxable).toBe(0);
  });
});

describe('calculateNetFromGrossDetailed', () => {
  it('reports bracket-by-bracket allocation matching total federal tax', () => {
    // Single filer, age 50 (no senior add-on), 2026, $100,000 gross.
    // Std deduction 2026 single: $16,100. Taxable: $83,900.
    // Brackets 2026 single: 10% to $12,400; 12% to $50,400; 22% to $105,700; ...
    // Tax: 12,400 * 0.10 = 1,240
    //    + (50,400 - 12,400) * 0.12 = 4,560
    //    + (83,900 - 50,400) * 0.22 = 7,370
    //    = 13,170
    const d = calculateNetFromGrossDetailed(100000, 'single', 50, 2026, null, 0);
    expect(d.standardDeduction).toBe(16100);
    expect(d.totalDeductions).toBe(16100);
    expect(d.taxableIncome).toBe(83900);
    expect(d.federalBracketIndex).toBe(2); // 22% bracket
    expect(d.federalMarginalRate).toBe(0.22);
    expect(Math.round(d.federalTax)).toBe(13170);
    expect(d.federalBrackets.reduce((s, b) => s + b.taxInBracket, 0)).toBeCloseTo(d.federalTax, 2);

    // Per-bracket allocation
    expect(Math.round(d.federalBrackets[0].taxInBracket)).toBe(1240);
    expect(Math.round(d.federalBrackets[1].taxInBracket)).toBe(4560);
    expect(Math.round(d.federalBrackets[2].taxInBracket)).toBe(7370);
    expect(d.federalBrackets[3].taxInBracket).toBe(0);
  });

  it('matches calculateNetFromGross for the same inputs (federal-only)', () => {
    const detailed = calculateNetFromGrossDetailed(75000, 'mfj', 65, 2026, 65, 0);
    const plain = calculateNetFromGross(75000, 'mfj', 65, 2026, 65, 0);
    expect(detailed.federalNet).toBeCloseTo(plain, 2);
  });

  it('captures senior add-on for age >= 65', () => {
    const d = calculateNetFromGrossDetailed(50000, 'single', 67, 2026, null, 0);
    // 2026 single age-65+ extra: $2,050 per qualifying senior; OBBB also applies through 2028.
    expect(d.numQualifyingSeniors).toBe(1);
    expect(d.seniorAddOn).toBe(2050);
  });
});
