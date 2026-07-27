import { describe, it, expect } from 'vitest';
import {
  calculateIRMAA,
  calculateIRMAADetailed,
  calculateNIIT,
  calculateNIITDetailed,
  nextIrmaaTierCeiling,
  getNiitThreshold,
} from './IRMAA';

describe('nextIrmaaTierCeiling', () => {
  it('returns the first-tier ceiling for a single filer below it (2024 base)', () => {
    expect(nextIrmaaTierCeiling(50_000, 'single', 2024, 0)).toBe(103_000);
  });

  it('returns the tier the baseline already sits in (stay-in-current-tier semantics)', () => {
    // $120k is in the single tier-2 band ($103k–$129k) → ceiling 129,000.
    expect(nextIrmaaTierCeiling(120_000, 'single', 2024, 0)).toBe(129_000);
  });

  it('uses MFJ thresholds for MFJ filers', () => {
    expect(nextIrmaaTierCeiling(150_000, 'mfj', 2024, 0)).toBe(206_000);
  });

  it('inflation-indexes the ceiling forward from 2024', () => {
    expect(nextIrmaaTierCeiling(50_000, 'single', 2026, 0.03)).toBeCloseTo(103_000 * Math.pow(1.03, 2), 2);
  });

  it('returns Infinity when the baseline is in the top (uncapped) tier', () => {
    expect(nextIrmaaTierCeiling(2_000_000, 'single', 2024, 0)).toBe(Infinity);
  });
});

describe('getNiitThreshold', () => {
  it('returns the statutory thresholds by filing status (not inflation-indexed)', () => {
    expect(getNiitThreshold('single')).toBe(200_000);
    expect(getNiitThreshold('hoh')).toBe(200_000);
    expect(getNiitThreshold('mfj')).toBe(250_000);
    expect(getNiitThreshold('mfs')).toBe(125_000);
  });
});

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

describe('MFS IRMAA — statutory 3-row table (no graduated middle tiers)', () => {
  // Regression: MFS previously aliased the single 6-tier table. The real 2024
  // MFS structure: ≤ $103k → none; > $103k and < $397k → the second-highest
  // surcharge level (Part B total $559.00 → +$384.30 over the $174.70 standard;
  // Part D +$74.20); ≥ $397k → top tier (Part B $594.00 → +$419.30; Part D +$81.00).

  it('MFS at $100k MAGI pays no surcharge', () => {
    expect(calculateIRMAA(100_000, 'mfs', 2024, 0, 70, null)).toBe(0);
  });

  it('MFS at $150k MAGI lands in the $559-level tier, not the single table tier', () => {
    // (384.30 + 74.20) × 12 = $5,502.00/yr. The old single-table alias would
    // have put $150k in the (174.70 + 33.30) tier → $2,496/yr.
    expect(calculateIRMAA(150_000, 'mfs', 2024, 0, 70, null)).toBeCloseTo(5502.0, 1);
  });

  it('MFS at $400k MAGI pays the top tier', () => {
    // (419.30 + 81.00) × 12 = $6,003.60/yr.
    expect(calculateIRMAA(400_000, 'mfs', 2024, 0, 70, null)).toBeCloseTo(6003.6, 1);
  });

  it('MFS at EXACTLY $397,000 pays the top tier (statute: "$397,000 or above")', () => {
    // Boundary asymmetry: SSA words the middle MFS row as "less than $397,000",
    // unlike every single/MFJ row (which are "$X or less"). Treating this bound
    // as inclusive undercharged the knife-edge dollar by ~$502/yr — and the
    // dollar is reachable, since the cliff cap fills MAGI right to the ceiling.
    expect(calculateIRMAA(397_000, 'mfs', 2024, 0, 70, null)).toBeCloseTo(6003.6, 1);
    expect(calculateIRMAADetailed(397_000, 'mfs', 2024, 0, 70, null).tierIndex).toBe(2);
    // A cent below stays in the middle tier.
    expect(calculateIRMAA(396_999.99, 'mfs', 2024, 0, 70, null)).toBeCloseTo(5502.0, 1);
  });

  it('single/MFJ bounds stay INCLUSIVE — exactly at the bound is the lower tier', () => {
    expect(calculateIRMAA(103_000, 'single', 2024, 0, 70, null)).toBe(0);
    expect(calculateIRMAA(206_000, 'mfj', 2024, 0, 70, 70)).toBe(0);
  });

  it('calculateIRMAADetailed reports tier indices 0/1/2 across the 3-row table', () => {
    expect(calculateIRMAADetailed(100_000, 'mfs', 2024, 0, 70, null).tierIndex).toBe(0);
    expect(calculateIRMAADetailed(150_000, 'mfs', 2024, 0, 70, null).tierIndex).toBe(1);
    expect(calculateIRMAADetailed(400_000, 'mfs', 2024, 0, 70, null).tierIndex).toBe(2);
  });

  it('nextIrmaaTierCeiling for MFS uses the 3-row boundaries', () => {
    expect(nextIrmaaTierCeiling(100_000, 'mfs', 2024, 0)).toBe(103_000);
    // Exclusive bound → the safe fill target is a cent under $397,000, so a
    // conversion capped at this figure stays out of the top tier.
    expect(nextIrmaaTierCeiling(150_000, 'mfs', 2024, 0)).toBe(396_999.99);
    expect(calculateIRMAA(nextIrmaaTierCeiling(150_000, 'mfs', 2024, 0), 'mfs', 2024, 0, 70, null))
      .toBeCloseTo(5502.0, 1);
    expect(nextIrmaaTierCeiling(500_000, 'mfs', 2024, 0)).toBe(Infinity);
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

describe('calculateIRMAADetailed', () => {
  it('returns tier 0 with zero surcharge when below first MFJ threshold', () => {
    const d = calculateIRMAADetailed(200_000, 'mfj', 2024, 0, 70, 68);
    expect(d.tierIndex).toBe(0);
    expect(d.annualSurcharge).toBe(0);
    expect(d.enrolleeCount).toBe(2);
    expect(d.monthlySurcharge).toBe(0);
  });

  it('reports correct tier index for each MFJ tier crossing', () => {
    // 2024 MFJ tiers: 206k / 258k / 322k / 386k / 750k / ∞
    expect(calculateIRMAADetailed(207_000, 'mfj', 2024, 0, 70, 70).tierIndex).toBe(1);
    expect(calculateIRMAADetailed(260_000, 'mfj', 2024, 0, 70, 70).tierIndex).toBe(2);
    expect(calculateIRMAADetailed(330_000, 'mfj', 2024, 0, 70, 70).tierIndex).toBe(3);
    expect(calculateIRMAADetailed(400_000, 'mfj', 2024, 0, 70, 70).tierIndex).toBe(4);
    expect(calculateIRMAADetailed(800_000, 'mfj', 2024, 0, 70, 70).tierIndex).toBe(5);
  });

  it('per-enrollee monthly × 12 × enrollee count = annual surcharge', () => {
    const d = calculateIRMAADetailed(260_000, 'mfj', 2024, 0, 70, 70);
    expect(d.enrolleeCount).toBe(2);
    expect(d.perEnrolleeAnnual).toBeCloseTo(d.monthlySurcharge * 12, 4);
    expect(d.annualSurcharge).toBeCloseTo(d.perEnrolleeAnnual * d.enrolleeCount, 4);
  });

  it('inflates the tier upper bound forward from 2024', () => {
    // 206k × 1.03² ≈ 218,545. Same $215k MAGI: in tier 1 in 2024, in tier 0 in 2026.
    const d2024 = calculateIRMAADetailed(215_000, 'mfj', 2024, 0.03, 70, 70);
    const d2026 = calculateIRMAADetailed(215_000, 'mfj', 2026, 0.03, 70, 70);
    expect(d2024.tierIndex).toBe(1);
    expect(d2026.tierIndex).toBe(0);
    expect(d2026.tierUpperScaled).toBeCloseTo(206_000 * 1.03 * 1.03, 0);
  });

  it('enrollee count gates on age ≥ 65', () => {
    expect(calculateIRMAADetailed(300_000, 'mfj', 2024, 0, 70, 70).enrolleeCount).toBe(2);
    expect(calculateIRMAADetailed(300_000, 'mfj', 2024, 0, 70, 60).enrolleeCount).toBe(1);
    expect(calculateIRMAADetailed(300_000, 'mfj', 2024, 0, 60, 60).enrolleeCount).toBe(0);
    expect(calculateIRMAADetailed(300_000, 'single', 2024, 0, 64, null).enrolleeCount).toBe(0);
  });

  it('echoes the lookback MAGI for display', () => {
    expect(calculateIRMAADetailed(275_000, 'mfj', 2024, 0, 70, 70).lookbackMagi).toBe(275_000);
  });
});

describe('calculateNIITDetailed', () => {
  it('reports zero excess when MAGI is below the threshold', () => {
    const d = calculateNIITDetailed(195_000, 50_000, 'single');
    expect(d.magiExcess).toBe(0);
    expect(d.taxableBase).toBe(0);
    expect(d.tax).toBe(0);
    expect(d.threshold).toBe(200_000);
  });

  it('uses min(investment, MAGI excess) for the taxable base', () => {
    // Excess $30k, investment $10k → base $10k (investment-limited)
    const d1 = calculateNIITDetailed(230_000, 10_000, 'single');
    expect(d1.magiExcess).toBe(30_000);
    expect(d1.taxableBase).toBe(10_000);
    expect(d1.tax).toBeCloseTo(0.038 * 10_000, 2);

    // Excess $5k, investment $50k → base $5k (excess-limited)
    const d2 = calculateNIITDetailed(205_000, 50_000, 'single');
    expect(d2.magiExcess).toBe(5_000);
    expect(d2.taxableBase).toBe(5_000);
    expect(d2.tax).toBeCloseTo(0.038 * 5_000, 2);
  });

  it('clamps negative investment income to zero', () => {
    const d = calculateNIITDetailed(230_000, -1000, 'single');
    expect(d.investmentIncome).toBe(0);
    expect(d.taxableBase).toBe(0);
    expect(d.tax).toBe(0);
  });

  it('uses correct threshold by filing status', () => {
    expect(calculateNIITDetailed(0, 0, 'single').threshold).toBe(200_000);
    expect(calculateNIITDetailed(0, 0, 'mfj').threshold).toBe(250_000);
    expect(calculateNIITDetailed(0, 0, 'mfs').threshold).toBe(125_000);
    expect(calculateNIITDetailed(0, 0, 'hoh').threshold).toBe(200_000);
  });

  it('rate is 3.8%', () => {
    expect(calculateNIITDetailed(0, 0, 'single').rate).toBe(0.038);
  });
});
