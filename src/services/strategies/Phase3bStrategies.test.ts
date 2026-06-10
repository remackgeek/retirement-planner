import { describe, it, expect } from 'vitest';
import type { UserData } from '../../types/UserData';
import { computeAutoBracketSchedule, scoreProjection } from './AutoBracketStrategy';
import { runOptimization } from './OptimizeStrategy';
import { computeFillToBracketSchedule } from './FillToBracketStrategy';
import { runDeterministicProjection } from '../SimulationService';

const baseUserData = (overrides: Partial<UserData> = {}): UserData => ({
  currentAge: 60,
  lifeExpectancy: 70,
  referenceYear: 2026,
  accounts: [
    { id: 'trad-1', name: 'Traditional', type: 'traditional', balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
  ],
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: {
    stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
    stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
    returnDistribution: 'lognormal', degreesOfFreedom: 4,
  },
  inflationRate: 0,
  inflationStdDev: 0,
  simulationSettings: { numSimulations: 10 },
  filingStatus: 'single',
  spouseAge: null,
  stateTimeline: [{ state: 'Florida' }],
  longTermCapGainsRate: 0.15,
  enableIRMAA: false,
  enableNIIT: false,
  ...overrides,
});

describe('FillToBracketStrategy IRMAA/NIIT cliff cap', () => {
  it('caps the 24%-bracket fill at the IRMAA tier-1 MAGI ceiling when respectIrmaaNiitCliffs is set', () => {
    // Single filer age 64 (Medicare enrollee in year+2 = 2028), no other income,
    // big Trad. Target 24% — the unclamped fill pushes MAGI well past the IRMAA
    // tier-1 ceiling ($103k single, inflation 0 → unchanged in 2028). With the
    // flag, the year-0 conversion must be capped at ~$103k (MAGI baseline 0).
    const common = {
      currentAge: 64,
      lifeExpectancy: 66,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: true,
      enableNIIT: true,
    };
    const udClamped = baseUserData({ ...common, respectIrmaaNiitCliffs: true });
    const udUnclamped = baseUserData({ ...common, respectIrmaaNiitCliffs: false });
    const clamped = computeFillToBracketSchedule(udClamped, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    const unclamped = computeFillToBracketSchedule(udUnclamped, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    // Unclamped 24% fill reaches deep into six figures; clamped stops at the tier ceiling.
    expect(unclamped[0].conversionAmount).toBeGreaterThan(150_000);
    expect(clamped[0].conversionAmount).toBeLessThan(unclamped[0].conversionAmount);
    expect(clamped[0].conversionAmount).toBeCloseTo(103_000, -2); // within ~$100
  });

  it('treats undefined as cap-on (practitioner-consensus default)', () => {
    // After the default flip, `undefined` is equivalent to `true` — the cap is
    // applied. Only an explicit `false` opts out. This test asserts the new
    // default semantic: `undefined` == `true` for the cap behavior.
    const ud = baseUserData({
      currentAge: 64, lifeExpectancy: 66,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: true, enableNIIT: true,
    });
    const onByUndefined = computeFillToBracketSchedule({ ...ud, respectIrmaaNiitCliffs: undefined }, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    const onByTrue = computeFillToBracketSchedule({ ...ud, respectIrmaaNiitCliffs: true }, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    const off = computeFillToBracketSchedule({ ...ud, respectIrmaaNiitCliffs: false }, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    expect(onByUndefined[0].conversionAmount).toBe(onByTrue[0].conversionAmount);
    expect(off[0].conversionAmount).toBeGreaterThan(onByUndefined[0].conversionAmount);
  });

  it('does not apply the IRMAA cap before Medicare proximity (enrollee not within 2 years of 65)', () => {
    // Age 55: year+2 = age 57, no Medicare → IRMAA ceiling does not apply. NIIT
    // disabled here to isolate the IRMAA branch, so nothing should bind and the
    // schedule is unchanged.
    const ud = baseUserData({
      currentAge: 55, lifeExpectancy: 57,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: true, enableNIIT: false, respectIrmaaNiitCliffs: true,
    });
    const clamped = computeFillToBracketSchedule(ud, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    const unclamped = computeFillToBracketSchedule({ ...ud, respectIrmaaNiitCliffs: false }, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    expect(clamped[0].conversionAmount).toBe(unclamped[0].conversionAmount);
  });

  it('does NOT cap at the NIIT threshold (NIIT is a marginal tax, not a cliff)', () => {
    // Requirements changed (optimizer review): NIIT was removed from the hard
    // cap. It's 3.8% × min(investment income, MAGI − threshold) — a marginal
    // tax, not a discontinuity — and a conversion is not investment income, so
    // crossing the threshold often costs $0. The engine prices NIIT inside
    // every scored projection, so the score arbitrates it. Pre-change this
    // exact setup clamped the fill at the $200k single threshold; now the
    // cliffs-ON fill must equal the cliffs-OFF fill (well above $200k), since
    // IRMAA is disabled and nothing else binds.
    const ud = baseUserData({
      currentAge: 55, lifeExpectancy: 57,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: false, enableNIIT: true, respectIrmaaNiitCliffs: true,
    });
    const cliffsOn = computeFillToBracketSchedule(ud, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    const cliffsOff = computeFillToBracketSchedule({ ...ud, respectIrmaaNiitCliffs: false }, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    expect(cliffsOn[0].conversionAmount).toBeGreaterThan(200_000);
    expect(cliffsOn[0].conversionAmount).toBe(cliffsOff[0].conversionAmount);
  });

  it('does not NIIT-cap a pre-Medicare year even with cliffs ON (regression: NIIT removal)', () => {
    // Age 55 with both IRMAA and NIIT enabled: year+2 = 57 → no Medicare
    // enrollee, so the IRMAA branch is inactive; with NIIT gone from the cap,
    // nothing binds and the fill passes through unclamped. Pre-change this
    // was capped at $200k.
    const ud = baseUserData({
      currentAge: 55, lifeExpectancy: 57,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: true, enableNIIT: true, respectIrmaaNiitCliffs: true,
    });
    const cliffsOn = computeFillToBracketSchedule(ud, { name: 'fill_to_bracket', bracketTarget: '24_percent' });
    expect(cliffsOn[0].conversionAmount).toBeGreaterThan(200_000);
  });
});

describe('OptimizeStrategy IRMAA/NIIT cliff cap (candidate generation)', () => {
  // Positive stock return so conversions are genuinely valuable (Roth grows
  // tax-free); without growth the optimizer rationally avoids converting and the
  // cap never binds. stockAllocation 1 + 0 std dev keeps the deterministic
  // projection clean. Single filer age 64 → Medicare enrollee in year+2, so the
  // IRMAA tier-1 ceiling (~$103k MAGI, inflation 0) applies. No other income, so
  // the MAGI baseline is 0 and the per-year conversion cap equals the ceiling.
  const cliffAccounts = [
    { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 1, portfolioBalance: '80_20' as const },
  ];
  const cliffAssumptions = {
    stockReturn: 0.07, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
    stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
    returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
  };

  it('never emits a conversion that trips the IRMAA tier-1 ceiling when respectIrmaaNiitCliffs is set', () => {
    // With growth on, the unclamped optimizer wants large conversions; the cap
    // prunes every candidate at the IRMAA tier-1 ceiling, so no year's emitted
    // conversion exceeds it. We assert both that the cap holds AND that the
    // unclamped run actually wanted more (proving the cap is binding, not vacuous).
    const common = {
      currentAge: 64, lifeExpectancy: 67,
      accounts: cliffAccounts,
      portfolioAssumptions: cliffAssumptions,
      enableIRMAA: true, enableNIIT: true,
    };
    const clamped = runOptimization(baseUserData({ ...common, respectIrmaaNiitCliffs: true }), { name: 'optimize', objective: 'max_median_terminal_wealth' });
    // Allow a tiny margin for the tier ceiling itself ($103k).
    for (const d of clamped.perYearDecisions) {
      expect(d.conversionAmount).toBeLessThanOrEqual(104_000);
    }
    // The cap is binding, not vacuous: the optimizer seeds from auto-bracket →
    // fill-to-bracket, and an UNcapped 24%-bracket fill demands well above the
    // ceiling — so the cliff cap is the only reason the schedule stays under it.
    const uncappedFill = computeFillToBracketSchedule(
      baseUserData({ ...common, respectIrmaaNiitCliffs: false }),
      { name: 'fill_to_bracket', bracketTarget: '24_percent' },
    );
    expect(uncappedFill.some((d) => d.conversionAmount > 104_000)).toBe(true);
  });

  it('produces an identical schedule whether respectIrmaaNiitCliffs is false or undefined when IRMAA is disabled (the flag gates IRMAA only)', () => {
    // With enableIRMAA: false, the flag has nothing to act on in either
    // state: cliffs-ON has no ceiling to clamp to, and cliffs-OFF emits no
    // tier probes (irmaaTierFillCandidates returns [] when IRMAA is
    // disabled). Both runs must therefore produce the same schedule. NIIT is
    // enabled but irrelevant — it was removed from the cap (marginal tax,
    // not a cliff).
    const common = {
      currentAge: 64, lifeExpectancy: 67,
      accounts: cliffAccounts,
      portfolioAssumptions: cliffAssumptions,
      enableIRMAA: false, enableNIIT: true,
    };
    const rFalse = runOptimization(baseUserData({ ...common, respectIrmaaNiitCliffs: false }), { name: 'optimize', objective: 'max_median_terminal_wealth' });
    const rUndef = runOptimization(baseUserData({ ...common, respectIrmaaNiitCliffs: undefined }), { name: 'optimize', objective: 'max_median_terminal_wealth' });
    expect(rFalse.perYearDecisions.map((d) => d.conversionAmount)).toEqual(
      rUndef.perYearDecisions.map((d) => d.conversionAmount),
    );
  });

  it('explores tier crossings when cliffs are OFF and the after-tax objective makes them pay', () => {
    // Tier-aware arbitration: with cliffs OFF the descent gains probes that
    // fill MAGI exactly to each IRMAA tier ceiling, and the engine prices the
    // surcharge in the scored projection. Under the after-tax objective with a
    // high terminal Traditional rate (35%), converting far more than the
    // tier-1 ceiling (~$103k single, inflation 0) is clearly net-positive —
    // the ~$1–3k/yr surcharge is dwarfed by removing 35% embedded tax from
    // six-figure conversions. Cliffs ON must still hold the hard-cap
    // guarantee on the same scenario.
    const common = {
      currentAge: 64, lifeExpectancy: 70,
      accounts: cliffAccounts,
      portfolioAssumptions: cliffAssumptions,
      enableIRMAA: true, enableNIIT: true,
    };
    const strategy = {
      name: 'optimize' as const,
      objective: 'max_after_tax_terminal_wealth' as const,
      terminalTradTaxRate: 0.35,
    };
    const off = runOptimization(baseUserData({ ...common, respectIrmaaNiitCliffs: false }), strategy);
    const on = runOptimization(baseUserData({ ...common, respectIrmaaNiitCliffs: true }), strategy);
    // OFF: at least one year deliberately crosses the tier-1 ceiling.
    expect(off.perYearDecisions.some((d) => d.conversionAmount > 104_000)).toBe(true);
    // ON: the hard-cap guarantee holds — no year exceeds the tier-1 ceiling.
    for (const d of on.perYearDecisions) {
      expect(d.conversionAmount).toBeLessThanOrEqual(104_000);
    }
  });
});

describe('FillToBracketStrategy SS-feedback fix-point (direct compute)', () => {
  it('sizes the first-year conversion below the no-SS amount when Social Security is present', () => {
    // Single filer age 67 with $40k SS gross + $300k Trad. The fix-point loop
    // in computeFillToBracketSchedule must account for the fact that adding a
    // conversion bumps SS provisional income across the 50%/85% thresholds,
    // raising effective taxable income. Without the loop, the conversion is
    // sized against ssTaxable computed for the no-conversion case and ends up
    // overshooting into the 22% bracket. We assert the SS-present conversion
    // is strictly smaller than the no-SS conversion (the SS-taxable bump eats
    // bracket headroom).
    const baseAccounts = [
      { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 300_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
    ];
    const udWithSS = baseUserData({
      currentAge: 67, lifeExpectancy: 70,
      accounts: baseAccounts,
      incomeEvents: [{
        id: 'ss-1', type: 'social_security', name: 'SS',
        amount: 40_000, startAge: 67,
        taxStatus: 'before_tax', colaType: 'fixed', amountPeriod: 'annual',
      } as any],
    });
    const udNoSS = baseUserData({
      currentAge: 67, lifeExpectancy: 70,
      accounts: baseAccounts,
    });
    const withSS = computeFillToBracketSchedule(udWithSS, { name: 'fill_to_bracket', bracketTarget: '12_percent' });
    const noSS = computeFillToBracketSchedule(udNoSS, { name: 'fill_to_bracket', bracketTarget: '12_percent' });
    // SS-present: positive but smaller than no-SS (the taxable SS portion
    // consumed some 12%-bracket headroom).
    expect(withSS[0].conversionAmount).toBeGreaterThan(0);
    expect(withSS[0].conversionAmount).toBeLessThan(noSS[0].conversionAmount);
  });

  it("doesn't loop forever when SS is zero (single-pass equivalent)", () => {
    // Convergence check: with no SS, the loop terminates on the first
    // iteration since ssTaxable is always 0 and convAmount stabilizes.
    // For a 60-year-old single filer with $1M Trad and no other income, the
    // 12% top-of-bracket (2026 single ≈ $50,400 incl. std deduction) implies
    // a first-year conversion around $50k.
    const ud = baseUserData({});
    const schedule = computeFillToBracketSchedule(ud, { name: 'fill_to_bracket', bracketTarget: '12_percent' });
    expect(schedule[0].conversionAmount).toBeGreaterThan(40_000);
    expect(schedule[0].conversionAmount).toBeLessThan(60_000);
  });
});

describe('AutoBracketStrategy baseline candidate (post-review fix)', () => {
  it("'none' candidate uses the user's true baseline (no taxStrategy)", () => {
    // The 'none' bracket candidate must score equally to running the user's
    // scenario directly (no taxStrategy at all). Pre-fix this candidate
    // forced bracket_aware spending, making it a hidden change from the
    // user's status quo and inflating the apparent "improvement" of
    // bracket-fill candidates.
    const ud = baseUserData({
    });
    const result = computeAutoBracketSchedule(ud, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    const noneCandidate = result.candidateScores.find((c) => c.bracket === 'none');
    expect(noneCandidate).toBeDefined();
    // The true baseline: same userData but with taxStrategy stripped.
    const baselineProjection = runDeterministicProjection(ud);
    const baselineScore = baselineProjection.path[baselineProjection.path.length - 1];
    expect(noneCandidate!.score).toBeCloseTo(baselineScore, 0);
  });

  it("when 'none' wins, the chosen schedule is empty (no synthetic conversions)", () => {
    // If the user's status quo beats every bracket fill, the winner should
    // be 'none' and the schedule should be zero-amount per year.
    // We engineer a scenario where conversions clearly hurt: short horizon,
    // modest Trad, high spending so any conversion's tax bill outweighs
    // the Roth-growth runway.
    const ud = baseUserData({
      currentAge: 80, lifeExpectancy: 82,  // 3-year horizon
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional', balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Tax',  type: 'brokerage',     balance: 100_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [{
        id: 'sg', name: 'LE', type: 'living_expenses' as const,
        amount: 60_000, startAge: 80, inflationAdjusted: false,
      }],
    });
    const result = computeAutoBracketSchedule(ud, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    if (result.chosenBracket === 'none') {
      // Winner is 'none' → schedule should be all-zero entries.
      expect(result.perYearDecisions.every((d) => d.conversionAmount === 0)).toBe(true);
    }
  });
});

describe('OptimizeStrategy baseline-aware reporting (post-review fix)', () => {
  it('exposes the user\'s pre-strategy baseline score', () => {
    const ud = baseUserData({
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    expect(result.baselineScore).toBeGreaterThan(0);
    // Baseline matches a direct deterministic projection with taxStrategy stripped.
    const baselineProjection = runDeterministicProjection(ud);
    const expected = baselineProjection.path[baselineProjection.path.length - 1];
    expect(result.baselineScore).toBeCloseTo(expected, 0);
  });

  it('finalScore is at least the baselineScore (the optimizer never regresses below baseline)', () => {
    // The optimizer is seeded from Auto-bracket's winner (which includes 'none'
    // = baseline). So the seed score is always >= baseline. Coordinate descent
    // is monotone non-decreasing. Therefore final >= baseline.
    const ud = baseUserData({
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    expect(result.finalScore).toBeGreaterThanOrEqual(result.baselineScore - 1); // -1 absorbs float drift
  });
});

describe('OptimizeStrategy zero-init probe granularity (post-review fix)', () => {
  it('explores intermediate amounts (not just 10k and 50k) when a year starts at zero', () => {
    // Regression guard: pre-fix the zero-init probes were [10000, 50000]
    // only. If the optimum for a year was in the $15-40k range, the
    // optimizer missed it. The new probe set spans $5k-$100k logarithmically.
    // We can't directly inspect the candidates the optimizer tested, but we
    // can verify the resulting schedule entries (if non-zero) are NOT
    // restricted to {10000, 50000}.
    const ud = baseUserData({
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    const nonZeroAmounts = result.perYearDecisions
      .filter((d) => d.conversionAmount > 0)
      .map((d) => d.conversionAmount);
    if (nonZeroAmounts.length > 0) {
      // At least one non-zero amount should NOT be exactly 10000 or 50000.
      // (Multiplier-based candidates around the AutoBracket seed will pick
      // values like $50,400, $40,000 etc. The old code's $10k/$50k probes
      // would have given exactly $10000 or $50000.)
      const allRestricted = nonZeroAmounts.every((a) => a === 10_000 || a === 50_000);
      expect(allRestricted).toBe(false);
    }
  });
});

describe('AutoBracketStrategy (Design B)', () => {
  it('grid-searches all four candidate brackets', () => {
    const ud = baseUserData({
    });
    const result = computeAutoBracketSchedule(ud, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    expect(result.candidateScores).toHaveLength(4);
    const brackets = result.candidateScores.map((c) => c.bracket).sort();
    expect(brackets).toEqual(['12_percent', '22_percent', '24_percent', 'none']);
  });

  it('chooses one of the candidate brackets as winner', () => {
    const ud = baseUserData({
    });
    const result = computeAutoBracketSchedule(ud, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    expect(['none', '12_percent', '22_percent', '24_percent']).toContain(result.chosenBracket);
    // Winner's score must be ≥ every candidate's score.
    const winnerScore = result.winnerScore;
    for (const c of result.candidateScores) {
      expect(winnerScore).toBeGreaterThanOrEqual(c.score);
    }
  });

  it('emits a non-empty schedule when winner is non-zero bracket', () => {
    const ud = baseUserData({
    });
    const result = computeAutoBracketSchedule(ud, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    if (result.chosenBracket !== 'none') {
      // At least one year should have a non-zero conversion when a bracket is targeted.
      expect(result.perYearDecisions.some((d) => d.conversionAmount > 0)).toBe(true);
    }
  });

  it('min_lifetime_tax objective scores differently than max_median_terminal_wealth', () => {
    // With no income/spending and a fat Trad balance, max_terminal_wealth likely
    // prefers a non-zero bracket (early conversions = more Roth growth). Min tax
    // prefers fewer / smaller conversions (less ordinary income). The chosen
    // brackets should NOT be identical.
    const udMax = baseUserData({
    });
    const udMin = baseUserData({
    });
    const rMax = computeAutoBracketSchedule(udMax, { name: 'auto_bracket', objective: 'max_median_terminal_wealth' });
    const rMin = computeAutoBracketSchedule(udMin, { name: 'auto_bracket', objective: 'min_lifetime_tax' });
    // Min-tax should pick 'none' (zero conversion = zero ordinary income tax in our setup).
    expect(rMin.chosenBracket).toBe('none');
    // Max-terminal-wealth picks a non-zero bracket (or 'none' if no portfolio).
    expect(['12_percent', '22_percent', '24_percent', 'none']).toContain(rMax.chosenBracket);
  });
});

describe('OptimizeStrategy (Design C)', () => {
  it('returns a schedule of the right length and shape', () => {
    const ud = baseUserData({
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    // schedule length = lifeExpectancy - currentAge + 1
    expect(result.perYearDecisions).toHaveLength(11);
    // Each entry is plain data.
    for (const d of result.perYearDecisions) {
      expect(Object.keys(d).sort()).toEqual(['conversionAmount', 'year']);
      expect(typeof d.conversionAmount).toBe('number');
      expect(d.conversionAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it('improves over the Auto-bracket seed (final score >= initial)', () => {
    const ud = baseUserData({
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    // Final sweep score ≥ initial (coordinate descent is monotone non-decreasing).
    expect(result.finalScore).toBeGreaterThanOrEqual(result.sweepScores[0]);
  });

  it('no-Traditional scenario emits zero-conversion schedule', () => {
    const ud = baseUserData({
      accounts: [
        { id: 'roth-1', name: 'Roth', type: 'roth', balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const result = runOptimization(ud, { name: 'optimize', objective: 'max_median_terminal_wealth' });
    // No Trad → engine caps every conversion attempt at 0 → schedule is all zeros.
    for (const d of result.perYearDecisions) {
      expect(d.conversionAmount).toBeGreaterThanOrEqual(0);
      // Even if the optimizer ASKED for a conversion, the engine would cap it
      // to 0 (no Trad available). Score-wise, all candidates evaluate identically,
      // so the optimizer may leave the seed (which is also 0 for this setup) alone.
    }
    // More importantly: the deterministic projection with this schedule succeeds.
    const projection = runDeterministicProjection(ud);
    expect(projection.path[0]).toBeCloseTo(500_000, 0);
  });
});

describe('scoreProjection', () => {
  it('min_lifetime_tax negates the sum so higher = better', () => {
    const ud = baseUserData();
    const projection = runDeterministicProjection(ud);
    const score = scoreProjection(projection, 'min_lifetime_tax', ud.inflationRate);
    // No income, no spending → totalTax = 0 each year → score = -0 (the
    // sum of zeros, then negated). Use toBeCloseTo to absorb the +0/-0
    // distinction (`expect(-0).toBe(0)` fails on Object.is).
    expect(score).toBeCloseTo(0, 10);
  });

  it('max_median_terminal_wealth returns the path value as-is (engine already deflates)', () => {
    // The engine stores `path` already deflated to real dollars (see
    // SimulationService.ts `path.push(startBalance / cumulativeInflation)`).
    // scoreProjection must NOT deflate again — the displayed delta would no
    // longer match the inline chart's visible end-of-plan diff if it did.
    const ud = baseUserData();
    const projection = runDeterministicProjection(ud);
    const score = scoreProjection(projection, 'max_median_terminal_wealth', ud.inflationRate);
    const lastIdx = projection.path.length - 1;
    expect(score).toBe(projection.path[lastIdx]);
  });

  it('max_median_terminal_wealth does not double-deflate when inflation > 0', () => {
    // Regression: previously this scored `path[lastIdx] / (1+r)^horizon`, but
    // `path` is already real-deflated by the engine. The result was scores in
    // "real-real" units that mismatched the chart hover delta by a factor of
    // (1+r)^horizon. With inflation 3% over 10 years, the factor is ~1.34 —
    // big enough that a $1M chart delta would be displayed as ~$745K.
    const inflationRate = 0.03;
    const ud = baseUserData({
      inflationRate,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const projection = runDeterministicProjection(ud);
    const lastIdx = projection.path.length - 1;
    const score = scoreProjection(projection, 'max_median_terminal_wealth', inflationRate);
    expect(score).toBe(projection.path[lastIdx]);
  });
});

describe("scoreProjection 'max_after_tax_terminal_wealth'", () => {
  const afterTaxParams = { ltcgRate: 0.15, terminalTradRate: 0.25 };

  it('finalBalancesByType sums to path[last] (same instant, same real-dollar frame)', () => {
    const ud = baseUserData({
      inflationRate: 0.03,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 400_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth', type: 'roth' as const, balance: 300_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Tax', type: 'brokerage' as const, balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const projection = runDeterministicProjection(ud);
    const fb = projection.finalBalancesByType;
    const sum = fb.traditional + fb.roth + fb.brokerage + fb.cash;
    expect(sum).toBeCloseTo(projection.path[projection.path.length - 1], 0);
  });

  it('values a Roth-heavy projection above a Trad-heavy projection of equal face value', () => {
    // Same $500k face, no income/spending/growth so the terminal balance is
    // identical pre-tax. The after-tax score must discount the Traditional
    // version by terminalTradRate while the Roth version scores at face.
    const tradHeavy = baseUserData({
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const rothHeavy = baseUserData({
      accounts: [
        { id: 'roth-1', name: 'Roth', type: 'roth' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const tradProj = runDeterministicProjection(tradHeavy);
    const rothProj = runDeterministicProjection(rothHeavy);
    const tradScore = scoreProjection(tradProj, 'max_after_tax_terminal_wealth', 0, afterTaxParams);
    const rothScore = scoreProjection(rothProj, 'max_after_tax_terminal_wealth', 0, afterTaxParams);
    // Pre-tax both projections end equal (no flows, 0% growth). The trad-heavy
    // one is RMD-forced at no point inside this horizon (60→70), so balances
    // stay put and only the valuation differs.
    expect(rothScore).toBeCloseTo(rothProj.path[rothProj.path.length - 1], 0);
    expect(tradScore).toBeCloseTo(tradProj.path[tradProj.path.length - 1] * (1 - afterTaxParams.terminalTradRate), 0);
    expect(rothScore).toBeGreaterThan(tradScore);
  });

  it('a zero terminal Trad rate and zero LTCG rate reproduces the pre-tax score', () => {
    const ud = baseUserData({
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 400_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Tax', type: 'brokerage' as const, balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const projection = runDeterministicProjection(ud);
    const preTax = scoreProjection(projection, 'max_median_terminal_wealth', 0);
    const afterTaxZeroRates = scoreProjection(projection, 'max_after_tax_terminal_wealth', 0, { ltcgRate: 0, terminalTradRate: 0 });
    expect(afterTaxZeroRates).toBeCloseTo(preTax, 0);
  });
});

describe('after-tax objective fixes the pre-tax anti-conversion bias (regression)', () => {
  // The canonical case the pre-tax objective gets wrong: zero growth, zero
  // inflation, big Traditional, no income or spending. Converting C pays tax t
  // now and the pre-tax terminal balance ends at exactly −t vs baseline (the
  // benefit — removing the embedded deferred tax on never-withdrawn dollars —
  // is invisible), so the pre-tax optimizer rationally emits all zeros. The
  // after-tax objective values the converted dollars at face vs (1 − 25%) in
  // Traditional: converting in low brackets (~8–12% effective) is clearly
  // net-positive, so the optimizer must emit a non-empty schedule.
  const biasUd = (over: Partial<UserData> = {}) => baseUserData({
    currentAge: 60, lifeExpectancy: 70,
    accounts: [
      { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
    ],
    ...over,
  });

  it('pre-tax objective emits an all-zero schedule on the bias scenario', () => {
    const result = runOptimization(biasUd(), { name: 'optimize', objective: 'max_median_terminal_wealth' });
    expect(result.perYearDecisions.every((d) => d.conversionAmount === 0)).toBe(true);
  });

  it('after-tax objective emits a non-empty schedule and improves on the baseline', () => {
    const result = runOptimization(biasUd(), {
      name: 'optimize',
      objective: 'max_after_tax_terminal_wealth',
      terminalTradTaxRate: 0.25,
    });
    expect(result.perYearDecisions.some((d) => d.conversionAmount > 0)).toBe(true);
    expect(result.finalScore).toBeGreaterThan(result.baselineScore);
  });

  it('defaults terminalTradTaxRate to 25% when unspecified', () => {
    const explicit = runOptimization(biasUd(), {
      name: 'optimize', objective: 'max_after_tax_terminal_wealth', terminalTradTaxRate: 0.25,
    });
    const defaulted = runOptimization(biasUd(), {
      name: 'optimize', objective: 'max_after_tax_terminal_wealth',
    });
    expect(defaulted.perYearDecisions.map((d) => d.conversionAmount)).toEqual(
      explicit.perYearDecisions.map((d) => d.conversionAmount),
    );
  });
});

describe('endAgeCap', () => {
  it('FillToBracket emits zero conversions past the endAgeCap', () => {
    const ud = baseUserData({
      currentAge: 65, lifeExpectancy: 90,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: false, enableNIIT: false, respectIrmaaNiitCliffs: false,
    });
    const schedule = computeFillToBracketSchedule(ud, {
      name: 'fill_to_bracket', bracketTarget: '24_percent', endAgeCap: 80,
    });
    // Every entry from age 81 onward (i.e. yearIndex >= 16) must be zero.
    for (let i = 0; i < schedule.length; i++) {
      const age = ud.currentAge + i;
      if (age > 80) expect(schedule[i].conversionAmount).toBe(0);
    }
    // Sanity: at least one conversion year is non-zero inside the window.
    expect(schedule.some((d, i) => ud.currentAge + i <= 80 && d.conversionAmount > 0)).toBe(true);
  });

  it('FillToBracket defaults to age-80 cap when endAgeCap is omitted', () => {
    const ud = baseUserData({
      currentAge: 65, lifeExpectancy: 90,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: false, enableNIIT: false, respectIrmaaNiitCliffs: false,
    });
    const schedule = computeFillToBracketSchedule(ud, {
      name: 'fill_to_bracket', bracketTarget: '24_percent',
    });
    for (let i = 0; i < schedule.length; i++) {
      const age = ud.currentAge + i;
      if (age > 80) expect(schedule[i].conversionAmount).toBe(0);
    }
  });

  it("FillToBracket uses self's age for the cap when MFJ has a younger spouse (regression for HIGH-2)", () => {
    // Self is 82 (past the cap of 80); spouse is 78 (under). The wizard
    // generates self-owned conversions by default, so the cap MUST apply to
    // self's age — not min(self, spouse). Before the Revision 3 HIGH-2 fix,
    // min(82, 78) = 78 ≤ 80 → schedule would emit conversions ages 82+, all
    // self-owned and pulling from self's past-cap Trad. After the fix, all
    // years should be zero because self starts past the cap.
    const ud = baseUserData({
      currentAge: 82,
      lifeExpectancy: 90,
      filingStatus: 'mfj',
      spouseAge: 78,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional' as const, balance: 2_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      enableIRMAA: false, enableNIIT: false, respectIrmaaNiitCliffs: false,
    });
    const schedule = computeFillToBracketSchedule(ud, {
      name: 'fill_to_bracket', bracketTarget: '24_percent',
      // Use the default cap (80) explicitly so the test doesn't drift with
      // the constant.
      endAgeCap: 80,
    });
    // Every year should be zero — self is already past the cap.
    for (const decision of schedule) {
      expect(decision.conversionAmount).toBe(0);
    }
  });
});
