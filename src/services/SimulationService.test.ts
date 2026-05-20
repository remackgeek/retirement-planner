import { describe, it, expect } from 'vitest';
import {
  calculateAnnualCashFlow,
  calculateRMD,
  computeBracketHeadroomForTrad,
  computeMarginalStackAttribution,
  getEffectiveStateName,
  IRS_UNIFORM_LIFETIME_TABLE,
  resolveSpendingWithdrawalOrder,
  runSimulation,
  SYNTHETIC_TRAD_WITHDRAWAL_ID,
  type EventIncomeRecord,
} from './SimulationService';
import { studentTRandom, standardizedTRandom } from './ReturnGenerator';
import type { UserData } from '../types/UserData';
import { createSeededRandom } from '../../test/utils/seededRandom';

const makeUserData = (overrides: Partial<UserData> = {}): UserData => ({
  currentAge: 60,
  lifeExpectancy: 90,
  referenceYear: 2026,
  accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
  inflationRate: 0,
  inflationStdDev: 0,
  simulationSettings: { numSimulations: 5000 },
  filingStatus: 'single',
  spouseAge: null,
  stateTimeline: [{ state: 'Florida' }],
  longTermCapGainsRate: 0.15,
  // Default to very high caps so non-cap tests don't trip enforcement.
  // Cap-specific tests override this explicitly.
  contributionLimits: {
    elective401k: 1_000_000,
    iraLimit: 1_000_000,
    catchUpAge: 50,
    catchUp401k: 0,
    catchUpIra: 0,
    inflationAdjusted: false,
  },
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

    it('surplusContribution equals max(0, netCashFlow) on uncapped years', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(1000)], // 12k/yr
        incomeEvents: [
          { id: '1', name: 'Pension', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const surplus = calculateAnnualCashFlow(userData, 2026, 0);
      expect(surplus.netCashFlow).toBeGreaterThan(0);
      expect(surplus.surplusContribution).toBeCloseTo(surplus.netCashFlow, 0);
    });

    it('surplusContribution is 0 when netCashFlow is negative', () => {
      const userData = makeUserData({
        spendingGoals: [baseSpending(4000)],
        incomeEvents: [
          { id: '1', name: 'Pension', type: 'pension_income', amount: 5000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.netCashFlow).toBeLessThan(0);
      expect(result.surplusContribution).toBe(0);
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

  describe('wage_income + retirement_contribution', () => {
    it('wage_income flows as before-tax ordinary income', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Salary 1', type: 'wage_income', amount: 100000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.wageIncomeGross).toBe(100000);
      expect(result.otherTaxableGross).toBe(100000);
      expect(result.totalTax).toBeGreaterThan(0);
    });

    it('pre_tax retirement_contribution reduces taxable income', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        incomeEvents: [
          { id: 'w1', name: 'Salary', type: 'wage_income', amount: 100000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c1', name: '401k', type: 'retirement_contribution', amount: 20000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'trad-1' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // 100k wage minus 20k pre_tax = 80k otherTaxableGross
      expect(result.wageIncomeGross).toBe(100000);
      expect(result.otherTaxableGross).toBe(80000);
      expect(result.preTaxContributions).toBe(20000);
    });

    it('roth retirement_contribution does NOT reduce taxable income', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        incomeEvents: [
          { id: 'w1', name: 'Salary', type: 'wage_income', amount: 100000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c1', name: 'Roth 401k', type: 'retirement_contribution', amount: 15000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'roth', accountId: 'roth-1' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.otherTaxableGross).toBe(100000);
      expect(result.rothContributions).toBe(15000);
    });

    it('employer match is computed from match% × min(contribution, ceiling × wage)', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        incomeEvents: [
          { id: 'w1', name: 'Salary', type: 'wage_income', amount: 100000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed' },
          // Match 100% up to 6% of wages. Employee contribution 10k > 6% of 100k = 6k → match capped at 6k.
          { id: 'c1', name: '401k', type: 'retirement_contribution', amount: 10000, startAge: 60, endAge: 64, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'trad-1', employerMatchPercent: 100, employerMatchCeilingPercent: 6, wageEventId: 'w1' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.employerMatch).toBeCloseTo(6000, 0);
    });

    it('retirement_contribution is not active before startAge', () => {
      const userData = makeUserData({
        currentAge: 55,
        referenceYear: 2026,
        accounts: [
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        incomeEvents: [
          { id: 'c1', name: '401k', type: 'retirement_contribution', amount: 20000, startAge: 60, endAge: 65, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.preTaxContributions).toBe(0);
    });
  });

  describe('contribution limit enforcement', () => {
    const lowCaps = {
      elective401k: 23000,
      iraLimit: 7000,
      catchUpAge: 50,
      catchUp401k: 7500,
      catchUpIra: 1000,
      inflationAdjusted: false,
    };

    it('401(k) cap enforced per-owner with two owners contributing to separate 401(k)s', () => {
      const userData = makeUserData({
        currentAge: 40,
        spouseAge: 40,
        contributionLimits: lowCaps,
        accounts: [
          { id: 'self-401k', name: 'Self 401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k', owner: 'self' },
          { id: 'spouse-401k', name: 'Spouse 401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k', owner: 'spouse' },
        ],
        incomeEvents: [
          { id: 'ws', name: 'Self Salary', type: 'wage_income', amount: 200000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'cs', name: 'Self 401k', type: 'retirement_contribution', amount: 30000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'self-401k', owner: 'self' },
          { id: 'csp', name: 'Spouse 401k', type: 'retirement_contribution', amount: 30000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'spouse-401k', owner: 'spouse' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Each owner capped to 23k. Total deposited = 46k; cut = 14k.
      expect(result.preTaxContributions).toBeCloseTo(46000, 0);
      expect(result.contributionsCappedAmount).toBeCloseTo(14000, 0);
    });

    it('catch-up boost applies at catchUpAge', () => {
      const userData = makeUserData({
        currentAge: 50,
        contributionLimits: lowCaps,
        accounts: [
          { id: 's401', name: '401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k' },
        ],
        incomeEvents: [
          { id: 'w', name: 'Salary', type: 'wage_income', amount: 200000, startAge: 50, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c', name: '401k', type: 'retirement_contribution', amount: 35000, startAge: 50, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 's401' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Cap = 23000 + 7500 = 30500; cut = 4500.
      expect(result.preTaxContributions).toBeCloseTo(30500, 0);
      expect(result.contributionsCappedAmount).toBeCloseTo(4500, 0);
    });

    it('IRA and 401(k) caps tracked independently for the same owner', () => {
      const userData = makeUserData({
        currentAge: 40,
        contributionLimits: lowCaps,
        accounts: [
          { id: 'k', name: '401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k' },
          { id: 'i', name: 'IRA', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'ira' },
        ],
        incomeEvents: [
          { id: 'w', name: 'Salary', type: 'wage_income', amount: 300000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c1', name: '401k', type: 'retirement_contribution', amount: 30000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'k' },
          { id: 'c2', name: 'IRA', type: 'retirement_contribution', amount: 10000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'i' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // 401k: cap 23k, cut 7k. IRA: cap 7k, cut 3k. Total cut = 10k.
      expect(result.preTaxContributions).toBeCloseTo(30000, 0);
      expect(result.contributionsCappedAmount).toBeCloseTo(10000, 0);
    });

    it('inflation adjustment scales caps in later years', () => {
      const userData = makeUserData({
        currentAge: 40,
        contributionLimits: { ...lowCaps, catchUpAge: 99, inflationAdjusted: true },
        inflationRate: 0.03,
        accounts: [
          { id: 'k', name: '401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k' },
        ],
        incomeEvents: [
          { id: 'w', name: 'Salary', type: 'wage_income', amount: 200000, startAge: 40, taxStatus: 'before_tax', colaType: 'inflation_adjusted' },
          { id: 'c', name: '401k', type: 'retirement_contribution', amount: 25000, startAge: 40, taxStatus: 'before_tax', colaType: 'inflation_adjusted', contributionType: 'pre_tax', accountId: 'k' },
        ],
      });
      // Year 0: contribution 25k > cap 23k → cut 2k
      const r0 = calculateAnnualCashFlow(userData, 2026, 0.03);
      expect(r0.contributionsCappedAmount).toBeCloseTo(2000, 0);
      // Year 10: contribution 25k * 1.03^10 ≈ 33598; cap 23k * 1.03^10 ≈ 30910; cut ≈ 2688
      const r10 = calculateAnnualCashFlow(userData, 2036, 0.03);
      const expectedContrib = 25000 * Math.pow(1.03, 10);
      const expectedCap = 23000 * Math.pow(1.03, 10);
      expect(r10.contributionsCappedAmount).toBeCloseTo(expectedContrib - expectedCap, 0);
    });

    it('overflow propagates to contributionsCappedAmount and pre-tax overflow stays in taxable income', () => {
      const userData = makeUserData({
        currentAge: 40,
        contributionLimits: lowCaps,
        accounts: [
          { id: 'k', name: '401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k' },
        ],
        incomeEvents: [
          { id: 'w', name: 'Salary', type: 'wage_income', amount: 100000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c', name: '401k', type: 'retirement_contribution', amount: 30000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'k' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Cap 23k → cut 7k. otherTaxableGross = 100k - 23k = 77k (capped pre-tax stays taxable).
      expect(result.contributionsCappedAmount).toBeCloseTo(7000, 0);
      expect(result.preTaxContributions).toBeCloseTo(23000, 0);
      expect(result.otherTaxableGross).toBeCloseTo(77000, 0);
    });

    it('after_tax contributions to brokerage are uncapped', () => {
      const userData = makeUserData({
        currentAge: 40,
        contributionLimits: lowCaps,
        accounts: [
          { id: 'tx', name: 'Brokerage', type: 'taxable', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        incomeEvents: [
          { id: 'w', name: 'Salary', type: 'wage_income', amount: 200000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: 'c', name: 'Savings', type: 'retirement_contribution', amount: 50000, startAge: 40, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'after_tax', accountId: 'tx' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.contributionsCappedAmount).toBe(0);
      expect(result.afterTaxContributions).toBeCloseTo(50000, 0);
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
        accounts: [{ id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
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
        accounts: [{ id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
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
        accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
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
          { id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 30000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
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
        accounts: [{ id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
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
          { id: 'tax-1', name: 'Taxable 1', type: 'taxable', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
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
      // CA profile: stateOrdinaryBase $100k − std ded $5,540 = $94,460 taxable.
      // Walking CA single brackets: 1%·10,412 + 2%·14,272 + 4%·14,275 + 6%·15,122 + 8%·14,269 + 9.3%·26,110 ≈ $5,438.
      // Federal tax on $100k − $16,100 = $83,900 taxable → $13,170.
      expect(result.totalTax).toBeGreaterThan(5000); // federal + state
      const flResult = calculateAnnualCashFlow(makeUserData({
        stateTimeline: [{ state: 'Florida' }],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      }), 2026, 0);
      expect(result.totalTax - flResult.totalTax).toBeCloseTo(5438, 0);
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
      // Before: CA tax ≈ $5,438 on $100k pension (graduated brackets above std ded). After: FL 0%.
      expect(before.totalTax - after.totalTax).toBeCloseTo(5438, 0);
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
      // NY profile: pension_income is "before_tax" ordinary, NOT a Traditional withdrawal — the $20k
      // NY pension/IRA exclusion does NOT apply here. State base = $100k − $8,000 NY std ded = $92,000.
      // NY single brackets: 4%·8,500 + 4.5%·3,200 + 5.25%·2,200 + 5.5%·66,750 + 6%·11,350 ≈ $4,952.
      expect(ny.totalTax - tx.totalTax).toBeCloseTo(4952, 0);
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
    accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 50_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    inflationRate: 0,
    portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
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
    accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    inflationRate: 0,
    portfolioAssumptions: { stockReturn: 0.065, stockStdDev: 0.105, bondReturn: 0.065, bondStdDev: 0.105, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
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

describe('runSimulation — hoisted precomputation equivalence', () => {
  // Verify that the MC loop's precomputed per-year arrays produce the same
  // breakdown as the public calculateAnnualCashFlow wrapper for a reference year.
  // If calculateAnnualCashFlowCore ever drifts from calculateAnnualCashFlow, this catches it.
  it('per-year income/spending in a deterministic run matches calculateAnnualCashFlow', () => {
    const userData = makeUserData({
      currentAge: 60,
      lifeExpectancy: 62,
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'taxable' as const, balance: 300_000, stockAllocation: 1, portfolioBalance: '80_20' as const }],
      inflationRate: 0.03,
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 1 },
      incomeEvents: [
        { id: 'i1', name: 'SS 1', type: 'social_security', amount: 24_000, startAge: 60, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false },
      ],
      spendingGoals: [
        { id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 40_000, startAge: 60, inflationAdjusted: true },
      ],
      stateTimeline: [{ state: 'California' }],
    });

    const { nominalBreakdowns } = runSimulation(userData);

    // The nominal path calls calculateAnnualCashFlowCore with the same precomputed
    // arrays. Cross-check year 1 (index 1, year 2027) against the public wrapper.
    const refYear = userData.referenceYear + 1;
    const refBalances = { 'acct-1': 300_000 }; // approximate; exact value doesn't matter for income/spending check
    const direct = calculateAnnualCashFlow(userData, refYear, userData.inflationRate, refBalances);

    // ssGross, otherTaxableGross, afterTaxIncome, baseSpendingNet, and otherSpendingGoalsNet
    // come purely from accumulateIncome/accumulateSpending — balance-independent.
    expect(nominalBreakdowns[1].ssGross).toBeCloseTo(direct.ssGross, 2);
    expect(nominalBreakdowns[1].afterTaxIncome).toBe(direct.afterTaxIncome);
    expect(nominalBreakdowns[1].baseSpendingNet).toBeCloseTo(direct.baseSpendingNet, 2);
    expect(nominalBreakdowns[1].otherSpendingGoalsNet).toBe(direct.otherSpendingGoalsNet);
  });

  it('stochastic inflation (inflationStdDev > 0) runs without error and produces valid output', () => {
    const userData = makeUserData({
      currentAge: 60,
      lifeExpectancy: 65,
      inflationRate: 0.03,
      inflationStdDev: 0.01,
      portfolioAssumptions: { stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.03, bondStdDev: 0.05, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 100 },
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'taxable' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    });
    const result = runSimulation(userData);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(100);
    expect(result.median.length).toBe(6); // ages 60–65 inclusive
    expect(result.nominal.every(v => Number.isFinite(v))).toBe(true);
  });
});

describe('calculateRMD', () => {
  it('returns 0 for age below 73', () => {
    expect(calculateRMD(500000, 72)).toBe(0);
    expect(calculateRMD(500000, 65)).toBe(0);
    expect(calculateRMD(500000, 0)).toBe(0);
  });

  it('returns 0 for zero balance regardless of age', () => {
    expect(calculateRMD(0, 73)).toBe(0);
    expect(calculateRMD(0, 80)).toBe(0);
  });

  it('uses divisor 26.5 at age 73', () => {
    expect(calculateRMD(265000, 73)).toBeCloseTo(10000, 2);
    expect(IRS_UNIFORM_LIFETIME_TABLE[73]).toBe(26.5);
  });

  it('uses decreasing divisors at higher ages (larger RMD %)', () => {
    const rmd73 = calculateRMD(500000, 73);
    const rmd80 = calculateRMD(500000, 80);
    const rmd90 = calculateRMD(500000, 90);
    expect(rmd80).toBeGreaterThan(rmd73);
    expect(rmd90).toBeGreaterThan(rmd80);
  });

  it('uses age 114 divisor for ages 115 and above', () => {
    expect(calculateRMD(100000, 115)).toBeCloseTo(calculateRMD(100000, 114), 10);
    expect(calculateRMD(100000, 120)).toBeCloseTo(calculateRMD(100000, 114), 10);
  });

  it('rmdRequired appears in calculateAnnualCashFlow breakdown at age 73+', () => {
    const userData = makeUserData({
      currentAge: 73,
      accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 265000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    });
    const breakdown = calculateAnnualCashFlow(userData, 2026, 0);
    expect(breakdown.rmdRequired).toBeCloseTo(10000, 2); // 265000 / 26.5
  });

  it('rmdRequired is 0 in calculateAnnualCashFlow below age 73', () => {
    const userData = makeUserData({
      currentAge: 72,
      accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    });
    const breakdown = calculateAnnualCashFlow(userData, 2026, 0);
    expect(breakdown.rmdRequired).toBe(0);
    expect(breakdown.rmdExcess).toBe(0);
  });

  it('rmdExcess is 0 when spending already exceeds RMD', () => {
    const userData = makeUserData({
      currentAge: 73,
      accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 200000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      spendingGoals: [{ id: 'sp-1', name: 'Living Expenses 1', type: 'living_expenses', amount: 50000, startAge: 73, inflationAdjusted: false }],
    });
    const breakdown = calculateAnnualCashFlow(userData, 2026, 0);
    // RMD = 200000/26.5 ≈ 7547, spending = 50000 >> RMD
    expect(breakdown.rmdExcess).toBe(0);
    expect(breakdown.rmdRequired).toBeCloseTo(7547, 0);
  });
});

describe('Student\'s t samplers', () => {
  // Compute sample variance of N draws from a sampler.
  const sampleVariance = (draws: number[]): { mean: number; variance: number } => {
    const n = draws.length;
    const mean = draws.reduce((s, x) => s + x, 0) / n;
    const variance = draws.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1);
    return { mean, variance };
  };

  it('studentTRandom has approximate theoretical variance df/(df-2)', () => {
    const df = 6;
    const expectedVar = df / (df - 2); // = 1.5
    const rng = createSeededRandom(12345);
    const N = 50000;
    const draws: number[] = [];
    for (let i = 0; i < N; i++) draws.push(studentTRandom(df, rng));
    const { mean, variance } = sampleVariance(draws);
    // Mean should be near 0 (t is symmetric)
    expect(Math.abs(mean)).toBeLessThan(0.05);
    // Variance close to df/(df-2) within ±10% over 50k draws
    expect(variance).toBeGreaterThan(expectedVar * 0.9);
    expect(variance).toBeLessThan(expectedVar * 1.1);
  });

  it('standardizedTRandom has unit variance regardless of df', () => {
    const rng = createSeededRandom(777);
    const N = 50000;
    for (const df of [4, 6, 10]) {
      const draws: number[] = [];
      for (let i = 0; i < N; i++) draws.push(standardizedTRandom(df, rng));
      const { mean, variance } = sampleVariance(draws);
      expect(Math.abs(mean)).toBeLessThan(0.05);
      // Unit variance within ±10% tolerance
      expect(variance).toBeGreaterThan(0.9);
      expect(variance).toBeLessThan(1.1);
    }
  });
});

describe('runSimulation — Student\'s t return distribution', () => {
  it('zero-variance scenario produces identical results under lognormal and student_t', () => {
    // With stockStdDev=0 and bondStdDev=0 the shock is multiplied by zero,
    // so the distribution choice is irrelevant and paths must match exactly.
    const baseUserData = makeUserData({
      currentAge: 60,
      lifeExpectancy: 65,
      accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      spendingGoals: [],
      incomeEvents: [],
      inflationRate: 0,
      portfolioAssumptions: {
        stockReturn: 0.05, stockStdDev: 0,
        bondReturn: 0.03, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
      },
    });
    const tUserData = {
      ...baseUserData,
      portfolioAssumptions: {
        ...baseUserData.portfolioAssumptions,
        returnDistribution: 'student_t' as const,
        degreesOfFreedom: 4,
      },
    };
    const logResult = runSimulation(baseUserData, createSeededRandom(42));
    const tResult = runSimulation(tUserData, createSeededRandom(42));
    expect(tResult.nominal).toEqual(logResult.nominal);
    expect(tResult.median).toEqual(logResult.median);
  });

  it('student_t produces different results than lognormal when stddev is non-zero', () => {
    // Sanity check that the t-distribution path is actually engaged and produces
    // distinct output from the log-normal path. The mathematical correctness of
    // the "heavier tails" claim is verified by the sampler-variance tests above
    // and by the fat-tail scenarios in test/scenarios/.
    const portfolioAssumptionsBase = {
      stockReturn: 0.07, stockStdDev: 0.15,
      bondReturn: 0.03, bondStdDev: 0.05,
      stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
    };
    const shared = {
      currentAge: 60, lifeExpectancy: 80,
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'taxable' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      spendingGoals: [],
      incomeEvents: [],
      inflationRate: 0, inflationStdDev: 0,
      simulationSettings: { numSimulations: 1000 },
    };
    const lognormal = makeUserData({
      ...shared,
      portfolioAssumptions: { ...portfolioAssumptionsBase, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
    });
    const tDist = makeUserData({
      ...shared,
      portfolioAssumptions: { ...portfolioAssumptionsBase, returnDistribution: 'student_t', degreesOfFreedom: 4 },
    });
    const logResult = runSimulation(lognormal, createSeededRandom(99));
    const tResult = runSimulation(tDist, createSeededRandom(99));
    // Both should produce valid results
    expect(tResult.probability).toBeGreaterThanOrEqual(0);
    expect(tResult.probability).toBeLessThanOrEqual(100);
    // And they must not be identical (the t path is doing something)
    expect(tResult.median).not.toEqual(logResult.median);
  });
});

describe('runSimulation — percentile band and MC stats', () => {
  const stochasticUserData = makeUserData({
    currentAge: 60,
    lifeExpectancy: 75,
    accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    portfolioAssumptions: { stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.04, bondStdDev: 0.05, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
    inflationRate: 0,
    simulationSettings: { numSimulations: 200 },
  });

  it('returns a percentileBand with one p10/p90 entry per year', () => {
    const result = runSimulation(stochasticUserData, createSeededRandom(7));
    const totalYears = stochasticUserData.lifeExpectancy - stochasticUserData.currentAge + 1;
    expect(result.percentileBand).not.toBeNull();
    expect(result.percentileBand!.p10).toHaveLength(totalYears);
    expect(result.percentileBand!.p90).toHaveLength(totalYears);
  });

  it('p10 <= p90 every year, and p10 == p90 == initial balance at year 0', () => {
    const result = runSimulation(stochasticUserData, createSeededRandom(11));
    const { p10, p90 } = result.percentileBand!;
    const initial = stochasticUserData.accounts.reduce((s, a) => s + a.balance, 0);
    expect(p10[0]).toBeCloseTo(initial, 0);
    expect(p90[0]).toBeCloseTo(initial, 0);
    for (let i = 0; i < p10.length; i++) {
      expect(p10[i]).toBeLessThanOrEqual(p90[i]);
    }
  });

  it('mcStats ending balances bracket the median path final balance', () => {
    const result = runSimulation(stochasticUserData, createSeededRandom(13));
    const lastIdx = result.median.length - 1;
    // p10 ending <= p50 ending; median path's final balance should sit between p10 and p90
    expect(result.mcStats!.p10EndingBalance).toBeLessThanOrEqual(result.mcStats!.medianEndingBalance);
    expect(result.median[lastIdx]).toBeGreaterThanOrEqual(result.mcStats!.p10EndingBalance * 0.5);
  });

  it('mcStats depletion ages are null when nearly all runs survive', () => {
    // No spending, big balance → 0 failures → both depletion ages null.
    const result = runSimulation(stochasticUserData, createSeededRandom(17));
    expect(result.probability).toBe(100);
    expect(result.mcStats!.medianDepletionAge).toBeNull();
    expect(result.mcStats!.worstDecileDepletionAge).toBeNull();
  });

  it('mcStats depletion ages are finite when most runs deplete', () => {
    // Tiny portfolio, huge spending → every run depletes early.
    const depleted = makeUserData({
      currentAge: 60,
      lifeExpectancy: 75,
      accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 50_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      portfolioAssumptions: { stockReturn: 0.03, stockStdDev: 0.05, bondReturn: 0.03, bondStdDev: 0.05, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      inflationRate: 0,
      simulationSettings: { numSimulations: 200 },
      spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 30_000, startAge: 60, inflationAdjusted: false }],
      incomeEvents: [{ id: 'i1', name: 'Other Income 1', type: 'other_income', amount: 1_000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' }],
    });
    const result = runSimulation(depleted, createSeededRandom(23));
    expect(result.mcStats!.medianDepletionAge).not.toBeNull();
    expect(result.mcStats!.worstDecileDepletionAge).not.toBeNull();
    // Worst decile depletes no later than median.
    expect(result.mcStats!.worstDecileDepletionAge!).toBeLessThanOrEqual(result.mcStats!.medianDepletionAge!);
    // Depletion ages are within the plan horizon.
    expect(result.mcStats!.medianDepletionAge!).toBeGreaterThanOrEqual(60);
    expect(result.mcStats!.medianDepletionAge!).toBeLessThanOrEqual(75);
  });

  it('historical_single mode (numRuns === 1) returns null band and null stats', () => {
    const single = makeUserData({
      currentAge: 60,
      lifeExpectancy: 75,
      accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      portfolioAssumptions: {
        stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.04, bondStdDev: 0.05,
        stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        returnModel: 'historical_single', historicalStartYear: 1970,
      },
    });
    const result = runSimulation(single, createSeededRandom(29));
    expect(result.percentileBand).toBeNull();
    expect(result.mcStats).toBeNull();
  });

  it('parametric with numSimulations < 10 returns null band and null stats', () => {
    // Guard threshold is `numRuns < 10` regardless of return model.
    const small = makeUserData({
      currentAge: 60,
      lifeExpectancy: 65,
      accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      portfolioAssumptions: { stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.04, bondStdDev: 0.05, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 5 },
    });
    const result = runSimulation(small, createSeededRandom(31));
    expect(result.percentileBand).toBeNull();
    expect(result.mcStats).toBeNull();
  });
});

describe('runSimulation — deterministic projection reproducibility', () => {
  // The What If chart relies on the nominal/deterministic projection being
  // reproducible across calls — that's what makes Draft and Original lines
  // coincide when no edits have been made. If anyone introduces a stochastic
  // factor into the nominal generator, this test will catch it.
  it('two independent runs on the same UserData produce identical nominal paths', () => {
    const userData = makeUserData({
      currentAge: 60,
      lifeExpectancy: 70,
      accounts: [{ id: 'acct-1', name: 'Traditional 1', type: 'traditional' as const, balance: 750_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      portfolioAssumptions: { stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.04, bondStdDev: 0.05, stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      inflationRate: 0.025,
      simulationSettings: { numSimulations: 50 },
      spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 30_000, startAge: 60, inflationAdjusted: true }],
    });
    // Different random seeds — only the Monte Carlo paths should change.
    // The deterministic (`nominal`) projection should be identical.
    const r1 = runSimulation(userData, createSeededRandom(1));
    const r2 = runSimulation(userData, createSeededRandom(99999));
    expect(r2.nominal).toEqual(r1.nominal);
    expect(r2.nominalInflation).toEqual(r1.nominalInflation);
  });
});

describe('getEffectiveStateName', () => {
  it('returns the first entry for a single-state timeline', () => {
    const ud = makeUserData({ stateTimeline: [{ state: 'Florida' }] });
    expect(getEffectiveStateName(ud, 2026)).toBe('Florida');
    expect(getEffectiveStateName(ud, 2080)).toBe('Florida');
  });

  it('switches to the next entry once startYear is reached', () => {
    const ud = makeUserData({
      stateTimeline: [
        { state: 'California' },
        { state: 'Texas', startYear: 2030 },
      ],
    });
    expect(getEffectiveStateName(ud, 2026)).toBe('California');
    expect(getEffectiveStateName(ud, 2029)).toBe('California');
    expect(getEffectiveStateName(ud, 2030)).toBe('Texas');
    expect(getEffectiveStateName(ud, 2050)).toBe('Texas');
  });

  it('walks multiple future transitions in order', () => {
    const ud = makeUserData({
      stateTimeline: [
        { state: 'California' },
        { state: 'Nevada', startYear: 2030 },
        { state: 'Florida', startYear: 2040 },
      ],
    });
    expect(getEffectiveStateName(ud, 2028)).toBe('California');
    expect(getEffectiveStateName(ud, 2035)).toBe('Nevada');
    expect(getEffectiveStateName(ud, 2045)).toBe('Florida');
  });

  it('stops at the first non-yet-active entry (later entries cannot leapfrog)', () => {
    const ud = makeUserData({
      stateTimeline: [
        { state: 'California' },
        { state: 'Nevada', startYear: 2050 },
        { state: 'Florida', startYear: 2040 },
      ],
    });
    // 2045: Nevada (2050) not yet active, so the walk stops there.
    // Florida's startYear is earlier but appears later in the list — not picked.
    expect(getEffectiveStateName(ud, 2045)).toBe('California');
  });
});

describe('computeMarginalStackAttribution', () => {
  // Helper to build event records (matches accumulateIncome output shape).
  const r = (
    id: string,
    name: string,
    type: string,
    gross: number,
    classification: EventIncomeRecord['classification'],
  ): EventIncomeRecord => ({ eventId: id, eventName: name, eventType: type, gross, classification });

  const baseArgs = {
    ssGross: 0,
    ssTaxableAmount: 0,
    fromTrad: 0,
    rothConversionTotal: 0,
    filingStatus: 'single' as const,
    stateEffectiveRate: 0,
    age: 65,
    taxYear: 2026,
    spouseAge: null,
    inflationRate: 0,
  };

  it('returns empty array when there are no income sources', () => {
    const out = computeMarginalStackAttribution({ ...baseArgs, eventBreakdowns: [] });
    expect(out).toEqual([]);
  });

  it('attributes the full ordinary tax to a single ordinary event', () => {
    // $50k pension, 2026 single, age 65 → std ded $16,100 + senior $2,050 + OBBB $6,000 = $24,150
    // Taxable $25,850 → fed tax $1,240 + $1,614 = $2,854.
    const events = [r('p1', 'Pension', 'pension_income', 50_000, 'ordinary')];
    const out = computeMarginalStackAttribution({ ...baseArgs, eventBreakdowns: events });
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe('p1');
    expect(out[0].marginalTax).toBeCloseTo(2854, 0);
  });

  it('wages absorbed by deductions get 0 marginal tax; pension picks up the rest', () => {
    const events = [
      r('w1', 'Wages', 'wage_income', 20_000, 'ordinary'),
      r('p1', 'Pension', 'pension_income', 30_000, 'ordinary'),
    ];
    const out = computeMarginalStackAttribution({ ...baseArgs, eventBreakdowns: events });
    expect(out).toHaveLength(2);
    expect(out[0].eventId).toBe('w1');
    expect(out[0].marginalTax).toBe(0); // $20k fully absorbed by $24,150 deductions
    expect(out[1].eventId).toBe('p1');
    expect(out[1].marginalTax).toBeCloseTo(2854, 0); // pension brings total tax up
    // Reconciliation: sum should match
    const sum = out.reduce((s, e) => s + e.marginalTax, 0);
    expect(sum).toBeCloseTo(2854, 0);
  });

  it('pre-tax contribution reduces the cumulative ordinary stack', () => {
    // $50k wages + $10k pre-tax 401k → ordinary stack = $40k, tax on $40k - $24,150 = $15,850.
    const events = [
      r('w1', 'Wages', 'wage_income', 50_000, 'ordinary'),
      r('c1', '401k', 'retirement_contribution', 10_000, 'pre_tax_contribution'),
    ];
    const out = computeMarginalStackAttribution({ ...baseArgs, eventBreakdowns: events });
    expect(out).toHaveLength(2);
    expect(out[1].taxableContribution).toBe(-10_000);
    expect(out[1].marginalTax).toBeLessThan(0); // tax reduced
    // After pre-tax: tax on $40k (taxable $15,850 → fed tax 10%*$12,400 + 12%*$3,450 = $1,654)
    // After wages alone: tax on $50k (taxable $25,850 → $2,854)
    // Pre-tax marginal = $1,654 - $2,854 = -$1,200
    expect(out[0].marginalTax + out[1].marginalTax).toBeCloseTo(1654, 0);
  });

  it('pre-tax greater than wages floors cumulative at zero', () => {
    const events = [
      r('w1', 'Wages', 'wage_income', 10_000, 'ordinary'),
      r('c1', '401k', 'retirement_contribution', 15_000, 'pre_tax_contribution'),
    ];
    const out = computeMarginalStackAttribution({ ...baseArgs, eventBreakdowns: events });
    // Wage step: $10k cumulative, fully absorbed by deductions → tax 0.
    // Pre-tax step: cumulative max(0, $10k - $15k) = 0 → tax still 0. Marginal = 0 - 0 = 0.
    expect(out[0].marginalTax).toBe(0);
    expect(out[1].marginalTax).toBe(0);
  });

  it('synthetic Traditional withdrawal appears as a stack step', () => {
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: [r('p1', 'Pension', 'pension_income', 20_000, 'ordinary')],
      fromTrad: 30_000,
    });
    expect(out).toHaveLength(2);
    expect(out[1].eventId).toBe(SYNTHETIC_TRAD_WITHDRAWAL_ID);
    expect(out[1].gross).toBe(30_000);
    // Total ordinary $50k, same tax as wages+pension test
    const sum = out.reduce((s, e) => s + e.marginalTax, 0);
    expect(sum).toBeCloseTo(2854, 0);
  });

  it('roth conversion event appears as a stack step with proportional scaling', () => {
    // User requested $30k conversion but actual was capped at $20k.
    const events = [
      r('p1', 'Pension', 'pension_income', 20_000, 'ordinary'),
      r('rc1', 'Roth Conv', 'roth_conversion', 30_000, 'roth_conversion'),
    ];
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      fromTrad: 20_000,           // = conversion only (no spending pull)
      rothConversionTotal: 20_000, // capped at $20k
    });
    const convOut = out.find((e) => e.eventId === 'rc1');
    expect(convOut).toBeDefined();
    expect(convOut!.gross).toBeCloseTo(20_000, 4); // scaled down to actual
  });

  it('two SS events split the SS step proportionally by gross', () => {
    // Self SS $20k + spouse SS $10k, no other income.
    // Total SS $30k; provisional = $15k (50% × $30k) → below $25k single threshold → 0 taxable.
    // So ssTaxableAmount = 0, marginal tax for the SS step = 0. Use a higher provisional
    // bump to actually trigger taxability.
    const events = [
      r('p1', 'Pension', 'pension_income', 50_000, 'ordinary'),
      r('ss1', 'My SS', 'social_security', 20_000, 'social_security'),
      r('ss2', 'Spouse SS', 'social_security', 10_000, 'social_security'),
    ];
    // For single age 65: provisional = $50k + $15k = $65k > $34k → 85% zone.
    // ssTaxable = min(0.85*(65000-34000) + min(4500, 0.5*30000), 0.85*30000) = min(30850, 25500) = 25500.
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      ssGross: 30_000,
      ssTaxableAmount: 25_500,
    });
    const ssRows = out.filter((e) => e.eventType === 'social_security');
    expect(ssRows).toHaveLength(2);
    // Proportional split: 20/30 vs 10/30
    expect(ssRows[0].marginalTax / ssRows[1].marginalTax).toBeCloseTo(2.0, 2);
  });

  it('reconciliation: sum of marginal taxes equals total ordinary tax', () => {
    const events = [
      r('w1', 'Wages', 'wage_income', 40_000, 'ordinary'),
      r('p1', 'Pension', 'pension_income', 25_000, 'ordinary'),
      r('ss1', 'SS', 'social_security', 24_000, 'social_security'),
    ];
    // Ordinary gross $65k. Provisional = $65k + $12k = $77k > $34k → 85% zone.
    // ssTaxable = min(0.85*(77000-34000) + 4500, 0.85*24000) = min(41050, 20400) = 20400.
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      ssGross: 24_000,
      ssTaxableAmount: 20_400,
    });
    // Computed total ordinary tax via the same path:
    //   combinedTaxable = $65k + $20.4k = $85.4k
    //   deductions = $24,150 (single age 65, 2026, OBBB phaseout: gross > $75k → reduction)
    //   OBBB: $6000 - 6%*($85,400 - $75,000) = $6000 - $624 = $5,376
    //   total dedns = $16,100 + $2,050 + $5,376 = $23,526
    //   taxable = $61,874 → fed tax 10%*$12,400 + 12%*$38,000 + 22%*$11,474 = $1,240 + $4,560 + $2,524.28 = $8,324.28
    const sum = out.reduce((s, e) => s + e.marginalTax, 0);
    expect(sum).toBeCloseTo(8324, 0);
  });

  it('reconciliation with non-zero stateEffectiveRate: sum ≈ federal + state·combinedTaxable', () => {
    const events: EventIncomeRecord[] = [
      { eventId: 'w1', eventName: 'Wages', eventType: 'wage_income', gross: 50_000, classification: 'ordinary' },
      { eventId: 'p1', eventName: 'Pension', eventType: 'pension_income', gross: 50_000, classification: 'ordinary' },
    ];
    const stateRate = 0.05;
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      stateEffectiveRate: stateRate,
    });
    // combinedTaxable = $100k; for single age 65 in 2026 the federal portion
    // matches the existing fixtures (see prior tests in this block). With state
    // distributed proportionally at 5%, the sum should add 0.05 × $100k = $5,000
    // on top of the federal-only marginal-stack total.
    const outFederalOnly = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      stateEffectiveRate: 0,
    });
    const fedSum = outFederalOnly.reduce((s, e) => s + e.marginalTax, 0);
    const stateSum = out.reduce((s, e) => s + e.marginalTax, 0);
    expect(stateSum - fedSum).toBeCloseTo(stateRate * 100_000, 0);
  });
});

describe('audit.accountFlows (via runSimulation)', () => {
  it('captures pro-rata withdrawals across two Traditional accounts', () => {
    const ud = makeUserData({
      currentAge: 73,
      lifeExpectancy: 75,
      spendingGoals: [baseSpending(2000)], // $24k/yr forces a withdrawal
      accounts: [
        { id: 'trad-a', name: 'Trad A', type: 'traditional', balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-b', name: 'Trad B', type: 'traditional', balance: 100_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 100 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    expect(bd.audit).toBeDefined();
    expect(bd.audit!.accountFlows).toBeDefined();
    const tradRows = bd.audit!.accountFlows!.filter((r) => r.accountType === 'traditional');
    // Both Traditional accounts should appear (RMD forces pull from both, pro-rata).
    const ids = tradRows.map((r) => r.accountId).sort();
    expect(ids).toEqual(['trad-a', 'trad-b']);
    // Pro-rata: 2:1 ratio (200k : 100k)
    const aRow = tradRows.find((r) => r.accountId === 'trad-a')!;
    const bRow = tradRows.find((r) => r.accountId === 'trad-b')!;
    expect(aRow.withdrawal / bRow.withdrawal).toBeCloseTo(2.0, 1);
  });

  it('captures surplus deposit into the synthetic Reinvestment account', () => {
    // High income, no spending, no taxable account → surplus auto-creates Reinvestment.
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 61,
      incomeEvents: [
        {
          id: 'pension',
          type: 'pension_income',
          name: 'Pension',
          amount: 50_000,
          startAge: 60,
          taxStatus: 'after_tax',
          colaType: 'fixed',
        } as any,
      ],
      accounts: [
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 100_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      simulationSettings: { numSimulations: 50 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    const reinvest = bd.audit!.accountFlows!.find((r) => r.accountId === 'reinvestment-auto');
    expect(reinvest).toBeDefined();
    expect(reinvest!.deposit).toBeGreaterThan(0);
  });
});

describe('resolveSpendingWithdrawalOrder', () => {
  it('returns the explicit field value when set', () => {
    expect(
      resolveSpendingWithdrawalOrder(makeUserData({ spendingWithdrawalOrder: 'taxable_first' })),
    ).toBe('taxable_first');
    expect(
      resolveSpendingWithdrawalOrder(makeUserData({ spendingWithdrawalOrder: 'bracket_aware' })),
    ).toBe('bracket_aware');
  });

  it("defaults to 'taxable_first' when no roth_conversion event exists", () => {
    expect(resolveSpendingWithdrawalOrder(makeUserData())).toBe('taxable_first');
  });

  it("defaults to 'bracket_aware' when any roth_conversion event exists", () => {
    const ud = makeUserData({
      incomeEvents: [{
        id: 'conv-1', type: 'roth_conversion', name: 'Conv', amount: 25_000,
        startAge: 65, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed',
      }],
    });
    expect(resolveSpendingWithdrawalOrder(ud)).toBe('bracket_aware');
  });

  it('honors an explicit override even when a conversion exists', () => {
    const ud = makeUserData({
      spendingWithdrawalOrder: 'taxable_first',
      incomeEvents: [{
        id: 'conv-1', type: 'roth_conversion', name: 'Conv', amount: 25_000,
        startAge: 65, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed',
      }],
    });
    expect(resolveSpendingWithdrawalOrder(ud)).toBe('taxable_first');
  });

  it('falls back to the content-aware default when the field holds an unknown value', () => {
    // Legacy 'pro_rata' (dropped from the enum) and outright typos must not
    // silently behave like taxable_first with no signal — they fall through
    // to the content-aware default. This is the S3 fix.
    const noConv = makeUserData({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spendingWithdrawalOrder: 'pro_rata' as any,
    });
    expect(resolveSpendingWithdrawalOrder(noConv)).toBe('taxable_first');
    const withConv = makeUserData({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spendingWithdrawalOrder: 'foobar' as any,
      incomeEvents: [{
        id: 'conv-1', type: 'roth_conversion', name: 'Conv', amount: 25_000,
        startAge: 65, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed',
      }],
    });
    expect(resolveSpendingWithdrawalOrder(withConv)).toBe('bracket_aware');
  });
});

describe('computeBracketHeadroomForTrad', () => {
  // Minimal AccumulatedIncome stub — only the fields the helper reads.
  const incomeOf = (overrides: { ssGross?: number; otherTaxableGross?: number; conversionGross?: number } = {}) => ({
    ssGross: overrides.ssGross ?? 0,
    otherTaxableGross: overrides.otherTaxableGross ?? 0,
    afterTaxIncome: 0,
    conversionGross: overrides.conversionGross ?? 0,
    wageIncomeGross: 0,
    preTaxContributions: 0,
    rothContributions: 0,
    afterTaxContributions: 0,
    employerMatch: 0,
    contributions: [],
    contributionsCappedAmount: 0,
    eventBreakdowns: [],
  });

  // Default test ages: 60-year-old single filer, no spouse, no senior bonus.
  const AGE_NO_SENIOR = 60;
  const NO_SPOUSE = null;

  it('returns top-of-12% + standard-deduction headroom when baseline is zero', () => {
    // 2026 single: 12% ceiling 50400, std ded 16100 (no senior bonus at age 60).
    // Headroom = top_of_12% − max(0, 0 − stdDed) = top_of_12% − 0 = 50400.
    const headroom = computeBracketHeadroomForTrad(makeUserData(), incomeOf(), 2026, 0, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroom).toBe(50400);
  });

  it('shrinks headroom when a conversion partially fills the bracket', () => {
    // 2026 single age 60: std ded 16100, conv $50k → baseline taxable income 33900.
    // Headroom = 50400 − 33900 = 16500.
    const headroom = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ conversionGross: 50_000 }), 2026, 0, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroom).toBeGreaterThan(15_000);
    expect(headroom).toBeLessThan(17_000);
  });

  it('clamps headroom to zero when baseline ordinary already exceeds the 12% bracket', () => {
    const headroom = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ otherTaxableGross: 100_000 }), 2026, 0, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroom).toBe(0);
  });

  it('includes SS-taxable in the baseline (regression for the H1 bug)', () => {
    // Single, SS $25k, no other income, no conversion.
    // Provisional income = 0 + 0.5*25k = 12500 < 25k threshold → ssTaxable = 0.
    const headroomLowSS = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ ssGross: 25_000 }), 2026, 0, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroomLowSS).toBe(50400);

    // Single, SS $30k, conv $50k. Conv lifts provisional income past the 85% threshold.
    // baselineTaxable ≈ $50k + 85%×$30k − $16.1k ≈ $59,400 > top_of_12% ($50,400) → headroom = 0.
    const headroomHighSS = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ ssGross: 30_000, conversionGross: 50_000 }), 2026, 0, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroomHighSS).toBe(0);
  });

  it('inflation-indexes the top-of-12% ceiling and standard deduction', () => {
    const headroom2030 = computeBracketHeadroomForTrad(makeUserData(), incomeOf(), 2030, 0.03, AGE_NO_SENIOR, NO_SPOUSE);
    expect(headroom2030).toBeCloseTo(50400 * Math.pow(1.03, 4), 0);
  });

  it('includes the senior bonus in the deduction for age 65+ filers (T1 regression)', () => {
    // 2026 single age 60, conv $30k: baselineTaxable = 30000 − 16100 = 13900.
    // Headroom = 50400 − 13900 = 36500.
    const headroomYoung = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ conversionGross: 30_000 }), 2026, 0, 60, NO_SPOUSE);
    expect(headroomYoung).toBe(36500);

    // Same scenario but age 65: senior bonus $2050 → total deduction 18150 →
    // baselineTaxable = 30000 − 18150 = 11850. Headroom = 50400 − 11850 = 38550.
    // Without the T1 fix the senior bonus is ignored and headroom = 36500.
    const headroomSenior = computeBracketHeadroomForTrad(makeUserData(), incomeOf({ conversionGross: 30_000 }), 2026, 0, 65, NO_SPOUSE);
    expect(headroomSenior).toBe(38550);
    expect(headroomSenior - headroomYoung).toBe(2050);
  });

  it('counts both seniors for MFJ when both filers are age 65+', () => {
    const ud = makeUserData({ filingStatus: 'mfj', spouseAge: 65 });
    // 2026 MFJ both 65+: base 32200, senior extra 1650 × 2 = 3300, total 35500.
    // No conv: baselineTaxable = 0. Headroom = top_of_12% MFJ 2026 = 100800.
    const headroomBothSeniors = computeBracketHeadroomForTrad(ud, incomeOf(), 2026, 0, 65, 65);
    expect(headroomBothSeniors).toBe(100800);

    // Add $80k conv → baselineTaxable = 80000 − 35500 = 44500. Headroom = 100800 − 44500 = 56300.
    const headroomWithConv = computeBracketHeadroomForTrad(ud, incomeOf({ conversionGross: 80_000 }), 2026, 0, 65, 65);
    expect(headroomWithConv).toBe(56300);
  });
});

describe('bracket_aware spending waterfall — coordination invariant', () => {
  // The plan promised: in years where the bracket-aware Trad spending pull is
  // active AND Taxable can absorb the spending overflow (no spill to
  // Trad-above-headroom), federal bracket index stays ≤ 1 (the 12% bracket).
  // When Taxable runs out the spillover falls to Trad-above-headroom and
  // bracket may exceed 12% — that's the existing taxable_first fallback,
  // not a bracket_aware violation. The scenario below sizes Taxable large
  // enough that the invariant holds across the full conv window.
  it('keeps federalBracketIndex ≤ 1 across the conv window when Taxable absorbs the overflow', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 64,
      spendingGoals: [{
        id: 'living-1', name: 'Living', type: 'living_expenses' as const,
        amount: 60_000, amountPeriod: 'annual' as const, startAge: 60,
        isOneTime: false, inflationAdjusted: false,
      }],
      incomeEvents: [{
        id: 'conv-1', type: 'roth_conversion', name: 'Conv', amount: 50_000,
        startAge: 60, endAge: 62, isOneTime: false, taxStatus: 'before_tax', colaType: 'fixed',
      }],
      accounts: [
        { id: 't-1', name: 'Trad 1', type: 'traditional', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'r-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0, portfolioBalance: '60_40' as const },
        // Taxable large enough to absorb 3 years of spending overflow + conv tax + LTCG cascade.
        { id: 'b-1', name: 'Taxable 1', type: 'taxable', balance: 400_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      simulationSettings: { numSimulations: 10 },
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
    });
    const result = runSimulation(ud, createSeededRandom(42));
    // First 3 years are conv-active.
    for (let i = 0; i < 3; i++) {
      const bd = result.nominalBreakdowns[i];
      expect(bd.rothConversionGross).toBeGreaterThan(0);  // conv firing
      // bracketIndex 0 = 10%, 1 = 12%. The smart-default headroom guarantees
      // the conv + Trad spending pull stay within the 12% bracket so long as
      // Taxable absorbs the spending overflow.
      expect(bd.audit!.federalBracketIndex).toBeLessThanOrEqual(1);
    }
  });
});
