import { describe, it, expect } from 'vitest';
import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import {
  estimateConversionImpact,
  baselineOrdinaryGross,
  exceedsSpendingHeuristic,
  crossesMultipleBracketsHeuristic,
  exceedsMostOfTradHeuristic,
} from './conversionImpact';
import { runDeterministicProjection } from './SimulationService';

function baseUserData(overrides: Partial<UserData> = {}): UserData {
  return {
    currentAge: 60,
    lifeExpectancy: 90,
    accounts: [
      { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
    ],
    spendingGoals: [],
    incomeEvents: [],
    portfolioAssumptions: {
      stockReturn: 0.07,
      stockStdDev: 0,
      bondReturn: 0.04,
      bondStdDev: 0,
      stockBondCorrelationEnabled: false,
      stockBondCorrelation: 0,
      returnDistribution: 'lognormal',
      degreesOfFreedom: 4,
    },
    referenceYear: 2026,
    inflationRate: 0,
    inflationStdDev: 0,
    simulationSettings: { numSimulations: 100 },
    filingStatus: 'single',
    spouseAge: null,
    stateTimeline: [{ state: 'Florida' }],
    longTermCapGainsRate: 0.15,
    ...overrides,
  };
}

function makeConversion(overrides: Partial<IncomeEvent> = {}): IncomeEvent {
  return {
    id: 'conv-1',
    type: 'roth_conversion',
    name: 'Conversion',
    amount: 50000,
    startAge: 60,
    isOneTime: true,
    taxStatus: 'before_tax',
    colaType: 'fixed',
    ...overrides,
  };
}

describe('estimateConversionImpact', () => {
  it('returns zeros for non-conversion event types', () => {
    const userData = baseUserData();
    const notAConversion: IncomeEvent = {
      ...makeConversion(),
      type: 'pension_income',
    };
    const result = estimateConversionImpact(userData, notAConversion);
    expect(result.firstYearTax).toBe(0);
    expect(result.totalTaxOverConversion).toBe(0);
    expect(result.rmdReductionAtStart).toBe(0);
    expect(result.projectedRothAtEndOfPlan).toBe(0);
    expect(result.netPlanValueImpact).toBe(0);
  });

  it('reflects a near-final conversion in net plan value', () => {
    // Conversion runs in the second-to-last year of the plan. The two-run
    // diff engine must propagate the conversion into the "with" simulation
    // so its effect (tax paid from the portfolio) shows up at end-of-plan.
    // Note: the chart's path is recorded at year-start, so a conversion in
    // the literal terminal year produces a zero path delta — that's an
    // expected property of the deterministic-path measure, not a bug.
    // A Taxable account is required for the conversion to execute fully under
    // the new sourcing rule (conv ordinary tax sources from Taxable + RMD-excess
    // only); without it, the engine would cap the conversion at the zero-tax
    // headroom and the diff vs. baseline would collapse to zero.
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 65,
      filingStatus: 'single',
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable 1', type: 'brokerage', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const conversion = makeConversion({
      amount: 50000,
      startAge: 64,
      isOneTime: true,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.projectedRothAtEndOfPlan).toBeGreaterThan(40000);
    expect(result.projectedRothAtEndOfPlan).toBeLessThan(60000);
    // The conversion costs tax in the year before life expectancy; that
    // cost must register at end-of-plan.
    expect(Math.abs(result.netPlanValueImpact)).toBeGreaterThan(1000);
  });

  it('netPlanValueImpact reflects auto-selected spending policy on both sides of the diff', () => {
    // The engine auto-selects the spending policy independently for the
    // with-conversion and without-conversion projections. The reported
    // netPlanValueImpact is the honest marginal effect of THIS conversion
    // on top of the engine doing its best. Asserts the value is finite
    // and sane for a non-trivial multi-year conversion.
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 80,
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 800000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable 1', type: 'brokerage', balance: 300000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [
        { id: 'le-1', type: 'living_expenses', name: 'Living', amount: 40000, startAge: 60, inflationAdjusted: false, isOneTime: false },
      ],
    });
    const conversion = makeConversion({ amount: 40000, startAge: 60, endAge: 68, isOneTime: false });
    const result = estimateConversionImpact(userData, conversion);
    expect(Number.isFinite(result.netPlanValueImpact)).toBe(true);
    // The load-bearing property: a $1 placeholder conversion must have a
    // near-zero impact. Under the old conversion-presence policy gating, adding
    // ANY conversion flipped the spending order and the "impact" absorbed a
    // ~$514k policy bonus that wasn't the conversion's doing. (A bare
    // isFinite() check — this test's previous only assertion — can't fail
    // on that regression.)
    const placeholder = makeConversion({ amount: 1, startAge: 60, isOneTime: true });
    const placeholderImpact = estimateConversionImpact(userData, placeholder).netPlanValueImpact;
    expect(Math.abs(placeholderImpact)).toBeLessThan(1000);
  });

  it('computes incremental tax for a single-year conversion at age 60, single filer FL', () => {
    const userData = baseUserData();
    const conversion = makeConversion({ amount: 50000 });
    const result = estimateConversionImpact(userData, conversion);
    // Single filer 2026 std deduction ~$15k. $50k gross - $15k = $35k taxable.
    // 10% bracket on first ~$11,925, then 12% on the rest. Total ~$4,000-$5,000.
    expect(result.firstYearTax).toBeGreaterThan(2000);
    expect(result.firstYearTax).toBeLessThan(8000);
    expect(result.totalTaxOverConversion).toBe(result.firstYearTax); // one-time
  });

  it('projects Roth growth to end of plan using blended nominal return', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 70, // 10 years
    });
    const conversion = makeConversion({ amount: 50000 });
    const result = estimateConversionImpact(userData, conversion);
    // Blended return = 0.6*0.07 + 0.4*0.04 = 0.058. Converted at year 0 (age 60),
    // grows to age 70 = 10 years. With inflation 0 in baseUserData, real ==
    // nominal: 50000 * 1.058^10 ≈ 88,000. The real-dollar deflation in HIGH-1
    // is a no-op here because inflationRate is 0; the next test exercises the
    // deflation directly.
    expect(result.projectedRothAtEndOfPlan).toBeGreaterThan(80000);
    expect(result.projectedRothAtEndOfPlan).toBeLessThan(95000);
  });

  it('reports all dollar fields in real (year-0) dollars when inflation > 0', () => {
    // Regression guard for Revision 3 HIGH-1: before the fix, firstYearTax /
    // totalTaxOverConversion / projectedRothAtEndOfPlan / rmdReductionAtStart were
    // nominal per-year values mixed against a real netPlanValueImpact. The fix
    // deflates each to year-0. This test compares two scenarios that differ
    // ONLY in inflation rate (with conversion at year 0, where deflation is a
    // no-op) — `firstYearTax` should be approximately the same in both.
    const zeroInflation = baseUserData({
      currentAge: 60,
      lifeExpectancy: 70,
      inflationRate: 0,
    });
    const threePctInflation = baseUserData({
      currentAge: 60,
      lifeExpectancy: 70,
      inflationRate: 0.03,
    });
    const conversion = makeConversion({ amount: 50000, startAge: 60, isOneTime: true });
    const r0 = estimateConversionImpact(zeroInflation, conversion);
    const r3 = estimateConversionImpact(threePctInflation, conversion);
    // Year-0 tax: both deflators are 1 (year 0). Should be ~equal.
    expect(r3.firstYearTax).toBeCloseTo(r0.firstYearTax, 0);

    // Now make the conversion fire at year 5 (age 65). Two effects compound:
    //  (a) the closed-form tax is computed against year-5 inflation-adjusted
    //      brackets — wider, so the $50K conversion taxes at a lower effective
    //      rate (the nominal tax is smaller under inflation than without it);
    //  (b) the deflation `nominal / 1.03^5 ≈ × 0.863` brings the value back
    //      toward year-0 units.
    // Both effects shrink r3late vs r0late, so we just assert r3late < r0late
    // (i.e., the deflation isn't a no-op). Tight bounds get fragile because
    // bracket inflation interacts with the federal brackets nonlinearly; the
    // direction-only check is what we actually care about: the field is in
    // real dollars, not nominal.
    const lateConversion = makeConversion({ amount: 50000, startAge: 65, isOneTime: true });
    const r0late = estimateConversionImpact(zeroInflation, lateConversion);
    const r3late = estimateConversionImpact(threePctInflation, lateConversion);
    expect(r3late.firstYearTax).toBeLessThan(r0late.firstYearTax);
    expect(r3late.firstYearTax).toBeGreaterThan(0);
  });

  it('sums incremental tax across a multi-year conversion', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 75,
      inflationRate: 0,
    });
    const conversion = makeConversion({
      amount: 30000,
      startAge: 60,
      endAge: 64,
      isOneTime: false,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    // 5 years × same ~$30k conversion × same tax each year → total ≈ 5 × firstYearTax.
    expect(result.totalTaxOverConversion).toBeGreaterThan(result.firstYearTax * 4);
    expect(result.totalTaxOverConversion).toBeLessThan(result.firstYearTax * 5.5);
  });

  it('estimates RMD reduction at the SECURE 2.0 start age when conversion shrinks Traditional balance', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 90,
    });
    // currentAge 60 @ referenceYear 2026 → birth 1966 → RMD start age 75 (SECURE 2.0).
    // Convert $50k/yr for 10 years, ages 60-69.
    const conversion = makeConversion({
      amount: 50000,
      startAge: 60,
      endAge: 69,
      isOneTime: false,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.rmdReductionAtStart).toBeGreaterThan(0);
    // Conversions removed ~$500k in nominal terms from Trad (compounded differences).
    // Divisor at 75 = 24.6, so RMD reduction ≈ $500k/24.6 ≈ $20,000+, compounded even higher.
    expect(result.rmdReductionAtStart).toBeGreaterThan(10000);
  });

  it('returns zero RMD reduction when user is already past RMD age', () => {
    const userData = baseUserData({
      currentAge: 74,
      lifeExpectancy: 90,
    });
    // currentAge 74 @ referenceYear 2026 → birth 1952 → RMD start age 73, already passed.
    const conversion = makeConversion({ startAge: 74 });
    const result = estimateConversionImpact(userData, conversion);
    // yearsFromNowToRmd = 73 - 74 = -1, so the RMD estimator short-circuits to 0.
    expect(result.rmdReductionAtStart).toBe(0);
  });

  it('applies inflation-adjusted COLA to conversion amount', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 70,
      inflationRate: 0.03,
    });
    const colaConv = makeConversion({
      amount: 30000,
      startAge: 60,
      endAge: 64,
      isOneTime: false,
      colaType: 'inflation_adjusted',
    });
    const fixedConv = makeConversion({
      amount: 30000,
      startAge: 60,
      endAge: 64,
      isOneTime: false,
      colaType: 'fixed',
    });
    const colaResult = estimateConversionImpact(userData, colaConv);
    const fixedResult = estimateConversionImpact(userData, fixedConv);
    // COLA conversion amounts are larger in later years → more total tax and more
    // dollars placed into Roth.
    expect(colaResult.totalTaxOverConversion).toBeGreaterThan(fixedResult.totalTaxOverConversion);
    expect(colaResult.projectedRothAtEndOfPlan).toBeGreaterThan(fixedResult.projectedRothAtEndOfPlan);
  });

  it('returns zero netPlanValueImpact when conversion has no amount', () => {
    const userData = baseUserData();
    const conversion = makeConversion({ amount: 0 });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.netPlanValueImpact).toBe(0);
  });

  it('a bad config (post-RMD, high pension, high state tax) yields negative netPlanValueImpact', () => {
    // Converting at age 78 in California on top of a $100k pension means a
    // 24%+ federal bracket plus ~9% state, with very little remaining horizon
    // for Roth growth to recoup the tax bill. The deterministic two-run diff
    // should sign clearly negative.
    const userData = baseUserData({
      currentAge: 78,
      lifeExpectancy: 82,
      filingStatus: 'single',
      stateTimeline: [{ state: 'California' }],
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [
        {
          id: 'pen-1',
          type: 'pension_income',
          name: 'Pension',
          amount: 100000,
          startAge: 60,
          taxStatus: 'before_tax',
          colaType: 'fixed',
        },
      ],
    });
    const conversion = makeConversion({
      amount: 300000,
      startAge: 78,
      endAge: 81,
      isOneTime: false,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.netPlanValueImpact).toBeLessThan(0);
  });

  it('netPlanValueImpact materially shifts when Social Security is added to the scenario', () => {
    const pension = {
      id: 'pen-1',
      type: 'pension_income' as const,
      name: 'Pension',
      amount: 30000,
      startAge: 65,
      taxStatus: 'before_tax' as const,
      colaType: 'fixed' as const,
    };
    const ss = {
      id: 'ss-1',
      type: 'social_security' as const,
      name: 'SS',
      amount: 40000,
      startAge: 65,
      taxStatus: 'before_tax' as const,
      colaType: 'inflation_adjusted' as const,
    };
    const withoutSS = baseUserData({
      currentAge: 65,
      lifeExpectancy: 90,
      filingStatus: 'single',
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 600_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [pension],
    });
    const withSS = baseUserData({
      ...withoutSS,
      incomeEvents: [pension, ss],
    });
    const conversion = makeConversion({
      amount: 30000,
      startAge: 65,
      endAge: 72,
      isOneTime: false,
      colaType: 'fixed',
    });
    const noSSResult = estimateConversionImpact(withoutSS, conversion);
    const withSSResult = estimateConversionImpact(withSS, conversion);
    // The two-run deterministic engine captures SS interactions both ways:
    // provisional-income bumps across the 50%/85% thresholds (more taxable
    // income with conversion), and IRMAA surcharges driven by MAGI lookback.
    // The two scenarios should produce materially different plan-value
    // impacts; direction depends on which effect dominates.
    expect(Math.abs(withSSResult.netPlanValueImpact - noSSResult.netPlanValueImpact))
      .toBeGreaterThan(1000);
    // SS users should see a higher first-year incremental tax (provisional
    // income bump bug fix).
    expect(withSSResult.firstYearTax).toBeGreaterThan(noSSResult.firstYearTax);
  });

  it('edit path: matching-id event in userData is not double-counted', () => {
    // When the user edits an existing conversion, the dialog passes the
    // editEvent.id as the draft's id. estimateConversionImpact must
    // recognize the matching event in userData.incomeEvents and treat the
    // two-run diff as "with this conversion vs without", not "with two
    // copies vs with one copy".
    const conversion = makeConversion({
      id: 'existing-1',
      amount: 40000,
      startAge: 62,
      endAge: 68,
      isOneTime: false,
      colaType: 'fixed',
    });
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 85,
      accounts: [
        { id: 'trad-1', name: 'Traditional', type: 'traditional', balance: 800_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 150_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [
        { id: 'le-1', type: 'living_expenses', name: 'Living', amount: 45000, startAge: 60, inflationAdjusted: true },
      ],
      // Pre-populate with the conversion under its real id — this is the
      // edit-path setup the bug fires on.
      incomeEvents: [conversion],
    });
    const result = estimateConversionImpact(userData, conversion);

    // Direct "with vs without" diff using the same engine.
    const withoutRun = runDeterministicProjection({ ...userData, incomeEvents: [] });
    const withRun = runDeterministicProjection(userData);
    const directDiff = withRun.path[withRun.path.length - 1] - withoutRun.path[withoutRun.path.length - 1];

    // If the bug were present, estimateConversionImpact would compute
    // "double vs single" instead and disagree materially. The fix is
    // load-bearing: results must match the single-vs-zero diff.
    expect(result.netPlanValueImpact).toBeCloseTo(directDiff, 2);
  });

  it('netPlanValueImpact equals direct runDeterministicProjection with-vs-without diff', () => {
    // Load-bearing invariant: the Net impact row in the dialog must equal
    // what the Deterministic chart line shows when the conversion is
    // toggled on vs off. If this drifts, the two-run-diff implementation
    // has regressed.
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 85,
      accounts: [
        { id: 'trad-1', name: 'Traditional', type: 'traditional', balance: 800_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [
        { id: 'le-1', type: 'living_expenses', name: 'Living', amount: 50000, startAge: 60, inflationAdjusted: true },
      ],
    });
    const conversion = makeConversion({
      id: 'conv-x',
      amount: 30000,
      startAge: 62,
      endAge: 70,
      isOneTime: false,
      colaType: 'fixed',
    });
    const withEvents = [...userData.incomeEvents, conversion];
    const withoutRun = runDeterministicProjection(userData);
    const withRun = runDeterministicProjection({ ...userData, incomeEvents: withEvents });
    const directDiff = withRun.path[withRun.path.length - 1] - withoutRun.path[withoutRun.path.length - 1];
    const result = estimateConversionImpact(userData, conversion);
    expect(result.netPlanValueImpact).toBeCloseTo(directDiff, 2);
  });

  it('returns positive netPlanValueImpact for a small bracket-fill conversion with low income', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 95,
      filingStatus: 'single',
      stateTimeline: [{ state: 'Florida' }],
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 800_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
    });
    const conversion = makeConversion({
      amount: 20000,
      startAge: 60,
      endAge: 69,
      isOneTime: false,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.netPlanValueImpact).toBeGreaterThan(0);
  });
});

describe('baselineOrdinaryGross — SS trust-fund haircut', () => {
  // currentAge 60 @ referenceYear 2026, SS starting age 62 (year 2028), no inflation
  // so the $30k benefit is flat. The conversion preview's baseline SS gross must apply
  // the same year/percent haircut as the engine (SimulationService.accumulateIncome).
  const ssEvent: IncomeEvent = {
    id: 'ss-1',
    type: 'social_security',
    name: 'SS',
    amount: 30000,
    startAge: 62,
    taxStatus: 'before_tax',
    colaType: 'fixed',
  };

  it('applies the default 22% haircut from the default 2032 year', () => {
    const userData = baseUserData({ incomeEvents: [ssEvent] });
    expect(baselineOrdinaryGross(userData, 2031, 0).ssGross).toBe(30000);
    // 2032 is DEFAULT_SS_HAIRCUT_YEAR; 30000 * (1 - 0.22) = 23400.
    expect(baselineOrdinaryGross(userData, 2032, 0).ssGross).toBeCloseTo(23400, 5);
  });

  it('honors a custom ssHaircutYear (defers the cut)', () => {
    const userData = baseUserData({
      incomeEvents: [{ ...ssEvent, ssHaircutYear: 2040 }],
    });
    // Default-year haircut would bite at 2032, but the custom 2040 year defers it.
    expect(baselineOrdinaryGross(userData, 2032, 0).ssGross).toBe(30000);
    expect(baselineOrdinaryGross(userData, 2040, 0).ssGross).toBeCloseTo(23400, 5);
  });

  it('honors a custom ssHaircutPercent', () => {
    const userData = baseUserData({
      incomeEvents: [{ ...ssEvent, ssHaircutPercent: 30 }],
    });
    // 30000 * (1 - 0.30) = 21000 from the default 2032 year.
    expect(baselineOrdinaryGross(userData, 2032, 0).ssGross).toBeCloseTo(21000, 5);
  });

  it('skips the haircut when disabled', () => {
    const userData = baseUserData({
      incomeEvents: [{ ...ssEvent, ssHaircutEnabled: false }],
    });
    expect(baselineOrdinaryGross(userData, 2032, 0).ssGross).toBe(30000);
  });
});

describe('warning heuristics', () => {
  it('exceedsSpendingHeuristic fires when conversion >> living expenses and stays silent otherwise', () => {
    const userData = baseUserData({
      spendingGoals: [
        {
          id: 'le-1',
          type: 'living_expenses',
          name: 'Living',
          amount: 40000,
          startAge: 60,
          inflationAdjusted: false,
        },
      ],
    });
    expect(exceedsSpendingHeuristic(userData, makeConversion({ amount: 80000 }))).toBe(true);
    expect(exceedsSpendingHeuristic(userData, makeConversion({ amount: 30000 }))).toBe(false);
  });

  it('exceedsSpendingHeuristic treats a monthly-period goal identically — amount is stored annual', () => {
    // Regression: annualizing again for amountPeriod === 'monthly' (the living-
    // expenses dialog default) overstated livingExpenses 12×, so this warning
    // effectively never fired for monthly-period goals.
    const userData = baseUserData({
      spendingGoals: [
        {
          id: 'le-1',
          type: 'living_expenses',
          name: 'Living',
          amount: 40000,
          startAge: 60,
          inflationAdjusted: false,
          amountPeriod: 'monthly',
        },
      ],
    });
    expect(exceedsSpendingHeuristic(userData, makeConversion({ amount: 80000 }))).toBe(true);
    expect(exceedsSpendingHeuristic(userData, makeConversion({ amount: 30000 }))).toBe(false);
  });

  it('crossesMultipleBracketsHeuristic fires on a 2+ bracket jump', () => {
    // Single filer, no other income → baseline is 0 (bracket 0).
    // $200k conversion lands in 24% bracket (index ~3). Should fire.
    const userData = baseUserData({ filingStatus: 'single' });
    expect(crossesMultipleBracketsHeuristic(userData, makeConversion({ amount: 200000 }))).toBe(true);
    // $20k stays in 10–12% range (index 0–1). Should not fire.
    expect(crossesMultipleBracketsHeuristic(userData, makeConversion({ amount: 20000 }))).toBe(false);
  });

  it('exceedsMostOfTradHeuristic fires when total conversion > 80% of Trad balance', () => {
    const userData = baseUserData(); // trad-1 balance = 500_000
    // 10 years × $50k = $500k > 0.8 × $500k = $400k
    const big = makeConversion({ amount: 50000, startAge: 60, endAge: 69, isOneTime: false });
    expect(exceedsMostOfTradHeuristic(userData, big)).toBe(true);
    // One-time $50k → well under 80%
    const small = makeConversion({ amount: 50000, isOneTime: true });
    expect(exceedsMostOfTradHeuristic(userData, small)).toBe(false);
  });
});
