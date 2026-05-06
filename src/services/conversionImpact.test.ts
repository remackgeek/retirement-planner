import { describe, it, expect } from 'vitest';
import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import {
  estimateConversionImpact,
  exceedsSpendingHeuristic,
  crossesMultipleBracketsHeuristic,
  exceedsMostOfTradHeuristic,
} from './conversionImpact';

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
    expect(result.rmdReductionAt73).toBe(0);
    expect(result.projectedRothAtEndOfPlan).toBe(0);
    expect(result.netPlanValueImpact).toBe(0);
  });

  it('reflects a final-year conversion (endAge = lifeExpectancy) in net plan value', () => {
    // Conversion runs through the user's terminal year. Without the inclusive
    // projection-loop bound, the last-year conversion would count toward
    // projectedRothAtEndOfPlan but be silently dropped from netPlanValueImpact.
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 65,
      filingStatus: 'single',
    });
    const conversion = makeConversion({
      amount: 50000,
      startAge: 65, // = lifeExpectancy, runs only in lastPlanYear
      isOneTime: true,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    // The conversion happens in lastPlanYear with no remaining growth — Roth
    // gain is exactly the converted amount, less tax drag (also 0 growth).
    expect(result.projectedRothAtEndOfPlan).toBeGreaterThan(40000);
    expect(result.projectedRothAtEndOfPlan).toBeLessThan(60000);
    // netPlanValueImpact must reflect the conversion happening at all — i.e.,
    // be materially different from zero (not silently dropped).
    expect(Math.abs(result.netPlanValueImpact)).toBeGreaterThan(1000);
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
    // grows to age 70 = 10 years. 50000 * 1.058^10 ≈ 88,000.
    expect(result.projectedRothAtEndOfPlan).toBeGreaterThan(80000);
    expect(result.projectedRothAtEndOfPlan).toBeLessThan(95000);
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

  it('estimates RMD reduction at age 73 when conversion shrinks Traditional balance', () => {
    const userData = baseUserData({
      currentAge: 60,
      lifeExpectancy: 90,
    });
    // Convert $50k/yr for 10 years, ages 60-69.
    const conversion = makeConversion({
      amount: 50000,
      startAge: 60,
      endAge: 69,
      isOneTime: false,
      colaType: 'fixed',
    });
    const result = estimateConversionImpact(userData, conversion);
    expect(result.rmdReductionAt73).toBeGreaterThan(0);
    // Conversions removed ~$500k in nominal terms from Trad (compounded differences).
    // Divisor at 73 = 26.5, so RMD reduction ≈ $500k/26.5 ≈ $18,000+, compounded even higher.
    expect(result.rmdReductionAt73).toBeGreaterThan(10000);
  });

  it('returns zero RMD reduction when user is already past RMD age', () => {
    const userData = baseUserData({
      currentAge: 74,
      lifeExpectancy: 90,
    });
    const conversion = makeConversion({ startAge: 74 });
    const result = estimateConversionImpact(userData, conversion);
    // yearsFromNowToRmd = 73 - 74 = -1, so the RMD estimator short-circuits to 0.
    expect(result.rmdReductionAt73).toBe(0);
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

  it('reflects tax drag and trad-side opportunity cost (bad config nets far below raw Roth projection)', () => {
    const userData = baseUserData({
      currentAge: 78,
      lifeExpectancy: 82,
      filingStatus: 'single',
      stateTimeline: [{ state: 'California' }],
      accounts: [
        { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
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
    // Net impact should subtract ~50%+ of raw Roth projection due to tax drag
    // and forgone trad growth — this confirms the field is doing real work, not
    // just echoing projectedRothAtEndOfPlan. Absolute sign of net depends on
    // factors this v1 model excludes (IRMAA, SS taxability, ACA).
    expect(result.netPlanValueImpact).toBeLessThan(result.projectedRothAtEndOfPlan * 0.5);
  });

  it('netPlanValueImpact accounts for Social Security in baseline effective rate', () => {
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
    // SS adds taxable provisional income, raising effRate, which raises the
    // tax discount applied to the no-conversion Trad balance and therefore
    // raises (less penalizes) netPlanValueImpact for the SS user.
    expect(withSSResult.netPlanValueImpact).toBeGreaterThan(noSSResult.netPlanValueImpact);
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
