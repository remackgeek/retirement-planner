import { describe, it, expect } from 'vitest';
import { calculateAnnualCashFlow, runSimulation } from './SimulationService';
import type { UserData } from '../types/UserData';

const makeUserData = (overrides: Partial<UserData> = {}): UserData => ({
  currentAge: 60,
  lifeExpectancy: 90,
  referenceYear: 2026,
  accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional', balance: 500000 }],
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: { portfolioBalance: 'custom', stockAllocation: 0.6, stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0 },
  inflationRate: 0,
  inflationStdDev: 0,
  simulationSettings: { numSimulations: 5000 },
  filingStatus: 'single',
  spouseAge: null,
  stateTimeline: [{ state: 'Florida' }],
  longTermCapGainsRate: 0.15,
  ...overrides,
});

/** Helper to create a living_expenses spending goal */
const baseSpending = (monthlyAmount: number, startAge: number = 60) => ({
  id: 'base-spending',
  name: 'Living Expenses 1',
  type: 'living_expenses' as const,
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
    it('applies compound decay to living_expenses spending', () => {
      const userData = makeUserData({
        spendingGoals: [{
          id: '1',
          name: 'Living Expenses 1',
          type: 'living_expenses' as const,
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
          name: 'Living Expenses 1',
          type: 'living_expenses' as const,
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
          name: 'Living Expenses 1',
          type: 'living_expenses' as const,
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

  describe('account-aware withdrawal waterfall', () => {
    it('computes LTCG tax on taxable withdrawal: 50k spending from 100k taxable → W≈58,824', () => {
      const userData = makeUserData({
        accounts: [{ id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 100000 }],
        longTermCapGainsRate: 0.15,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 50000, startAge: 60, inflationAdjusted: false }],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Solver: W = 50k + 0.15*W → W = 50k/0.85 ≈ 58,824; LTCG tax ≈ 8,824
      expect(result.withdrawalFromTaxable).toBeCloseTo(58824, 0);
      expect(result.withdrawalFromTraditional).toBe(0);
      expect(result.withdrawalFromRoth).toBe(0);
      expect(result.totalTax).toBeCloseTo(8824, 0);
      // Consistency: withdrawal = spending + tax
      expect(result.portfolioWithdrawal).toBeCloseTo(result.totalSpendingNet + result.totalTax, 0);
    });

    it('Roth withdrawal does not increase SS provisional income', () => {
      // With SS income + Roth withdrawal: fromTrad=0 so provisionalIncome stays low → SS untaxed
      const rothUserData = makeUserData({
        accounts: [{ id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 500000 }],
        longTermCapGainsRate: 0,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 40000, startAge: 60, inflationAdjusted: false }],
      });
      const rothResult = calculateAnnualCashFlow(rothUserData, 2026, 0);
      // 20k SS covers 20k, need 20k more from roth. provisionalIncome = fromTrad + 0.5*SS = 0 + 10k < 25k threshold.
      expect(rothResult.withdrawalFromRoth).toBeGreaterThan(0);
      expect(rothResult.withdrawalFromTraditional).toBe(0);
      expect(rothResult.ssTaxableAmount).toBe(0);

      // Same scenario with Traditional: fromTrad increases provisional income → SS becomes taxable
      const tradUserData = makeUserData({
        accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000 }],
        longTermCapGainsRate: 0,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 40000, startAge: 60, inflationAdjusted: false }],
      });
      const tradResult = calculateAnnualCashFlow(tradUserData, 2026, 0);
      expect(tradResult.withdrawalFromTraditional).toBeGreaterThan(0);
      expect(tradResult.ssTaxableAmount).toBeGreaterThan(0); // trad withdrawal pushed SS into taxable range
    });

    it('draws from taxable first, then traditional, with explicit accountBalances', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 30000 },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 100000 },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 100000 },
        ],
        longTermCapGainsRate: 0,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 60000, startAge: 60, inflationAdjusted: false }],
      });
      // Taxable only has 30k (0% LTCG). Remaining ~30k+ comes from traditional.
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.withdrawalFromTaxable).toBe(30000); // exhausted
      expect(result.withdrawalFromTraditional).toBeGreaterThan(0);
      expect(result.withdrawalFromRoth).toBe(0); // roth not touched yet
      expect(result.portfolioWithdrawal).toBeCloseTo(
        result.withdrawalFromTaxable + result.withdrawalFromTraditional + result.withdrawalFromRoth, 0
      );
    });

    it('Roth-only account: zero tax regardless of withdrawal size', () => {
      const userData = makeUserData({
        accounts: [{ id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 500000 }],
        longTermCapGainsRate: 0.15,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 100000, startAge: 60, inflationAdjusted: false }],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Roth withdrawals are tax-free regardless of LTCG rate
      expect(result.totalTax).toBe(0);
      expect(result.withdrawalFromRoth).toBe(100000);
      expect(result.withdrawalFromTaxable).toBe(0);
      expect(result.withdrawalFromTraditional).toBe(0);
    });

    it('per-bucket withdrawals sum to portfolioWithdrawal', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 20000 },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 20000 },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 20000 },
        ],
        longTermCapGainsRate: 0.15,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 50000, startAge: 60, inflationAdjusted: false }],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBeCloseTo(
        result.withdrawalFromTaxable + result.withdrawalFromTraditional + result.withdrawalFromRoth, 0
      );
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

  describe('state timeline', () => {
    it('single-state timeline applies state tax', () => {
      const userData = makeUserData({
        stateTimeline: [{ state: 'California' }],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // CA state tax = 100000 * 0.08 = 8000
      // Federal tax on 100000 - 16100 = 83900 taxable
      expect(result.totalTax).toBeGreaterThan(8000); // federal + state
      // Compare with Florida (0% state tax)
      const flResult = calculateAnnualCashFlow(makeUserData({
        stateTimeline: [{ state: 'Florida' }],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      }), 2026, 0);
      expect(result.totalTax - flResult.totalTax).toBeCloseTo(8000, 0);
    });

    it('relocation changes tax rate at the correct year', () => {
      const userData = makeUserData({
        stateTimeline: [
          { state: 'California' },
          { state: 'Florida', startYear: 2030 },
        ],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const before = calculateAnnualCashFlow(userData, 2029, 0);
      const after = calculateAnnualCashFlow(userData, 2030, 0);
      // Before relocation: CA 8% state tax. After: FL 0%
      expect(before.totalTax - after.totalTax).toBeCloseTo(8000, 0);
    });

    it('multiple relocations: middle segment uses correct rate', () => {
      const userData = makeUserData({
        stateTimeline: [
          { state: 'Texas' },
          { state: 'New York', startYear: 2028 },
          { state: 'Florida', startYear: 2030 },
        ],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      // All years keep age < 65 to avoid senior deduction differences
      const tx = calculateAnnualCashFlow(userData, 2027, 0);  // age 61, TX
      const ny = calculateAnnualCashFlow(userData, 2029, 0);  // age 63, NY
      const fl = calculateAnnualCashFlow(userData, 2030, 0);  // age 64, FL
      // TX and FL both have 0% state tax, same federal brackets/deduction (all age < 65)
      expect(tx.totalTax).toBe(fl.totalTax);
      expect(ny.totalTax - tx.totalTax).toBeCloseTo(5500, 0); // 100k * 5.5%
    });

    it('relocation in reference year takes effect immediately', () => {
      const userData = makeUserData({
        stateTimeline: [
          { state: 'California' },
          { state: 'Florida', startYear: 2026 },
        ],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const flOnly = makeUserData({
        stateTimeline: [{ state: 'Florida' }],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      const flResult = calculateAnnualCashFlow(flOnly, 2026, 0);
      expect(result.totalTax).toBe(flResult.totalTax);
    });
  });
});

describe('runSimulation — per-path breakdowns', () => {
  // Deterministic setup: 0% returns, 0% stddev → all runs identical.
  // after_tax income avoids taxable withdrawal complications: $5k income, $20k spending,
  // $15k/yr net withdrawal. With $50k savings and 0% growth over 5 years (ages 60–64):
  //   Year 0: balance $50k → withdrawal $15k → balance $35k
  //   Year 1: balance $35k → withdrawal $15k → balance $20k
  //   Year 2: balance $20k → withdrawal $15k → balance $5k
  //   Year 3: balance $5k  → need $15k, cap at $5k → balance $0  (partial depletion)
  //   Year 4: balance $0   → need $15k, cap at $0  → balance $0  (full depletion)
  const depletionUserData = makeUserData({
    currentAge: 60,
    lifeExpectancy: 64,
    accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 50_000 }],
    inflationRate: 0,
    portfolioAssumptions: { portfolioBalance: 'custom', stockAllocation: 0.6, stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0 },
    simulationSettings: { numSimulations: 10 },
    spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 20_000, startAge: 60, inflationAdjusted: false }],
    incomeEvents: [{ id: 'i1', name: 'Other Income 1', type: 'other_income', amount: 5_000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' }],
  });

  it('returns medianBreakdowns and downsideBreakdowns with one entry per year', () => {
    const result = runSimulation(depletionUserData);
    const totalYears = depletionUserData.lifeExpectancy - depletionUserData.currentAge + 1;
    expect(result.medianBreakdowns).toHaveLength(totalYears);
    expect(result.downsideBreakdowns).toHaveLength(totalYears);
  });

  it('non-depleted years show full withdrawal and correct tax', () => {
    const { downsideBreakdowns } = runSimulation(depletionUserData);
    // Years 0–2: $15k withdrawal, tax = 0 (after_tax income only, no taxable income)
    for (let i = 0; i <= 2; i++) {
      expect(downsideBreakdowns[i].portfolioWithdrawal).toBeCloseTo(15_000, 0);
      expect(downsideBreakdowns[i].totalTax).toBe(0);
      expect(downsideBreakdowns[i].netCashFlow).toBeCloseTo(-15_000, 0);
    }
  });

  it('partially depleting year caps withdrawal at remaining balance', () => {
    const { downsideBreakdowns } = runSimulation(depletionUserData);
    // Year 3: only $5k left, so withdrawal is capped at $5k (not the $15k need)
    expect(downsideBreakdowns[3].portfolioWithdrawal).toBeCloseTo(5_000, 0);
    expect(downsideBreakdowns[3].totalTax).toBe(0); // $5k < standard deduction
    expect(downsideBreakdowns[3].netCashFlow).toBeCloseTo(-5_000, 0);
  });

  it('fully depleted year shows zero withdrawal and correctly recomputed zero tax', () => {
    const { downsideBreakdowns } = runSimulation(depletionUserData);
    // Year 4: portfolio is $0, no withdrawal possible
    expect(downsideBreakdowns[4].portfolioWithdrawal).toBe(0);
    expect(downsideBreakdowns[4].totalTax).toBe(0);
    expect(downsideBreakdowns[4].netCashFlow).toBe(0);
  });

  it('income and spending fields are unchanged by depletion', () => {
    const { downsideBreakdowns } = runSimulation(depletionUserData);
    // Income and spending are deterministic — same in all years for this scenario
    for (const bd of downsideBreakdowns) {
      expect(bd.afterTaxIncome).toBe(5_000);
      expect(bd.totalSpendingNet).toBe(20_000);
    }
  });
});

describe('runSimulation — deterministic path', () => {
  const noFlowUserData = makeUserData({
    currentAge: 60,
    lifeExpectancy: 65,
    accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 1_000_000 }],
    inflationRate: 0,
    portfolioAssumptions: { portfolioBalance: '60_40', stockAllocation: 0.6, stockReturn: 0.065, stockStdDev: 0.105, bondReturn: 0.065, bondStdDev: 0.105 },
    spendingGoals: [],
    incomeEvents: [],
  });

  it('nominal array is identical regardless of random function used', () => {
    const alwaysLow = () => 0.01;
    const alwaysHigh = () => 0.99;
    const r1 = runSimulation(noFlowUserData, alwaysLow);
    const r2 = runSimulation(noFlowUserData, alwaysHigh);
    expect(r1.nominal).toEqual(r2.nominal);
  });

  it('nominal compounds at balanced arithmetic mean (6.5%) with no cash flow and 0% inflation', () => {
    const mean = 0.065;
    const { nominal } = runSimulation(noFlowUserData);
    const totalYears = noFlowUserData.lifeExpectancy - noFlowUserData.currentAge + 1;
    for (let i = 0; i < totalYears; i++) {
      const startBalance = noFlowUserData.accounts.reduce((s, a) => s + a.balance, 0);
      const expected = startBalance * Math.pow(1 + mean, i);
      expect(nominal[i]).toBeCloseTo(expected, 0);
    }
  });
});
