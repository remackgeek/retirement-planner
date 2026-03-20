import { describe, it, expect } from 'vitest';
import { calculateAnnualCashFlow } from './SimulationService';
import type { UserData } from '../types/UserData';

const makeUserData = (overrides: Partial<UserData> = {}): UserData => ({
  currentAge: 60,
  lifeExpectancy: 90,
  referenceYear: 2026,
  currentSavings: 500000,
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: { riskLevel: 'custom', expectedReturn: 0, standardDeviation: 0 },
  inflationRate: 0,
  filingStatus: 'single',
  spouseName: null,
  spouseAge: null,
  state: 'Florida',
  ...overrides,
});

/** Helper to create a monthly_retirement spending goal */
const baseSpending = (monthlyAmount: number, startAge: number = 60) => ({
  id: 'base-spending',
  name: 'Monthly Retirement 1',
  type: 'monthly_retirement' as const,
  amount: monthlyAmount * 12,
  startAge,
  inflationAdjusted: false,
});

describe('calculateAnnualCashFlow', () => {
  describe('aggregate taxation (income only)', () => {
    it('applies one standard deduction across multiple before_tax events', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '2', name: 'Pension Income 2', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.otherTaxableGross).toBe(40000);
      expect(result.totalTax).toBeCloseTo(2620, 0);
      expect(result.netCashFlow).toBeCloseTo(37380, 0);
      expect(result.portfolioWithdrawal).toBe(0);
    });

    it('passes after_tax income through without tax', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 10000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.afterTaxIncome).toBe(10000);
      expect(result.totalTax).toBe(0);
      expect(result.netCashFlow).toBe(10000);
    });

    it('returns zero breakdown with no active income or spending', () => {
      const userData = makeUserData({ incomeEvents: [] });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.netCashFlow).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.portfolioWithdrawal).toBe(0);
      expect(result.totalGrossIncome).toBe(0);
      expect(result.totalSpendingNet).toBe(0);
    });
  });

  describe('SS taxable fraction integration', () => {
    it('SS is untaxed when provisional income below threshold', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 24000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.ssGross).toBe(24000);
      expect(result.ssTaxableAmount).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.netCashFlow).toBe(24000);
    });

    it('SS is partially taxed in the 50% zone', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', name: 'Pension Income 2', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.ssTaxableAmount).toBeCloseTo(2500, 0);
      expect(result.totalTax).toBeCloseTo(640, 0);
      expect(result.netCashFlow).toBeCloseTo(39360, 0);
    });
  });

  describe('SS haircut', () => {
    it('applies default 23% haircut from 2034', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.ssGross).toBe(23100);
      expect(result.netCashFlow).toBe(23100);
    });

    it('applies custom haircut percentage', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true, ssHaircutPercent: 30 },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.ssGross).toBe(21000);
      expect(result.netCashFlow).toBe(21000);
    });

    it('does not apply haircut when disabled', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.netCashFlow).toBe(30000);
    });

    it('does not apply haircut before 2034', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2033, 0);
      expect(result.netCashFlow).toBe(30000);
    });
  });

  describe('SS amount basis (today vs future dollars)', () => {
    it('today\'s dollars: inflates from reference year', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'today' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2033, 0.03);
      expect(result.ssGross).toBeCloseTo(29516.95, 0);
      expect(result.netCashFlow).toBeCloseTo(29516.95, 0);
    });

    it('future dollars: inflates only from claiming year forward', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2033, 0.03);
      expect(result.netCashFlow).toBe(24000);
    });

    it('future dollars: applies COLA after claiming year', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2035, 0.03);
      expect(result.ssGross).toBeCloseTo(25461.60, 0);
    });

    it('default (no ssAmountBasis) behaves as today\'s dollars', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2033, 0.03);
      expect(result.netCashFlow).toBeCloseTo(29516.95, 0);
    });
  });

  describe('unified tax: spending only', () => {
    it('spending below standard deduction requires no tax gross-up', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(1250)], // 15k/yr < 16100 deduction
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.baseSpendingNet).toBe(15000);
      expect(result.totalTax).toBe(0);
      expect(result.portfolioWithdrawal).toBe(15000);
      expect(result.netCashFlow).toBe(-15000);
    });

    it('spending above deduction includes tax in withdrawal', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(5000)], // 60k/yr
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.baseSpendingNet).toBe(60000);
      expect(result.totalTax).toBeGreaterThan(0);
      expect(result.portfolioWithdrawal).toBeGreaterThan(60000);
      // Verify internal consistency: withdrawal = spending + tax - income
      expect(result.portfolioWithdrawal).toBeCloseTo(
        result.totalSpendingNet + result.totalTax, 0
      );
    });
  });

  describe('unified tax: income + spending interaction', () => {
    it('income covers spending: no withdrawal needed, surplus to portfolio', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(1000)], // 12k/yr
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 50000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBe(0);
      expect(result.netCashFlow).toBeGreaterThan(0);
      // Net cash flow = income - tax - spending
      expect(result.netCashFlow).toBeCloseTo(
        result.totalGrossIncome - result.totalTax - result.totalSpendingNet, 0
      );
    });

    it('spending exceeds income: withdrawal accounts for combined tax brackets', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(4000)], // 48k/yr net
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result.totalTax).toBeGreaterThan(0);
      const available = result.afterTaxIncome + result.ssGross + result.otherTaxableGross;
      expect(result.netCashFlow).toBeCloseTo(available - result.totalTax - result.totalSpendingNet, 0);
      expect(result.netCashFlow).toBeCloseTo(-result.portfolioWithdrawal, 0);
    });

    it('income exactly equals spending: small withdrawal needed for tax', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(2500)], // 30k/yr net
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalTax).toBeGreaterThan(0);
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result.portfolioWithdrawal).toBeGreaterThanOrEqual(result.totalTax * 0.5);
    });

    it('after-tax income covers spending: no tax, no withdrawal', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(500)], // 6k/yr
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 10000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalTax).toBe(0);
      expect(result.portfolioWithdrawal).toBe(0);
      expect(result.netCashFlow).toBe(4000); // 10000 - 6000
    });

    it('SS provisional income accounts for withdrawal', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(2000)], // 24k/yr
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 40000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBe(0); // Actually 40k income > 24k spending
      // Try a case where SS doesn't cover spending
      const userData2 = makeUserData({
        spendingGoals: [baseSpending(4000)], // 48k/yr
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 40000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result2 = calculateAnnualCashFlow(userData2, 2026, 0);
      expect(result2.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result2.ssTaxableAmount).toBeGreaterThan(0);
    });

    it('high-bracket interaction: large income + large spending', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(10000)], // 120k/yr
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 80000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBeGreaterThan(40000);
      expect(result.totalTax).toBeGreaterThan(10000);
      expect(result.netCashFlow).toBeCloseTo(-result.portfolioWithdrawal, 0);
    });

    it('mixed income types: after-tax + before-tax + SS + spending', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(5000)], // 60k/yr
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', name: 'Pension Income 2', type: 'pension_income', amount: 15000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '3', name: 'Other Income 3', type: 'other_income', amount: 5000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.ssGross).toBe(20000);
      expect(result.otherTaxableGross).toBe(15000);
      expect(result.afterTaxIncome).toBe(5000);
      expect(result.totalGrossIncome).toBe(40000);
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result.ssTaxableAmount).toBeGreaterThanOrEqual(0);
      const available = result.afterTaxIncome + result.ssGross + result.otherTaxableGross;
      expect(result.netCashFlow).toBeCloseTo(available - result.totalTax - result.totalSpendingNet, 0);
    });
  });

  describe('employment_savings income type', () => {
    it('flows through as after_tax income with no taxation', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Employment Savings 1', type: 'employment_savings', amount: 20000, startAge: 60, endAge: 65, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.afterTaxIncome).toBe(20000);
      expect(result.totalTax).toBe(0);
      expect(result.netCashFlow).toBe(20000);
    });

    it('is not active before startAge', () => {
      const userData = makeUserData({
        currentAge: 55,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Employment Savings 1', type: 'employment_savings', amount: 20000, startAge: 60, endAge: 65, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      // Year 2026 = age 55, event starts at age 60 = year 2031
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.afterTaxIncome).toBe(0);
      expect(result.netCashFlow).toBe(0);
    });

    it('is not active after endAge', () => {
      const userData = makeUserData({
        currentAge: 55,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', name: 'Employment Savings 1', type: 'employment_savings', amount: 20000, startAge: 55, endAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      // Year 2032 = age 61, event ends at age 60 = year 2031
      const result = calculateAnnualCashFlow(userData, 2032, 0);
      expect(result.afterTaxIncome).toBe(0);
      expect(result.netCashFlow).toBe(0);
    });
  });

  describe('yearlyDecreasePercent on spending goals', () => {
    it('applies compound decay to monthly_retirement spending', () => {
      const userData = makeUserData({
        spendingGoals: [{
          id: '1',
          name: 'Monthly Retirement 1',
          type: 'monthly_retirement' as const,
          amount: 60000,
          startAge: 60,
          inflationAdjusted: false,
          yearlyDecreasePercent: 5,
        }],
      });
      // Year 0 (startAge): 60000
      const r0 = calculateAnnualCashFlow(userData, 2026, 0);
      expect(r0.baseSpendingNet).toBe(60000);

      // Year 1: 60000 * 0.95 = 57000
      const r1 = calculateAnnualCashFlow(userData, 2027, 0);
      expect(r1.baseSpendingNet).toBe(57000);

      // Year 2: 60000 * 0.95^2 = 54150
      const r2 = calculateAnnualCashFlow(userData, 2028, 0);
      expect(r2.baseSpendingNet).toBe(54150);
    });

    it('applies decay after inflation adjustment', () => {
      const userData = makeUserData({
        spendingGoals: [{
          id: '1',
          name: 'Monthly Retirement 1',
          type: 'monthly_retirement' as const,
          amount: 60000,
          startAge: 60,
          inflationAdjusted: true,
          yearlyDecreasePercent: 5,
        }],
      });
      // Year 2 with 3% inflation:
      // Inflation: 60000 * 1.03^2 = 63654
      // Then decay: 63654 * 0.95^2 = 57403.23
      const result = calculateAnnualCashFlow(userData, 2028, 0.03);
      expect(result.baseSpendingNet).toBeCloseTo(60000 * Math.pow(1.03, 2) * Math.pow(0.95, 2), 0);
    });

    it('does not apply decay to goals without yearlyDecreasePercent', () => {
      const userData = makeUserData({
        spendingGoals: [{
          id: '1',
          name: 'Monthly Retirement 1',
          type: 'monthly_retirement' as const,
          amount: 60000,
          startAge: 60,
          inflationAdjusted: false,
        }],
      });
      const r0 = calculateAnnualCashFlow(userData, 2026, 0);
      const r2 = calculateAnnualCashFlow(userData, 2028, 0);
      expect(r0.baseSpendingNet).toBe(60000);
      expect(r2.baseSpendingNet).toBe(60000);
    });
  });

  describe('breakdown field consistency', () => {
    it('totalGrossIncome equals sum of income components', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', name: 'Pension Income 2', type: 'pension_income', amount: 15000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '3', name: 'Other Income 3', type: 'other_income', amount: 5000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalGrossIncome).toBe(
        result.ssGross + result.otherTaxableGross + result.afterTaxIncome
      );
    });

    it('totalSpendingNet equals sum of spending components', () => {
      const userData = makeUserData({
        spendingGoals: [
          baseSpending(3000), // 36k/yr
          { id: '1', name: 'Vacation 1', type: 'vacation' as const, amount: 5000, startAge: 60, inflationAdjusted: false, isOneTime: true },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalSpendingNet).toBe(
        result.baseSpendingNet + result.otherSpendingGoalsNet
      );
      expect(result.baseSpendingNet).toBe(36000);
      expect(result.otherSpendingGoalsNet).toBe(5000);
    });
  });
});
