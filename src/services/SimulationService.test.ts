import { describe, it, expect } from 'vitest';
import { calculateAnnualCashFlow } from './SimulationService';
import type { UserData } from '../types/UserData';

const makeUserData = (overrides: Partial<UserData> = {}): UserData => ({
  currentAge: 60,
  retirementAge: 60,
  lifeExpectancy: 90,
  referenceYear: 2026,
  currentSavings: 500000,
  annualSavings: 0,
  retirementSpending: { monthlyAmount: 0, startAge: 60 },
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

describe('calculateAnnualCashFlow', () => {
  describe('aggregate taxation (income only)', () => {
    it('applies one standard deduction across multiple before_tax events', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '2', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Combined $40k gross, single FL, deduction $16100, taxable $23900
      // Fed tax: 10% on 12400 = 1240, 12% on 11500 = 1380. Total = 2620
      // Net = 40000 - 2620 = 37380
      expect(result.otherTaxableGross).toBe(40000);
      expect(result.totalTax).toBeCloseTo(2620, 0);
      expect(result.netCashFlow).toBeCloseTo(37380, 0);
      expect(result.portfolioWithdrawal).toBe(0);
    });

    it('passes after_tax income through without tax', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 10000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
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
          { id: '1', type: 'social_security', amount: 24000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      // PI = 0 + 0.5 * 24000 = 12000 < 25000 → 0% taxable → no tax
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.ssGross).toBe(24000);
      expect(result.ssTaxableAmount).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.netCashFlow).toBe(24000);
    });

    it('SS is partially taxed in the 50% zone', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      // PI = 20000 + 0.5 * 20000 = 30000 → 50% zone
      // SS taxable = 2500. Combined taxable gross = 22500
      // Deduction 16100. Taxable = 6400. Tax = 640.
      // Net = 40000 - 640 = 39360
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
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.ssGross).toBe(23100);
      expect(result.netCashFlow).toBe(23100);
    });

    it('applies custom haircut percentage', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true, ssHaircutPercent: 30 },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.ssGross).toBe(21000);
      expect(result.netCashFlow).toBe(21000);
    });

    it('does not apply haircut when disabled', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2034, 0);
      expect(result.netCashFlow).toBe(30000);
    });

    it('does not apply haircut before 2034', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true },
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
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'today' },
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
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
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
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
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
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2033, 0.03);
      expect(result.netCashFlow).toBeCloseTo(29516.95, 0);
    });
  });

  describe('unified tax: spending only', () => {
    it('spending below standard deduction requires no tax gross-up', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 1250, startAge: 60 }, // 15k/yr < 16100 deduction
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.retirementSpendingNet).toBe(15000);
      expect(result.totalTax).toBe(0);
      expect(result.portfolioWithdrawal).toBe(15000);
      expect(result.netCashFlow).toBe(-15000);
    });

    it('spending above deduction includes tax in withdrawal', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 5000, startAge: 60 }, // 60k/yr
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.retirementSpendingNet).toBe(60000);
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
        retirementSpending: { monthlyAmount: 1000, startAge: 60 }, // 12k/yr
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 50000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
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
        retirementSpending: { monthlyAmount: 4000, startAge: 60 }, // 48k/yr net
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Income $30k doesn't cover $48k spending. Need withdrawal.
      // Combined taxable = $30k + withdrawal + (no SS). One deduction applied.
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result.totalTax).toBeGreaterThan(0);
      // Verify consistency: available - tax - spending = netCashFlow
      const available = result.afterTaxIncome + result.ssGross + result.otherTaxableGross;
      expect(result.netCashFlow).toBeCloseTo(available - result.totalTax - result.totalSpendingNet, 0);
      // netCashFlow should equal negative withdrawal
      expect(result.netCashFlow).toBeCloseTo(-result.portfolioWithdrawal, 0);
    });

    it('income exactly equals spending: small withdrawal needed for tax', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 2500, startAge: 60 }, // 30k/yr net
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // $30k income taxed → net < $30k → can't cover $30k spending → withdrawal needed for tax gap
      expect(result.totalTax).toBeGreaterThan(0);
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      // Withdrawal should roughly cover the tax amount (plus tax on the withdrawal itself)
      expect(result.portfolioWithdrawal).toBeGreaterThanOrEqual(result.totalTax * 0.5);
    });

    it('after-tax income covers spending: no tax, no withdrawal', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 500, startAge: 60 }, // 6k/yr
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 10000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalTax).toBe(0);
      expect(result.portfolioWithdrawal).toBe(0);
      expect(result.netCashFlow).toBe(4000); // 10000 - 6000
    });

    it('SS provisional income accounts for withdrawal', () => {
      // SS just below 50% threshold without withdrawal, but withdrawal pushes it over
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 2000, startAge: 60 }, // 24k/yr
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 40000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      // Without withdrawal: PI = 0 + 0.5 * 40000 = 20000 < 25000 → 0% taxable
      // But spending 24k exceeds after-tax SS (since even with 0% SS taxable, spending needs coverage)
      // With withdrawal: PI = withdrawal + 0.5 * 40000. If withdrawal > 5000, PI > 25000 → SS becomes taxable
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // The withdrawal should cause the SS taxable fraction to be > 0
      // since PI = withdrawal + 20000, and any withdrawal pushes PI towards/past 25000
      expect(result.portfolioWithdrawal).toBe(0); // Actually 40k income > 24k spending
      // Let's try a case where SS doesn't cover spending
      const userData2 = makeUserData({
        retirementSpending: { monthlyAmount: 4000, startAge: 60 }, // 48k/yr
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 40000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      const result2 = calculateAnnualCashFlow(userData2, 2026, 0);
      // PI = (otherGross + withdrawal) + 0.5 * 40000 = withdrawal + 20000
      // Withdrawal > 0, so PI > 20000. If withdrawal > 5000, PI > 25000 → SS becomes taxable
      expect(result2.portfolioWithdrawal).toBeGreaterThan(0);
      expect(result2.ssTaxableAmount).toBeGreaterThan(0);
    });

    it('high-bracket interaction: large income + large spending', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 10000, startAge: 60 }, // 120k/yr
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 80000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // $80k income doesn't cover $120k spending. Withdrawal needed.
      // Combined taxable = $80k + withdrawal. Pushes into 22% bracket.
      expect(result.portfolioWithdrawal).toBeGreaterThan(40000);
      expect(result.totalTax).toBeGreaterThan(10000);
      // Verify consistency
      expect(result.netCashFlow).toBeCloseTo(-result.portfolioWithdrawal, 0);
    });

    it('mixed income types: after-tax + before-tax + SS + spending', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 5000, startAge: 60 }, // 60k/yr
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', type: 'pension_income', amount: 15000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '3', type: 'other_income', amount: 5000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.ssGross).toBe(20000);
      expect(result.otherTaxableGross).toBe(15000);
      expect(result.afterTaxIncome).toBe(5000);
      expect(result.totalGrossIncome).toBe(40000);
      // 60k spending > 40k income → withdrawal needed
      expect(result.portfolioWithdrawal).toBeGreaterThan(0);
      // SS provisional income should account for pension + withdrawal
      expect(result.ssTaxableAmount).toBeGreaterThanOrEqual(0);
      // Verify consistency
      const available = result.afterTaxIncome + result.ssGross + result.otherTaxableGross;
      expect(result.netCashFlow).toBeCloseTo(available - result.totalTax - result.totalSpendingNet, 0);
    });
  });

  describe('breakdown field consistency', () => {
    it('totalGrossIncome equals sum of income components', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
          { id: '2', type: 'pension_income', amount: 15000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '3', type: 'other_income', amount: 5000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalGrossIncome).toBe(
        result.ssGross + result.otherTaxableGross + result.afterTaxIncome
      );
    });

    it('totalSpendingNet equals sum of spending components', () => {
      const userData = makeUserData({
        retirementSpending: { monthlyAmount: 3000, startAge: 60 },
        spendingGoals: [
          { id: '1', type: 'vacation', amount: 5000, startAge: 60, inflationAdjusted: false, isOneTime: true },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.totalSpendingNet).toBe(
        result.retirementSpendingNet + result.otherSpendingGoalsNet
      );
      expect(result.retirementSpendingNet).toBe(36000);
      expect(result.otherSpendingGoalsNet).toBe(5000);
    });
  });
});
