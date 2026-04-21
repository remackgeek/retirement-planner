import { describe, it, expect } from 'vitest';
import type { UserData } from '../types/UserData';
import type { IncomeEvent } from '../types/IncomeEvent';
import { estimateConversionImpact } from './conversionImpact';

function baseUserData(overrides: Partial<UserData> = {}): UserData {
  return {
    currentAge: 60,
    lifeExpectancy: 90,
    accounts: [
      { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000 },
      { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0 },
    ],
    spendingGoals: [],
    incomeEvents: [],
    portfolioAssumptions: {
      portfolioBalance: 'custom',
      stockAllocation: 0.6,
      stockReturn: 0.07,
      stockStdDev: 0,
      bondReturn: 0.04,
      bondStdDev: 0,
      stockBondCorrelationEnabled: false,
      stockBondCorrelation: 0,
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
});
