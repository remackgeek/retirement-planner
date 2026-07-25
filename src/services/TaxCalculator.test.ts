import { describe, it, expect } from 'vitest';
import {
  calculateSSTaxableAmount,
  calculateSSTaxableAmountDetailed,
  calculateNetFromGross,
  calculateNetFromGrossDetailed,
  getBracketCeilingTaxableIncome,
  computeFederalLTCGTax,
  getLtcgBreakpoints,
  clearTaxCalculationCache,
} from './TaxCalculator';

describe('computeFederalLTCGTax (0/15/20% stacking)', () => {
  it('taxes gains at 0% when they sit entirely below the 0% ceiling', () => {
    // Single 2026 0% ceiling = 49,450. No ordinary income, $40k gain → all 0%.
    expect(computeFederalLTCGTax(0, 40_000, 'single', 2026, 0)).toBe(0);
  });

  it('taxes the portion above the 0% ceiling at 15%', () => {
    // Single 2026: zeroTop 49,450. $30k ordinary + $40k gain → stack 30k..70k.
    // Below 49,450 → 0%: 49,450-30,000 = 19,450 at 0%. Remaining 20,550 at 15%.
    const tax = computeFederalLTCGTax(30_000, 40_000, 'single', 2026, 0);
    expect(tax).toBeCloseTo((70_000 - 49_450) * 0.15, 2);
  });

  it('pushes gains entirely into 15% when ordinary income already exceeds the 0% ceiling', () => {
    // Ordinary taxable 60k > 49,450 ceiling; $20k gain all at 15% (below 15% top).
    expect(computeFederalLTCGTax(60_000, 20_000, 'single', 2026, 0)).toBeCloseTo(20_000 * 0.15, 2);
  });

  it('applies 20% above the 15% ceiling', () => {
    // Single 2026 15% top = 545,500. Ordinary 500k, gain 100k → 45.5k at 15%, 54.5k at 20%.
    const tax = computeFederalLTCGTax(500_000, 100_000, 'single', 2026, 0);
    expect(tax).toBeCloseTo((545_500 - 500_000) * 0.15 + (600_000 - 545_500) * 0.20, 2);
  });

  it('returns 0 for non-positive gains', () => {
    expect(computeFederalLTCGTax(100_000, 0, 'single', 2026, 0)).toBe(0);
    expect(computeFederalLTCGTax(100_000, -5_000, 'single', 2026, 0)).toBe(0);
  });

  it('inflation-indexes the breakpoints forward from 2026', () => {
    const bp2026 = getLtcgBreakpoints('single', 2026, 0.03);
    const bp2030 = getLtcgBreakpoints('single', 2030, 0.03);
    expect(bp2030.zeroTop).toBeCloseTo(bp2026.zeroTop * Math.pow(1.03, 4), 2);
  });
});

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

  describe('MFS (85% with provisional-income cap — IRS Pub 915, thresholds $0)', () => {
    // MFS living with spouse: taxable = min(0.85 × ssGross, 0.85 × provisionalIncome),
    // where provisionalIncome = otherGross + 0.5 × ssGross. The old code returned a
    // flat 0.85 × ssGross, over-taxing low-other-income MFS filers.

    it('caps at 85% of provisional income when other income is zero', () => {
      // PI = 0 + 0.5 × 20,000 = 10,000 → min(17,000, 8,500) = 8,500
      expect(calculateSSTaxableAmount(20000, 0, 'mfs')).toBe(8500);
    });

    it('caps at 85% of provisional income with small other income', () => {
      // PI = 2,000 + 0.5 × 10,000 = 7,000 → min(8,500, 5,950) = 5,950
      expect(calculateSSTaxableAmount(10000, 2000, 'mfs')).toBeCloseTo(5950, 8);
    });

    it('returns 85% of SS gross with high other income (cap not binding)', () => {
      // PI = 100,000 + 15,000 = 115,000 → min(25,500, 97,750) = 25,500
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

  it('MFS provisional-income cap binds in the detailed variant too', () => {
    // PI = 0 + 0.5 × 20,000 = 10,000 → taxable = min(17,000, 8,500) = 8,500
    const d = calculateSSTaxableAmountDetailed(20000, 0, 'mfs');
    expect(d.zone).toBe('mfs-flat');
    expect(d.provisionalIncome).toBe(10000);
    expect(d.taxable).toBe(8500);
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

describe('MFS (married-filing-separately) tables', () => {
  // MFS is a married status: by statute its thresholds are HALF the MFJ figures,
  // and its age-65 senior add-on is the MARRIED amount (not the single amount).
  // These guard the two data-entry bugs where MFS had been copied from single.

  describe('age-65 senior add-on uses the married amount', () => {
    it('2026 MFS senior add-on is 1650 (married), not 2050 (single)', () => {
      const d = calculateNetFromGrossDetailed(50000, 'mfs', 67, 2026, null, 0);
      expect(d.numQualifyingSeniors).toBe(1);
      expect(d.seniorAddOn).toBe(1650);
    });
    it('2025 MFS senior add-on is 1600 (married), not 2000 (single)', () => {
      const d = calculateNetFromGrossDetailed(50000, 'mfs', 67, 2025, null, 0);
      expect(d.seniorAddOn).toBe(1600);
    });
    it('2024 MFS senior add-on is 1550 (married), not 1950 (single)', () => {
      const d = calculateNetFromGrossDetailed(50000, 'mfs', 67, 2024, null, 0);
      expect(d.seniorAddOn).toBe(1550);
    });
  });

  describe('35% bracket top is half the MFJ top', () => {
    // 2026: MFJ 35% top 768,700 → MFS 384,350. Std ded 16,100, age 50 (no senior).
    it('2026 MFS taxable just above 384,350 is in the 37% bracket', () => {
      const above = calculateNetFromGrossDetailed(384350 + 16100 + 1000, 'mfs', 50, 2026, null, 0);
      expect(above.taxableIncome).toBe(385350);
      expect(above.federalBracketIndex).toBe(6);
      expect(above.federalMarginalRate).toBe(0.37);

      const below = calculateNetFromGrossDetailed(384350 + 16100 - 1000, 'mfs', 50, 2026, null, 0);
      expect(below.taxableIncome).toBe(383350);
      expect(below.federalBracketIndex).toBe(5);
      expect(below.federalMarginalRate).toBe(0.35);
    });

    // 2025: MFJ 35% top 751,600 → MFS 375,800. Std ded 15,750, age 50.
    it('2025 MFS taxable just above 375,800 is in the 37% bracket', () => {
      const above = calculateNetFromGrossDetailed(375800 + 15750 + 1000, 'mfs', 50, 2025, null, 0);
      expect(above.taxableIncome).toBe(376800);
      expect(above.federalMarginalRate).toBe(0.37);

      const below = calculateNetFromGrossDetailed(375800 + 15750 - 1000, 'mfs', 50, 2025, null, 0);
      expect(below.taxableIncome).toBe(374800);
      expect(below.federalMarginalRate).toBe(0.35);
    });
  });
});

describe('getBracketCeilingTaxableIncome', () => {
  it('returns the top of the 12% bracket for single 2026', () => {
    // 2026 single brackets: 10% to 12400, 12% to 50400
    expect(getBracketCeilingTaxableIncome('single', 1, 2026, 0)).toBe(50400);
  });

  it('returns the top of the 12% bracket for MFJ 2026', () => {
    // 2026 MFJ brackets: 10% to 24800, 12% to 100800
    expect(getBracketCeilingTaxableIncome('mfj', 1, 2026, 0)).toBe(100800);
  });

  it('returns the top of the 10% bracket (index 0)', () => {
    expect(getBracketCeilingTaxableIncome('single', 0, 2026, 0)).toBe(12400);
  });

  it('returns Infinity for the top (37%) bracket', () => {
    // index 6 = 37% bracket, upper bound Infinity in source data
    expect(getBracketCeilingTaxableIncome('single', 6, 2026, 0)).toBe(Infinity);
  });

  it('returns 0 for negative bracket index', () => {
    expect(getBracketCeilingTaxableIncome('single', -1, 2026, 0)).toBe(0);
  });

  it('returns 0 for out-of-range bracket index', () => {
    expect(getBracketCeilingTaxableIncome('single', 99, 2026, 0)).toBe(0);
  });

  it('inflation-indexes bracket ceilings forward of the source year', () => {
    // 2030 with 3% inflation: 4 years forward from the 2026 source.
    // 2026 single 12% ceiling = 50400 → 50400 * 1.03^4 ≈ 56,727.
    const expected = 50400 * Math.pow(1.03, 2030 - 2026);
    expect(getBracketCeilingTaxableIncome('single', 1, 2030, 0.03)).toBeCloseTo(expected, 2);
  });

  it('does not extrapolate behind the source year', () => {
    // Inflation factor stays at 1.0 for years <= the latest source year.
    expect(getBracketCeilingTaxableIncome('single', 1, 2026, 0.03)).toBe(50400);
  });
});

describe('memo cache — cents-quantized key + size cap', () => {
  it('float-noise-different gross values share one entry with sub-cent result error', () => {
    clearTaxCalculationCache();
    const base = calculateNetFromGross(123_456.78, 'single', 60, 2026, null, 0);
    // Same dollar amount modulo float noise → same key → identical cached result.
    const noisy = calculateNetFromGross(123_456.78 + 1e-9, 'single', 60, 2026, null, 0);
    expect(noisy).toBe(base);
    // Behavior safety of key-sharing: a genuinely different amount inside the
    // same cent bucket returns a result within $0.01 of its true value.
    clearTaxCalculationCache();
    const trueValue = calculateNetFromGross(123_456.784, 'single', 60, 2026, null, 0);
    clearTaxCalculationCache();
    calculateNetFromGross(123_456.78, 'single', 60, 2026, null, 0); // seed the cent bucket
    const bucketShared = calculateNetFromGross(123_456.784, 'single', 60, 2026, null, 0);
    expect(Math.abs(bucketShared - trueValue)).toBeLessThan(0.01);
    clearTaxCalculationCache();
  });

  it('the cache never grows past the cap and stays correct after eviction', () => {
    clearTaxCalculationCache();
    // Seed more distinct keys than the 50k cap (distinct whole-dollar gross values).
    for (let i = 0; i < 50_001; i++) {
      calculateNetFromGross(10_000 + i, 'single', 60, 2026, null, 0);
    }
    // Post-eviction calls still return correct values (compare vs a fresh cache).
    const afterEviction = calculateNetFromGross(42_000, 'single', 60, 2026, null, 0);
    clearTaxCalculationCache();
    const fresh = calculateNetFromGross(42_000, 'single', 60, 2026, null, 0);
    expect(afterEviction).toBe(fresh);
    clearTaxCalculationCache();
  });
});
