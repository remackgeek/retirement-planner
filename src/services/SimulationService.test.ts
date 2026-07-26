import { describe, it, expect } from 'vitest';
import {
  calculateAnnualCashFlow,
  calculateRMD,
  getRmdStartAge,
  computeBracketHeadroomForTrad,
  computeMarginalStackAttribution,
  getEffectiveStateName,
  IRS_UNIFORM_LIFETIME_TABLE,
  runDeterministicProjection,
  runFastPreview,
  runSimulation,
  selectBestSpendingOrder,
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
    it('applies default 22% haircut from 2032', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2032, 0);
      expect(result.ssGross).toBe(23400);
      expect(result.netCashFlow).toBe(23400);
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

    it('does not apply haircut before 2032', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true },
        ],
      });
      const result = calculateAnnualCashFlow(userData, 2031, 0);
      expect(result.netCashFlow).toBe(30000);
    });

    it('honors a custom ssHaircutYear', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true, ssHaircutYear: 2040 },
        ],
      });
      // Default-year (2032) haircut would apply, but the custom 2040 year defers it.
      expect(calculateAnnualCashFlow(userData, 2032, 0).netCashFlow).toBe(30000);
      expect(calculateAnnualCashFlow(userData, 2040, 0).netCashFlow).toBe(23400);
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
          { id: 'tx', name: 'Brokerage', type: 'brokerage', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
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
        accounts: [{ id: 'tax-1', name: 'Taxable 1', type: 'brokerage', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
        longTermCapGainsRate: 0.15,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 50000, startAge: 60, inflationAdjusted: false }],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      // Solver: W = 50k + 0.15*W → W = 50k/0.85 ≈ 58,824; LTCG tax ≈ 8,824
      expect(result.withdrawalFromBrokerage).toBeCloseTo(58824, 0);
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

    it('brokerage withdrawal (capital gains) increases SS provisional income', () => {
      // Capital gains are part of AGI, so a brokerage pull raises SS provisional
      // income just like a Traditional pull does (unlike Roth principal, which is
      // not in AGI). Same shape as the Roth/Trad cases above. LTCG rate 0 isolates
      // the provisional-income mechanic; the standard deduction absorbs the taxable
      // SS, so there is no tax feedback and the brokerage pull is exactly the $20k gap.
      // Provisional = 20k LTCG + 0.5*20k SS = 30k → single 50% zone (t1 25k, t2 34k)
      // → ssTaxable = min(0.5*(30k-25k), 0.5*20k) = 2,500.
      // Before the fix, brokerage was excluded from provisional (10k < 25k) → ssTaxable 0.
      const brokUserData = makeUserData({
        accounts: [{ id: 'brok-1', name: 'Taxable 1', type: 'brokerage', balance: 500000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
        longTermCapGainsRate: 0,
        incomeEvents: [
          { id: '1', name: 'Social Security 1', type: 'social_security', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 40000, startAge: 60, inflationAdjusted: false }],
      });
      const brokResult = calculateAnnualCashFlow(brokUserData, 2026, 0);
      expect(brokResult.withdrawalFromBrokerage).toBeGreaterThan(0);
      expect(brokResult.ssTaxableAmount).toBeCloseTo(2500, 0);
    });

    it('draws from taxable first, then traditional, with explicit accountBalances', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'tax-1', name: 'Taxable 1', type: 'brokerage', balance: 30000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        longTermCapGainsRate: 0,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 60000, startAge: 60, inflationAdjusted: false }],
      });
      // Taxable only has 30k (0% LTCG). Remaining ~30k+ comes from traditional.
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.withdrawalFromBrokerage).toBe(30000); // exhausted
      expect(result.withdrawalFromTraditional).toBeGreaterThan(0);
      expect(result.withdrawalFromRoth).toBe(0); // roth not touched yet
      expect(result.portfolioWithdrawal).toBeCloseTo(
        result.withdrawalFromBrokerage + result.withdrawalFromTraditional + result.withdrawalFromRoth, 0
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
      expect(result.withdrawalFromBrokerage).toBe(0);
      expect(result.withdrawalFromTraditional).toBe(0);
    });

    it('per-bucket withdrawals sum to portfolioWithdrawal', () => {
      const userData = makeUserData({
        accounts: [
          { id: 'tax-1', name: 'Taxable 1', type: 'brokerage', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
          { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 20000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        ],
        longTermCapGainsRate: 0.15,
        spendingGoals: [{ id: 's1', name: 'Living Expenses 1', type: 'living_expenses', amount: 50000, startAge: 60, inflationAdjusted: false }],
      });
      const result = calculateAnnualCashFlow(userData, 2026, 0);
      expect(result.portfolioWithdrawal).toBeCloseTo(
        result.withdrawalFromBrokerage + result.withdrawalFromTraditional + result.withdrawalFromRoth, 0
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
      // Walking CA 2024 single brackets: 1%·10,756 + 2%·14,743 + 4%·14,746 + 6%·15,621 + 8%·14,740 + 9.3%·23,854 ≈ $5,327.
      // Federal tax on $100k − $16,100 = $83,900 taxable → $13,170.
      expect(result.totalTax).toBeGreaterThan(5000); // federal + state
      const flResult = calculateAnnualCashFlow(makeUserData({
        stateTimeline: [{ state: 'Florida' }],
        incomeEvents: [
          { id: '1', name: 'Pension Income 1', type: 'pension_income', amount: 100000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      }), 2026, 0);
      expect(result.totalTax - flResult.totalTax).toBeCloseTo(5327, 0);
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
      // Before: CA tax ≈ $5,327 on $100k pension (graduated 2024 brackets above std ded). After: FL 0%.
      expect(before.totalTax - after.totalTax).toBeCloseTo(5327, 0);
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

  it('returns medianBreakdowns with one entry per year', () => {
    const result = runSimulation(depletionUserData);
    const totalYears = depletionUserData.lifeExpectancy - depletionUserData.currentAge + 1;
    expect(result.medianBreakdowns).toHaveLength(totalYears);
  });

  it('non-depleted years show full withdrawal and correct tax', () => {
    const { medianBreakdowns } = runSimulation(depletionUserData);
    // Years 0–2: $15k withdrawal, tax = 0 (after_tax income only, no taxable income)
    for (let i = 0; i <= 2; i++) {
      expect(medianBreakdowns[i].portfolioWithdrawal).toBeCloseTo(15_000, 0);
      expect(medianBreakdowns[i].totalTax).toBe(0);
      expect(medianBreakdowns[i].netCashFlow).toBeCloseTo(-15_000, 0);
    }
  });

  it('partially depleting year caps withdrawal at remaining balance', () => {
    const { medianBreakdowns } = runSimulation(depletionUserData);
    // Year 3: only $5k left, so withdrawal is capped at $5k (not the $15k need)
    expect(medianBreakdowns[3].portfolioWithdrawal).toBeCloseTo(5_000, 0);
    expect(medianBreakdowns[3].totalTax).toBe(0); // $5k < standard deduction
    expect(medianBreakdowns[3].netCashFlow).toBeCloseTo(-5_000, 0);
  });

  it('fully depleted year shows zero withdrawal and correctly recomputed zero tax', () => {
    const { medianBreakdowns } = runSimulation(depletionUserData);
    // Year 4: portfolio is $0, no withdrawal possible
    expect(medianBreakdowns[4].portfolioWithdrawal).toBe(0);
    expect(medianBreakdowns[4].totalTax).toBe(0);
    expect(medianBreakdowns[4].netCashFlow).toBe(0);
  });

  it('income and spending fields are unchanged by depletion', () => {
    const { medianBreakdowns } = runSimulation(depletionUserData);
    // Income and spending are deterministic — same in all years for this scenario
    for (const bd of medianBreakdowns) {
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
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'brokerage' as const, balance: 300_000, stockAllocation: 1, portfolioBalance: '80_20' as const }],
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
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'brokerage' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
    });
    const result = runSimulation(userData);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(100);
    expect(result.median.length).toBe(6); // ages 60–65 inclusive
    expect(result.nominal.every(v => Number.isFinite(v))).toBe(true);
  });
});

describe('getRmdStartAge (SECURE 2.0 birth-year schedule)', () => {
  it('returns 72 for born 1950 or earlier', () => {
    expect(getRmdStartAge(1950)).toBe(72);
    expect(getRmdStartAge(1945)).toBe(72);
  });
  it('returns 73 for born 1951-1959', () => {
    expect(getRmdStartAge(1951)).toBe(73);
    expect(getRmdStartAge(1959)).toBe(73);
  });
  it('returns 75 for born 1960 or later', () => {
    expect(getRmdStartAge(1960)).toBe(75);
    expect(getRmdStartAge(1975)).toBe(75);
  });
  it('falls back to 72 for non-finite input (never over-defers)', () => {
    expect(getRmdStartAge(NaN)).toBe(72);
  });
});

describe('calculateRMD', () => {
  it('returns 0 for age below 73', () => {
    expect(calculateRMD(500000, 72)).toBe(0);
    expect(calculateRMD(500000, 65)).toBe(0);
    expect(calculateRMD(500000, 0)).toBe(0);
  });

  it('honors an explicit rmdStartAge of 75 (SECURE 2.0 born-1960+ cohort)', () => {
    // No RMD at 73/74 when the start age is 75; first RMD at 75.
    expect(calculateRMD(500000, 73, 75)).toBe(0);
    expect(calculateRMD(500000, 74, 75)).toBe(0);
    expect(calculateRMD(500000, 75, 75)).toBeCloseTo(500000 / 24.6, 2);
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
      accounts: [{ id: 'acct-1', name: 'Taxable 1', type: 'brokerage' as const, balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
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
    owner: 'self' | 'spouse' = 'self',
  ): EventIncomeRecord => ({ eventId: id, eventName: name, eventType: type, gross, classification, owner });

  const baseArgs = {
    ssGross: 0,
    ssTaxableAmount: 0,
    fromTrad: 0,
    rothConversionTotal: 0,
    // Default the per-owner totals to mirror the aggregate (single-owner default).
    // Tests that exercise per-owner scaling override these explicitly.
    rothConversionTotalSelf: 0,
    rothConversionTotalSpouse: 0,
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
      // Single-owner default (Self) — mirrors the aggregate.
      rothConversionTotalSelf: 20_000,
    });
    const convOut = out.find((e) => e.eventId === 'rc1');
    expect(convOut).toBeDefined();
    expect(convOut!.gross).toBeCloseTo(20_000, 4); // scaled down to actual
  });

  it('per-owner conversion scaling: Self capped, Spouse uncapped → events scale independently', () => {
    // Self event requests $50k but Self-Trad caps at $40k. Spouse event requests
    // $30k and Spouse-Trad has plenty. Per-owner scale should give Self $40k and
    // Spouse $30k (uniform scale 70/80=0.875 would mis-show $43.75k / $26.25k).
    const events = [
      r('rcS', 'Self Conv',   'roth_conversion', 50_000, 'roth_conversion', 'self'),
      r('rcP', 'Spouse Conv', 'roth_conversion', 30_000, 'roth_conversion', 'spouse'),
    ];
    const out = computeMarginalStackAttribution({
      ...baseArgs,
      eventBreakdowns: events,
      fromTrad: 70_000,
      rothConversionTotal:       70_000,
      rothConversionTotalSelf:   40_000,
      rothConversionTotalSpouse: 30_000,
    });
    const selfOut   = out.find(e => e.eventId === 'rcS');
    const spouseOut = out.find(e => e.eventId === 'rcP');
    expect(selfOut!.gross).toBeCloseTo(40_000, 4);
    expect(spouseOut!.gross).toBeCloseTo(30_000, 4);
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
      { eventId: 'w1', eventName: 'Wages', eventType: 'wage_income', gross: 50_000, classification: 'ordinary', owner: 'self' },
      { eventId: 'p1', eventName: 'Pension', eventType: 'pension_income', gross: 50_000, classification: 'ordinary', owner: 'self' },
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
    // Both accounts omit `owner`, so they default to 'self'. The engine routes
    // the entire RMD through Pass 1 (Self) which pro-rates across both — the
    // expected behavior. For mixed-owner verification see the dedicated
    // 'rmdByAccount honors per-owner RMD discipline' test below.
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

  it('rmdByAccount honors per-owner RMD discipline (Spouse-owned Trad untouched when only Self is at RMD age)', () => {
    // IRS rule: each owner's RMD must come from their own Traditional accounts.
    // This locks in the engine fix that splits the Trad withdrawal into three
    // passes — Self RMD from Self-owned only, Spouse RMD from Spouse-owned only,
    // and non-RMD (discretionary + conversion) pro-rata across all Trad.
    const ud = makeUserData({
      currentAge: 75, // Self at RMD age
      spouseAge: 65,  // Spouse not yet at RMD age
      lifeExpectancy: 76,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [],
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 800_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 200_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    expect(bd.rmdRequiredSelf).toBeGreaterThan(0);
    expect(bd.rmdRequiredSpouse).toBe(0);
    const rmdRows = bd.audit!.rmdByAccount!;
    const selfRow   = rmdRows.find(r => r.accountId === 'trad-self');
    const spouseRow = rmdRows.find(r => r.accountId === 'trad-spouse');
    // All RMD comes from Self-owned Trad; Spouse-owned Trad has zero RMD.
    expect(selfRow).toBeDefined();
    expect(selfRow!.withdrawal).toBeCloseTo(bd.rmdRequired, 0);
    expect(spouseRow).toBeUndefined(); // sink rows for zero amounts are not emitted
    // Conservation: per-account RMD sums to rmdRequired.
    const sum = rmdRows.reduce((s, r) => s + r.withdrawal, 0);
    expect(Math.abs(sum - bd.rmdRequired)).toBeLessThan(1);
  });

  it('mixed-owner Trad with both RMD and discretionary spending: RMD per-owner, discretionary pro-rata', () => {
    // Self age 75 with $800k Self-Trad, Spouse age 65 with $200k Spouse-Trad,
    // big living-expense forces the engine to pull beyond just RMD. Expected:
    //  - Pass 1 (Self RMD): Self-Trad gives up rmdSelf, Spouse-Trad untouched.
    //  - Pass 3 (non-RMD): the remaining discretionary withdrawal pro-rates
    //    across BOTH Trad accounts based on their (post-Pass-1) balances.
    // So Spouse-Trad SHOULD appear in accountFlows (it contributes to non-RMD)
    // but SHOULD NOT appear in rmdByAccount (zero RMD share).
    const ud = makeUserData({
      currentAge: 75,
      spouseAge: 65,
      lifeExpectancy: 76,
      filingStatus: 'mfj',
      spendingGoals: [baseSpending(8000)], // $96k/yr — way above RMD
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 800_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 200_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    const flows = bd.audit!.accountFlows!;
    const rmdRows = bd.audit!.rmdByAccount!;

    // rmdByAccount: only Self contributes RMD (per-owner discipline).
    expect(rmdRows.find(r => r.accountId === 'trad-self')?.withdrawal).toBeCloseTo(bd.rmdRequired, 0);
    expect(rmdRows.find(r => r.accountId === 'trad-spouse')).toBeUndefined();
    // Conservation: per-account RMD sums to rmdRequired.
    const rmdSum = rmdRows.reduce((s, r) => s + r.withdrawal, 0);
    expect(Math.abs(rmdSum - bd.rmdRequired)).toBeLessThan(1);

    // accountFlows: BOTH accounts have non-zero outflow (Spouse-Trad gets a
    // pro-rata share of the non-RMD discretionary pull, even with zero RMD).
    const selfFlow   = flows.find(f => f.accountId === 'trad-self')!;
    const spouseFlow = flows.find(f => f.accountId === 'trad-spouse')!;
    expect(selfFlow.withdrawal).toBeGreaterThan(bd.rmdRequired); // Self pays RMD + Self's share of non-RMD
    expect(spouseFlow.withdrawal).toBeGreaterThan(0); // Spouse contributes to non-RMD only
    // Conservation: per-account withdrawals sum to withdrawalFromTraditional.
    const tradSum = selfFlow.withdrawal + spouseFlow.withdrawal;
    expect(Math.abs(tradSum - bd.withdrawalFromTraditional)).toBeLessThan(1);
    // The non-RMD portion pro-rates 4:1 (post-Pass-1 balances: $800k-rmdSelf vs $200k).
    const nonRmdSelf   = selfFlow.withdrawal - bd.rmdRequired;
    const nonRmdSpouse = spouseFlow.withdrawal;
    const totalNonRmd = nonRmdSelf + nonRmdSpouse;
    // Self's share of non-RMD ≈ (800k - rmdSelf) / (800k - rmdSelf + 200k)
    const expectedSelfShare = (800_000 - bd.rmdRequired) / (800_000 - bd.rmdRequired + 200_000);
    expect(nonRmdSelf / totalNonRmd).toBeCloseTo(expectedSelfShare, 2);
  });

  it('rmdByAccount empty when no RMD is active (pre-73)', () => {
    const ud = makeUserData({
      currentAge: 70,
      lifeExpectancy: 71,
      spendingGoals: [],
      accounts: [
        { id: 'trad-a', name: 'Trad A', type: 'traditional', balance: 100_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    expect(bd.rmdRequired).toBe(0);
    expect(bd.audit!.rmdByAccount).toEqual([]);
  });

  it('Self-only conversion in mixed-owner household: only Self-Trad drains, only Self-Roth gains', () => {
    // IRS rule: a Roth conversion moves Self's Trad to Self's Roth — Spouse's
    // Trad cannot fund it and Spouse's Roth cannot receive it.
    const ud = makeUserData({
      currentAge: 65,
      spouseAge: 65,
      lifeExpectancy: 66,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcS', type: 'roth_conversion', name: 'Self Conv', amount: 50_000, startAge: 65, owner: 'self', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 500_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 200_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self',   name: 'Self Roth',   type: 'roth',        balance: 0,       owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-spouse', name: 'Spouse Roth', type: 'roth',        balance: 0,       owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        // Brokerage account to fund the conversion's ordinary tax (so no withholding).
        { id: 'brok',        name: 'Brokerage',   type: 'brokerage',   balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];

    // Per-owner conversion gross is the load-bearing invariant: Self gross
    // = full $50k, Spouse gross = 0. The aggregate Trad pull may be slightly
    // larger when bracket-aware spending fills a few dollars of headroom from
    // the LTCG cascade triggered by Brokerage-funded conv tax — that pro-rata
    // pull legitimately touches both Trad accounts and is correct IRS-wise
    // (no per-owner constraint on the discretionary remainder).
    expect(bd.rothConversionGross).toBeCloseTo(50_000, 0);
    expect(bd.rothConversionGrossSelf).toBeCloseTo(50_000, 0);
    expect(bd.rothConversionGrossSpouse).toBe(0);

    const flows = bd.audit!.accountFlows!;
    const selfTradFlow   = flows.find(f => f.accountId === 'trad-self')!;
    const spouseTradFlow = flows.find(f => f.accountId === 'trad-spouse');
    // Self-Trad carries at least the full conversion principal.
    expect(selfTradFlow.withdrawal).toBeGreaterThanOrEqual(50_000);
    // Spouse-Trad carries at most the tiny pro-rata discretionary share —
    // orders of magnitude smaller than the Self conversion. Asserting Spouse-Trad
    // is "small" rather than "exactly zero" because the IRS-correct behavior
    // does pro-rate any discretionary spending pull across all Trad. Absent row
    // = $0 pull; the `?? 0` keeps the assertion live either way (a bare
    // `if (flow)` guard would pass vacuously if the row lookup ever broke).
    expect(spouseTradFlow?.withdrawal ?? 0).toBeLessThan(100);
    // Self-Roth receives the deposit; Spouse-Roth untouched (no Spouse conv).
    const selfRothFlow   = flows.find(f => f.accountId === 'roth-self')!;
    const spouseRothFlow = flows.find(f => f.accountId === 'roth-spouse');
    expect(selfRothFlow.deposit).toBeCloseTo(50_000, 0);
    expect(spouseRothFlow).toBeUndefined();
  });

  it('Both-owner conversions in the same year route to their own Trad/Roth pairs', () => {
    const ud = makeUserData({
      currentAge: 60,
      spouseAge: 60,
      lifeExpectancy: 61,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcS', type: 'roth_conversion', name: 'Self Conv',   amount: 30_000, startAge: 60, owner: 'self',   taxStatus: 'before_tax', colaType: 'fixed' },
        { id: 'rcP', type: 'roth_conversion', name: 'Spouse Conv', amount: 20_000, startAge: 60, owner: 'spouse', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 400_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 300_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self',   name: 'Self Roth',   type: 'roth',        balance: 0,       owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-spouse', name: 'Spouse Roth', type: 'roth',        balance: 0,       owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'brok',        name: 'Brokerage',   type: 'brokerage',   balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];

    expect(bd.rothConversionGrossSelf).toBeCloseTo(30_000, 0);
    expect(bd.rothConversionGrossSpouse).toBeCloseTo(20_000, 0);
    const flows = bd.audit!.accountFlows!;
    // Per-owner conversion principal lands in its own Trad and Roth pair.
    // Trad withdrawal may be slightly larger due to discretionary spending
    // cascade from LTCG on the conv-tax Brokerage pull (tolerance accommodates).
    expect(flows.find(f => f.accountId === 'trad-self')!.withdrawal).toBeGreaterThanOrEqual(30_000);
    expect(flows.find(f => f.accountId === 'trad-self')!.withdrawal).toBeLessThan(31_000);
    expect(flows.find(f => f.accountId === 'trad-spouse')!.withdrawal).toBeGreaterThanOrEqual(20_000);
    expect(flows.find(f => f.accountId === 'trad-spouse')!.withdrawal).toBeLessThan(21_000);
    // Roth deposits are exactly the conv principal (no withholding).
    expect(flows.find(f => f.accountId === 'roth-self')!.deposit).toBeCloseTo(30_000, 0);
    expect(flows.find(f => f.accountId === 'roth-spouse')!.deposit).toBeCloseTo(20_000, 0);
  });

  it('Self-conversion capped by Self-Trad balance even when Spouse-Trad has plenty', () => {
    const ud = makeUserData({
      currentAge: 60,
      spouseAge: 60,
      lifeExpectancy: 61,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcS', type: 'roth_conversion', name: 'Self Conv', amount: 100_000, startAge: 60, owner: 'self', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 40_000,  owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 500_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self',   name: 'Self Roth',   type: 'roth',        balance: 0,       owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'brok',        name: 'Brokerage',   type: 'brokerage',   balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    // Per-owner cap is the load-bearing invariant: capped at Self-Trad ($40k),
    // NOT bumped up to use Spouse-Trad's plenty. Spouse-Trad may absorb a tiny
    // pro-rata share of discretionary spending cascade from the LTCG-on-conv-tax,
    // but Self's conversion explicitly does not draw from Spouse's account.
    expect(bd.rothConversionGross).toBeCloseTo(40_000, 0);
    expect(bd.rothConversionGrossSelf).toBeCloseTo(40_000, 0);
    expect(bd.rothConversionRequested).toBeCloseTo(100_000, 0);
    const flows = bd.audit!.accountFlows!;
    const spouseTradFlow = flows.find(f => f.accountId === 'trad-spouse');
    // Allow the tiny discretionary cascade pro-rata pull, orders of magnitude
    // smaller than the Spouse-Trad plenty. Absent row = $0 pull; `?? 0` keeps
    // the assertion live either way (the old `if (flow)` guard passed
    // vacuously when the row was absent).
    expect(spouseTradFlow?.withdrawal ?? 0).toBeLessThan(500);
  });

  it('Per-owner withholding splits proportionally when external sourcing runs dry', () => {
    // No Cash, no Brokerage → conversion tax must be withheld. With mixed-owner
    // conversion, the withholding splits proportionally to each owner's gross.
    const ud = makeUserData({
      currentAge: 60,
      spouseAge: 60,
      lifeExpectancy: 61,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcS', type: 'roth_conversion', name: 'Self Conv',   amount: 60_000, startAge: 60, owner: 'self',   taxStatus: 'before_tax', colaType: 'fixed' },
        { id: 'rcP', type: 'roth_conversion', name: 'Spouse Conv', amount: 40_000, startAge: 60, owner: 'spouse', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-self',   name: 'Self Trad',   type: 'traditional', balance: 500_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 500_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self',   name: 'Self Roth',   type: 'roth',        balance: 0,       owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-spouse', name: 'Spouse Roth', type: 'roth',        balance: 0,       owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        // No brokerage, no cash → conversion tax has no external source.
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    expect(bd.rothConversionTaxWithheld).toBeGreaterThan(0);
    // Per-owner withholding split ≈ 60:40 (Self:Spouse conv ratio).
    const withheldRatioSelf = bd.rothConversionTaxWithheldSelf / bd.rothConversionTaxWithheld;
    expect(withheldRatioSelf).toBeCloseTo(0.6, 2);
    // Conservation: per-owner withheld sums to aggregate.
    expect(bd.rothConversionTaxWithheldSelf + bd.rothConversionTaxWithheldSpouse).toBeCloseTo(bd.rothConversionTaxWithheld, 1);
  });

  it('rothConvDepositByAccount: Self conversion distributes pro-rata across multiple Self-owned Roth accounts', () => {
    // Two Self-owned Roth accounts ($30k + $70k = $100k total). A $50k Self
    // conversion should deposit pro-rata: 30% to Vanguard ($15k), 70% to Fidelity
    // ($35k). Spouse-owned Roth (if any) should receive zero from this Self conv.
    const ud = makeUserData({
      currentAge: 60,
      spouseAge: 60,
      lifeExpectancy: 61,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcS', type: 'roth_conversion', name: 'Self Conv', amount: 50_000, startAge: 60, owner: 'self', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-self',    name: 'Self Trad',      type: 'traditional', balance: 500_000, owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self-1',  name: 'Vanguard Roth',  type: 'roth',        balance: 30_000,  owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-self-2',  name: 'Fidelity Roth',  type: 'roth',        balance: 70_000,  owner: 'self',   stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'roth-spouse',  name: 'Spouse Roth',    type: 'roth',        balance: 50_000,  owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'brok',         name: 'Brokerage',      type: 'brokerage',   balance: 200_000,                  stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    const rows = bd.audit!.rothConvDepositByAccount!;

    const vanguard = rows.find(r => r.accountId === 'roth-self-1');
    const fidelity = rows.find(r => r.accountId === 'roth-self-2');
    const spouse   = rows.find(r => r.accountId === 'roth-spouse');

    // Pro-rata within Self-owned Roths: 30% to Vanguard, 70% to Fidelity.
    expect(vanguard!.deposit).toBeCloseTo(50_000 * 0.3, 0);
    expect(fidelity!.deposit).toBeCloseTo(50_000 * 0.7, 0);
    // Spouse-owned Roth is NOT a target for Self's conversion.
    expect(spouse).toBeUndefined();
    // Conservation: sum equals rothConversionGross − rothConversionTaxWithheld.
    const sum = rows.reduce((s, r) => s + r.deposit, 0);
    expect(Math.abs(sum - (bd.rothConversionGross - bd.rothConversionTaxWithheld))).toBeLessThan(1);
  });

  it('rothConvDepositByAccount empty when there is no conversion', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 61,
      spendingGoals: [],
      accounts: [
        { id: 'roth-self', name: 'Roth Self', type: 'roth', balance: 100_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
        { id: 'brok',      name: 'Brokerage', type: 'brokerage', balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    expect(bd.rothConversionGross).toBe(0);
    expect(bd.audit!.rothConvDepositByAccount).toEqual([]);
  });

  it('Spouse-conversion injects a Spouse synthetic Roth when none exists', () => {
    const ud = makeUserData({
      currentAge: 60,
      spouseAge: 60,
      lifeExpectancy: 61,
      filingStatus: 'mfj',
      spendingGoals: [],
      incomeEvents: [
        { id: 'rcP', type: 'roth_conversion', name: 'Spouse Conv', amount: 25_000, startAge: 60, owner: 'spouse', taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      accounts: [
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 300_000, owner: 'spouse', stockAllocation: 0, portfolioBalance: '50_50' as const },
        // No Roth accounts at all — the engine should inject a Spouse-owned synthetic.
        { id: 'brok',        name: 'Brokerage',   type: 'brokerage',   balance: 200_000, stockAllocation: 0, portfolioBalance: '50_50' as const },
      ],
      portfolioAssumptions: { stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0, stockBondCorrelationEnabled: false, stockBondCorrelation: 0, returnDistribution: 'lognormal', degreesOfFreedom: 4 },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd = result.nominalBreakdowns[0];
    // Synthetic Spouse Roth received the conversion deposit.
    const spouseRothFlow = bd.audit!.accountFlows!.find(f => f.accountName === 'Roth Conversion (Spouse)');
    expect(spouseRothFlow).toBeDefined();
    expect(spouseRothFlow!.deposit).toBeGreaterThan(0);
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
        },
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

describe('selectBestSpendingOrder', () => {
  // The selector runs two full deterministic projections (one with each
  // policy pinned) and picks the higher real terminal balance. These tests
  // exercise the mechanics — that the returned value is one of the two
  // policies, that auto-selected projections match forced-with-winner runs,
  // and that the selector never throws on edge-case scenarios.

  const spendyMfjScenario = (): UserData => makeUserData({
    currentAge: 62,
    lifeExpectancy: 80,
    filingStatus: 'mfj',
    spouseAge: 62,
    stateTimeline: [{ state: 'Florida' }],
    portfolioAssumptions: {
      stockReturn: 0.07, stockStdDev: 0, bondReturn: 0.04, bondStdDev: 0,
      stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
      returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
    },
    accounts: [
      { id: 't-1', name: 'Trad', type: 'traditional', balance: 3_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'ira' as const },
      { id: 'b-1', name: 'Brokerage', type: 'brokerage', balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'brokerage' as const },
    ],
    spendingGoals: [
      { id: 'sp-1', type: 'living_expenses', name: 'Living', amount: 200_000, startAge: 62, inflationAdjusted: false, isOneTime: false, amountPeriod: 'annual' as const },
    ],
  });

  it('returns one of the two valid policies', () => {
    const order = selectBestSpendingOrder(spendyMfjScenario());
    expect(['brokerage_first', 'bracket_aware']).toContain(order);
  });

  it('auto-selected projection matches forcing the selector-picked winner', () => {
    // The auto-selection picks a winner; forcing that same winner via
    // _forceSpendingOrder must produce a bit-identical path. This proves
    // the auto-select path threads through to the precomputes correctly
    // and that the engine isn't reading the policy from anywhere else.
    const ud = spendyMfjScenario();
    const auto = runDeterministicProjection(ud);
    const winner = selectBestSpendingOrder(ud);
    const forced = runDeterministicProjection(ud, { _forceSpendingOrder: winner });
    expect(forced.path[forced.path.length - 1]).toBeCloseTo(auto.path[auto.path.length - 1], 0);
  });

  it('the two forced policies produce distinct paths on a scenario where the choice matters', () => {
    // Guards against a refactor that accidentally makes _forceSpendingOrder
    // a no-op. On a heavy-spending, mixed-bucket scenario the two policies
    // exit at materially different terminal balances.
    const ud = spendyMfjScenario();
    const brokerageRun = runDeterministicProjection(ud, { _forceSpendingOrder: 'brokerage_first' });
    const bracketRun = runDeterministicProjection(ud, { _forceSpendingOrder: 'bracket_aware' });
    const last = brokerageRun.path.length - 1;
    expect(brokerageRun.path[last]).not.toBe(bracketRun.path[last]);
  });

  it('does not throw on a degenerate single-account scenario', () => {
    // The default makeUserData has only a single Traditional account, no
    // spending, no events. Auto-selection should still complete (it can't
    // differentiate the policies but it can't throw either).
    expect(() => selectBestSpendingOrder(makeUserData())).not.toThrow();
  });

  it('picks bracket_aware when high-spending makes 12% Trad headroom cheaper than 15% LTCG', () => {
    // Pre-SS MFJ retirees, heavy Trad ($5M), modest Brokerage ($1M), high
    // spending ($200K). LTCG on Brokerage pulls lands well into the 15%
    // federal bracket because spending pushes ordinary-equivalent stacking
    // past the 0% LTCG threshold. 12% Trad headroom (~$130K) is cheaper.
    // Long horizon (30 years) so the cumulative tax savings × compounding
    // wins clearly above the tiebreaker tolerance.
    const ud = makeUserData({
      currentAge: 62,
      lifeExpectancy: 92,
      filingStatus: 'mfj',
      spouseAge: 62,
      stateTimeline: [{ state: 'Florida' }],
      portfolioAssumptions: {
        stockReturn: 0.07, stockStdDev: 0, bondReturn: 0.04, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
      },
      inflationRate: 0.03,
      accounts: [
        { id: 't-1', name: 'Trad', type: 'traditional', balance: 5_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'ira' as const },
        { id: 'b-1', name: 'Brokerage', type: 'brokerage', balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'brokerage' as const },
      ],
      spendingGoals: [
        { id: 'sp-1', type: 'living_expenses', name: 'Living', amount: 200_000, startAge: 62, inflationAdjusted: true, isOneTime: false, amountPeriod: 'annual' as const },
      ],
    });
    expect(selectBestSpendingOrder(ud)).toBe('bracket_aware');
  });

  it('picks brokerage_first on a low-spending pre-SS scenario when LTCG bracket stacking is on (0% LTCG bracket dominates)', () => {
    // Pre-SS MFJ retirees with modest spending ($50K), balanced
    // Trad/Brokerage, and `useStackedLtcgBrackets: true` so the 0%/15%/20%
    // federal LTCG brackets are honored. With $0 ordinary income, $50K LTCG
    // sits entirely in the 0% federal bracket (top of MFJ 0% LTCG bracket
    // is ~$94K taxable income). Pulling Brokerage is FREE federally;
    // bracket_aware would pay 10–12% federal on $50K Trad pulls. Over a
    // 30-year horizon the difference clearly exceeds the tiebreaker.
    // Without bracket stacking (flat 15% LTCG default), the test would flip
    // because Brokerage pulls would cost 15% — that's covered by the
    // mirror-image `bracket_aware wins on high-spending` test above.
    const ud = makeUserData({
      currentAge: 62,
      lifeExpectancy: 92,
      filingStatus: 'mfj',
      spouseAge: 62,
      stateTimeline: [{ state: 'Florida' }],
      portfolioAssumptions: {
        stockReturn: 0.07, stockStdDev: 0, bondReturn: 0.04, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
      },
      inflationRate: 0.03,
      useStackedLtcgBrackets: true,
      accounts: [
        { id: 't-1', name: 'Trad', type: 'traditional', balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'ira' as const },
        { id: 'b-1', name: 'Brokerage', type: 'brokerage', balance: 1_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'brokerage' as const },
      ],
      spendingGoals: [
        { id: 'sp-1', type: 'living_expenses', name: 'Living', amount: 50_000, startAge: 62, inflationAdjusted: true, isOneTime: false, amountPeriod: 'annual' as const },
      ],
    });
    expect(selectBestSpendingOrder(ud)).toBe('brokerage_first');
  });

  it('picks brokerage_first as tiebreaker when the two policies are operationally equivalent', () => {
    // A scenario with no spending: both policies pull Trad to fund only the
    // conversion event's tax cascade. Real terminal balances differ by ~$500
    // (the small LTCG-cascade refeed under bracket_aware). With the widened
    // tiebreaker tolerance ($100 absolute or 0.05% relative ≈ $250 on the
    // $500K terminal), the noise is absorbed and brokerage_first wins by
    // default. Guards against the original double-deflation-era test that
    // flipped to bracket_aware over floating-point noise.
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 63,
      filingStatus: 'single',
      stateTimeline: [{ state: 'Florida' }],
      accounts: [
        { id: 't-1', name: 'Trad', type: 'traditional', balance: 500_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'b-1', name: 'Brokerage', type: 'brokerage', balance: 50_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [],
      incomeEvents: [
        { id: 'conv-1', type: 'roth_conversion', name: 'Conv', amount: 50_000, startAge: 60, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
    });
    expect(selectBestSpendingOrder(ud)).toBe('brokerage_first');
  });
});

describe('computeBracketHeadroomForTrad', () => {
  // Minimal AccumulatedIncome stub — only the fields the helper reads.
  const incomeOf = (overrides: { ssGross?: number; otherTaxableGross?: number; conversionGross?: number } = {}) => ({
    ssGross: overrides.ssGross ?? 0,
    otherTaxableGross: overrides.otherTaxableGross ?? 0,
    afterTaxIncome: 0,
    conversionGross: overrides.conversionGross ?? 0,
    conversionGrossSelf: overrides.conversionGross ?? 0,
    conversionGrossSpouse: 0,
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

describe('stacked LTCG brackets (useStackedLtcgBrackets)', () => {
  // Single retiree, age 70, only a Brokerage account, modest spending forces a
  // ~$50k brokerage withdrawal with ~no ordinary income. Under the flat 15%
  // rate that gain is taxed $7,500; under 0/15/20% stacking it sits entirely
  // below the 0% ceiling (~$49,450) so federal LTCG ≈ 0.
  const base = (overrides: Partial<UserData> = {}) => makeUserData({
    currentAge: 70,
    lifeExpectancy: 75,
    accounts: [{ id: 'brk-1', name: 'Brokerage', type: 'brokerage', balance: 600_000, stockAllocation: 0, portfolioBalance: '60_40' as const }],
    spendingGoals: [baseSpending(4_000, 70)], // $48k/yr
    longTermCapGainsRate: 0.15,
    ...overrides,
  });

  it('taxes a low-income brokerage gain at ~0% under stacking but 15% under the flat rate', () => {
    const flat = runSimulation(base(), createSeededRandom(1));
    const stacked = runSimulation(base({ useStackedLtcgBrackets: true }), createSeededRandom(1));
    expect(flat.medianBreakdowns[0].federalCapGainsTax).toBeGreaterThan(3_000);
    expect(stacked.medianBreakdowns[0].federalCapGainsTax).toBeLessThan(500);
    expect(stacked.medianBreakdowns[0].federalCapGainsTax)
      .toBeLessThan(flat.medianBreakdowns[0].federalCapGainsTax);
  });

  it('is bit-identical to the flat path when the flag is off (default)', () => {
    const a = runSimulation(base(), createSeededRandom(7));
    const b = runSimulation(base({ useStackedLtcgBrackets: undefined }), createSeededRandom(7));
    expect(a.medianBreakdowns[0].federalCapGainsTax).toBe(b.medianBreakdowns[0].federalCapGainsTax);
  });
});

describe('bracket_aware spending waterfall — coordination invariant', () => {
  // The plan promised: in years where the bracket-aware Trad spending pull is
  // active AND Taxable can absorb the spending overflow (no spill to
  // Trad-above-headroom), federal bracket index stays ≤ 1 (the 12% bracket).
  // When Taxable runs out the spillover falls to Trad-above-headroom and
  // bracket may exceed 12% — that's the existing brokerage_first fallback,
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
        { id: 'b-1', name: 'Taxable 1', type: 'brokerage', balance: 400_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
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

describe('cash account', () => {
  it('grows by deterministic yield only — bypasses stock/bond multiplier even when stockAllocation is set', () => {
    // Regression guard: if the growth loop falls through to `sa * sf + (1-sa) * bf`
    // for a cash account, an aggressive 50% stockReturn would balloon the balance.
    const ud = makeUserData({
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 100_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [],
      incomeEvents: [],
      portfolioAssumptions: {
        stockReturn: 0.5, stockStdDev: 0, bondReturn: 0.1, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0.04,
      },
      simulationSettings: { numSimulations: 10 },
      lifeExpectancy: 62,
    });
    const result = runSimulation(ud, createSeededRandom(42));
    // No spending goals, so the cash account simply grows by its yield and the
    // interest is reinvested in the balance (accrue-in-account — it is NOT a
    // surplus deposited to a synthetic Taxable account). Cash growth: 100k × 1.04
    // = $104k. A bypass-bug would produce ~134k (= 100k × (0.6*1.5 + 0.4*1.1)).
    expect(result.nominalBreakdowns[0].cashInterest).toBeCloseTo(4000, 1);
    expect(result.nominalBreakdowns[0].cashEndingBalance).toBeCloseTo(104_000, 0);
    expect(result.nominalBreakdowns[0].cashEndingBalance).toBeLessThan(110_000); // would be ~134k if bypass missed
  });

  it('cash interest is added to NIIT investment-income base (per IRC §1411)', () => {
    // Pension drives MAGI above the $200k single threshold; cash interest is
    // the only "investment income" since fromBrokerage = 0 (no Taxable account
    // pulls because cash covers spending and surplus deposits to synthetic
    // Reinvestment-Taxable account). Without the NIIT proxy extension this
    // would yield niitTax = 0.
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [{ id: 'cash-1', name: 'Cash', type: 'cash', balance: 5_000_000, stockAllocation: 0, portfolioBalance: '60_40' as const }],
      spendingGoals: [baseSpending(60_000 / 12)],
      incomeEvents: [{
        id: 'pension-1', type: 'pension_income', name: 'Pension',
        amount: 300_000, startAge: 60, endAge: 60,
        taxStatus: 'before_tax', colaType: 'fixed',
      }],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0.04,
      },
      enableNIIT: true,
      simulationSettings: { numSimulations: 10 },
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    // 5M × 4% = $200k cash interest. MAGI ≈ $200k pension + $200k interest = $400k.
    // Excess over single $200k threshold = $200k. Investment income proxy =
    // fromBrokerage + cashInterest = 0 + 200k = $200k. NIIT base = $200k.
    // niitTax = 3.8% × $200k = $7,600.
    expect(bd.cashInterest).toBeCloseTo(200_000, 0);
    expect(bd.withdrawalFromBrokerage).toBe(0);  // cash covers spending
    expect(bd.niitTax).toBeGreaterThan(7000);
    expect(bd.niitTax).toBeLessThan(8000);
  });

  it('spending waterfall pulls Cash before any tax-generating source', () => {
    // Cash + Taxable. Cash should cover all spending; Taxable should remain
    // untouched (no LTCG realized).
    const ud = makeUserData({
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 100_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(50_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,  // isolate the waterfall test from yield-as-income
      },
      simulationSettings: { numSimulations: 10 },
      lifeExpectancy: 61,
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    expect(bd.withdrawalFromCash).toBeCloseTo(50_000, 0);
    expect(bd.withdrawalFromBrokerage).toBe(0);
    expect(bd.federalCapGainsTax).toBe(0);  // no LTCG realized
    expect(bd.totalTax).toBe(0);             // no taxable income, no FL state tax
  });

  it('Roth conversion tax sources from Cash before Taxable (phantom-tax avoidance)', () => {
    // Trad + Cash + Taxable. Conversion's marginal ordinary tax should be
    // sourced from Cash (rothConversionTaxFromCash), not from Taxable
    // (would realize LTCG and amplify the tax bill — the phantom-tax archetype).
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [
        { id: 'trad-1', name: 'Trad', type: 'traditional', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 200_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [],
      incomeEvents: [{
        id: 'conv-1', type: 'roth_conversion', name: 'Conv',
        amount: 100_000, startAge: 60, endAge: 60,
        taxStatus: 'before_tax', colaType: 'fixed',
      }],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      simulationSettings: { numSimulations: 10 },
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    expect(bd.rothConversionGross).toBeCloseTo(100_000, 0);
    // Cash absorbs entire marginal tax; Taxable is preserved.
    expect(bd.rothConversionTaxFromCash).toBeGreaterThan(0);
    expect(bd.rothConversionTaxFromBrokerage).toBe(0);
    expect(bd.rothConversionTaxWithheld).toBe(0);  // Cash covered fully
    expect(bd.federalCapGainsTax).toBe(0);          // no Taxable pulled
  });

  // --- Phase 2: cash bucket policy ---
  it('bucket policy "none" trigger disables auto refill and auto sweep', () => {
    // Manual mode: cash above max stays there (no auto-sweep); cash below min
    // is not refilled (no auto-refill).
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(40_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      simulationSettings: { numSimulations: 10 },
      cashBucketPolicy: { minAmount: 20_000, targetAmount: 40_000, maxAmount: 60_000, refillTrigger: 'none' },
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    // 500k cash >> max=$60k, but trigger='none' → no sweep.
    expect(bd.cashSweepToBrokerage).toBe(0);
    expect(bd.cashRefillFromSurplus).toBe(0);
    // Spending pulls cash with floor = 0 (suppressed by 'none' trigger).
    expect(bd.withdrawalFromCash).toBeCloseTo(40_000, 0);
  });

  it('bucket policy max ceiling sweeps excess cash to Taxable (tax-free)', () => {
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(40_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      simulationSettings: { numSimulations: 10 },
      cashBucketPolicy: { minAmount: 20_000, targetAmount: 40_000, maxAmount: 60_000, refillTrigger: 'gains_only' },
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    // maxCash = $60k. After $40k spending (with $20k floor allows pull),
    // cash = $460k. Sweep $460k − $60k = $400k. Tax-free.
    expect(bd.cashSweepToBrokerage).toBeGreaterThan(380_000);
    expect(bd.cashSweepToBrokerage).toBeLessThan(420_000);
    expect(bd.cashEndingBalance).toBeGreaterThan(55_000);
    expect(bd.cashEndingBalance).toBeLessThan(65_000);
    // SWEEP MUST BE TAX-FREE — load-bearing invariant.
    expect(bd.federalCapGainsTax).toBe(0);
    expect(bd.totalTax).toBe(0); // no state tax (FL), no LTCG, no ordinary income
  });

  it('post-convergence step does NOT mutate any tax field (structural invariant)', () => {
    // Run the same scenario twice: once with policy enabled, once without.
    // The tax fields (totalTax, ordinaryTax, federalCapGainsTax, niitTax,
    // irmaaSurcharge, stateCapGainsTax) should be identical — policy moves
    // money between balances post-convergence but never touches the tax pipeline.
    const baseUd = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(40_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      simulationSettings: { numSimulations: 10 },
    });
    const noPolicy = runSimulation(baseUd, createSeededRandom(42)).nominalBreakdowns[0];
    const withPolicy = runSimulation(
      { ...baseUd, cashBucketPolicy: { minAmount: 20_000, targetAmount: 40_000, maxAmount: 60_000, refillTrigger: 'gains_only' } },
      createSeededRandom(42)
    ).nominalBreakdowns[0];
    expect(withPolicy.totalTax).toBe(noPolicy.totalTax);
    expect(withPolicy.ordinaryTax).toBe(noPolicy.ordinaryTax);
    expect(withPolicy.federalCapGainsTax).toBe(noPolicy.federalCapGainsTax);
    expect(withPolicy.stateCapGainsTax).toBe(noPolicy.stateCapGainsTax);
    expect(withPolicy.niitTax).toBe(noPolicy.niitTax);
    expect(withPolicy.irmaaSurcharge).toBe(noPolicy.irmaaSurcharge);
    expect(withPolicy.otherTaxableGross).toBe(noPolicy.otherTaxableGross);
    expect(withPolicy.netCashFlow).toBe(noPolicy.netCashFlow);
    // But cash routing differs — the policy moved $400k from Cash to Taxable.
    expect(withPolicy.cashSweepToBrokerage).toBeGreaterThan(0);
    expect(noPolicy.cashSweepToBrokerage).toBe(0);
  });

  it('bucket policy soft floor preserves cash; spending falls through to Taxable', () => {
    // Cash floor $30k. Cash starting balance $30k.
    // Spending $60k. Cash floor immediate; spending should fall through to Taxable.
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 61,
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 30_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'tax-1', name: 'Taxable', type: 'brokerage', balance: 200_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(60_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      simulationSettings: { numSimulations: 10 },
      cashBucketPolicy: { minAmount: 30_000, targetAmount: 60_000, maxAmount: 120_000, refillTrigger: 'gains_only' },
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    // minCash = $30k.
    // Cash balance equals the floor exactly → cashAvailableForSpending = 0.
    // All spending pulls from Taxable.
    expect(bd.withdrawalFromCash).toBe(0);
    expect(bd.withdrawalFromBrokerage).toBeGreaterThanOrEqual(60_000);
  });

  it('cash sweeps and balances are reflected in cashEndingBalance', () => {
    // Sanity check the surfaced cashEndingBalance field. 100k → 4k interest credited
    // to the balance ($104k) → withdraw the full 20k spending from the grown balance
    // = 84k end balance. The interest is reinvested in the cash account (accrue-in-
    // account), NOT counted again as spendable income, so the principal pull is the
    // full $20k — not $16k. (Counting it twice was the cash-double-count bug.)
    const ud = makeUserData({
      accounts: [{ id: 'cash-1', name: 'Cash', type: 'cash', balance: 100_000, stockAllocation: 0, portfolioBalance: '60_40' as const }],
      spendingGoals: [baseSpending(20_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0.04,
      },
      simulationSettings: { numSimulations: 10 },
      lifeExpectancy: 61,
    });
    const bd = runSimulation(ud, createSeededRandom(42)).nominalBreakdowns[0];
    expect(bd.cashInterest).toBeCloseTo(4_000, 1);
    expect(bd.withdrawalFromCash).toBeCloseTo(20_000, 0);
    expect(bd.cashEndingBalance).toBeCloseTo(84_000, 0);
  });

  it('all account balances are non-negative after the per-year loop (C1 clamp invariant)', () => {
    // Regression guard for the clamp-ordering fix: balances must be >= 0 in
    // every breakdown's downstream consumption. We can't directly inspect
    // intermediate state, but we can verify the OUTPUT invariant — final
    // path values and post-loop balances are all non-negative — across a
    // scenario that exercises both proportional withdrawal (float-drift
    // source) AND the post-convergence sweep.
    const ud = makeUserData({
      currentAge: 60, lifeExpectancy: 70,
      accounts: [
        { id: 'cash-1', name: 'Cash', type: 'cash', balance: 500_000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'tax-1a', name: 'Taxable A', type: 'brokerage', balance: 300_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'tax-1b', name: 'Taxable B', type: 'brokerage', balance: 200_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(60_000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0.05, stockStdDev: 0, bondReturn: 0.03, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0.04,
      },
      simulationSettings: { numSimulations: 10 },
      cashBucketPolicy: { minAmount: 30_000, targetAmount: 60_000, maxAmount: 90_000, refillTrigger: 'gains_only' },
    });
    const result = runSimulation(ud, createSeededRandom(42));
    for (const v of result.nominal) expect(v).toBeGreaterThanOrEqual(0);
    for (const bd of result.nominalBreakdowns) {
      expect(bd.cashEndingBalance).toBeGreaterThanOrEqual(0);
      expect(bd.withdrawalFromCash).toBeGreaterThanOrEqual(0);
      expect(bd.cashRefillFromSurplus).toBeGreaterThanOrEqual(0);
      expect(bd.cashSweepToBrokerage).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('conversion joint cap — spending + conversion cannot exceed the Traditional balance', () => {
  // Regression: the conversion cap used the beginning-of-year balance minus RMD
  // only — never the spending pull and never the live balance. fromTrad =
  // forcedTrad + convCandidate could exceed what the account held; applyCashFlow
  // silently capped the real subtraction while the Roth deposit and the tax bill
  // used the full amount, minting phantom dollars into Roth and masking the
  // spending shortfall.
  it('caps the conversion so spending pull + conversion never exceed the Trad balance', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 62,
      accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      spendingGoals: [baseSpending(30000 / 12)],
      incomeEvents: [
        { id: 'conv-1', name: 'Roth Conversion 1', type: 'roth_conversion', amount: 90000, startAge: 60, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd0 = result.nominalBreakdowns[0];
    // The joint cap: total Trad outflow bounded by what the account holds.
    expect(bd0.withdrawalFromTraditional).toBeLessThanOrEqual(100000.01);
    // The conversion got scaled down (spending + its tax claimed part of the 100k).
    expect(bd0.rothConversionGross).toBeLessThan(90000);
    expect(bd0.rothConversionGross).toBeGreaterThan(0);
    // Wealth conservation: next year's portfolio = 100k − spending − total tax.
    // Pre-fix this came out ~$15–20k HIGHER (phantom dollars minted into Roth).
    expect(result.nominal[1]).toBeCloseTo(100000 - 30000 - bd0.totalTax, 0);
  });

  it('caps the conversion at the LIVE (post-crash) balance, not the beginning-of-year balance', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 62,
      accounts: [{ id: 'trad-1', name: 'Traditional 1', type: 'traditional', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const }],
      incomeEvents: [
        { id: 'conv-1', name: 'Roth Conversion 1', type: 'roth_conversion', amount: 95000, startAge: 60, isOneTime: true, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        blackSwanEvents: [{ year: 2026, stockMultiplier: 0.5, bondMultiplier: 0.5 }],
      },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd0 = result.nominalBreakdowns[0];
    // Live Trad after the −50% year is $50k; the old BOY-based cap allowed $95k.
    expect(bd0.rothConversionGross).toBeLessThanOrEqual(50000.01);
    expect(bd0.withdrawalFromTraditional).toBeLessThanOrEqual(50000.01);
    // Conservation: everything left is 50k minus the conversion's tax (withheld).
    expect(result.nominal[1]).toBeCloseTo(50000 - bd0.totalTax, 0);
  });
});

describe('per-owner RMD sourcing parity between stat-only runs and the audited path', () => {
  // Regression: applyCashFlow read the per-owner RMD split from breakdown.audit,
  // which the stat-only MC runs (includeAudit=false) never build — so the 4,997
  // stat runs pulled RMDs pro-rata across BOTH owners while the audited
  // replay/nominal path pulled per-owner. Different per-account balances feed
  // different future per-owner RMDs → the stat paths diverged from the audited
  // path they were supposed to represent.
  it('deterministic MFJ per-owner scenario: median (stat) path equals nominal (audited) path', () => {
    const ud = makeUserData({
      currentAge: 80,
      lifeExpectancy: 90,
      filingStatus: 'mfj',
      spouseAge: 62,
      accounts: [
        { id: 'trad-self', name: 'Self Trad', type: 'traditional', balance: 300000, owner: 'self', stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'trad-spouse', name: 'Spouse Trad', type: 'traditional', balance: 500000, owner: 'spouse', stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(20000 / 12, 80)],
      simulationSettings: { numSimulations: 50 },
    });
    const result = runSimulation(ud, createSeededRandom(7));
    for (let i = 0; i < result.nominal.length; i++) {
      expect(Math.abs(result.median[i] - result.nominal[i])).toBeLessThanOrEqual(1);
    }
  });
});

describe('Roth/after-tax contribution cash conservation', () => {
  it('a Roth contribution next to modeled wage income is not double-counted as surplus', () => {
    const ud = makeUserData({
      currentAge: 50,
      lifeExpectancy: 52,
      accounts: [
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'brok-1', name: 'Brokerage 1', type: 'brokerage', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [
        { id: 'wage-1', name: 'Salary 1', type: 'wage_income', amount: 100000, startAge: 50, taxStatus: 'before_tax', colaType: 'fixed' },
        { id: 'contrib-1', name: 'Retirement Contribution 1', type: 'retirement_contribution', amount: 20000, startAge: 50, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'roth', accountId: 'roth-1' },
      ],
      spendingGoals: [baseSpending(50000 / 12, 50)],
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd0 = result.nominalBreakdowns[0];
    expect(bd0.rothContributions).toBe(20000);
    // Total wealth change = wage − spending − tax. Pre-fix the $20k contribution
    // was deposited to Roth AND left inside netCashFlow (re-deposited as
    // brokerage surplus) — a +$20k/yr overstatement.
    expect(result.nominal[1] - result.nominal[0]).toBeCloseTo(100000 - 50000 - bd0.totalTax, 0);
  });

  it('a contribution with NO modeled income stays exogenously funded (savings-without-salary pattern)', () => {
    const ud = makeUserData({
      currentAge: 50,
      lifeExpectancy: 52,
      accounts: [
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [
        { id: 'contrib-1', name: 'Retirement Contribution 1', type: 'retirement_contribution', amount: 20000, startAge: 50, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'roth', accountId: 'roth-1' },
      ],
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    // No wage income modeled — the deposit arrives from outside the model, as
    // before (the conservation floor only removes contributions from cash the
    // model actually saw).
    expect(result.nominal[1] - result.nominal[0]).toBeCloseTo(20000, 0);
  });
});

describe('runFastPreview probability-pending state', () => {
  it('flags probabilityPending when no cached probability exists (never-simulated scenario)', () => {
    const result = runFastPreview(makeUserData(), undefined);
    expect(result.isPreview).toBe(true);
    // The placeholder 0 must be marked as not-displayable — rendering it
    // flashed "Chance of Success: 0%" + a failure-tier badge until MC landed.
    expect(result.probabilityPending).toBe(true);
    expect(result.probability).toBe(0);
  });

  it('shows the cached probability with no pending flag when one exists', () => {
    const result = runFastPreview(makeUserData(), 87);
    expect(result.probability).toBe(87);
    expect(result.probabilityPending).toBeFalsy();
  });

  it('full runSimulation output never carries the pending flag', () => {
    const result = runSimulation(makeUserData({ lifeExpectancy: 62, simulationSettings: { numSimulations: 10 } }), createSeededRandom(1));
    expect(result.probabilityPending).toBeFalsy();
    expect(result.isPreview).toBeFalsy();
  });
});

describe('SECURE 2.0 super catch-up (ages 60–63)', () => {
  // One-year scenario per age: wage income + a $40k pre-tax 401(k) contribution
  // against explicit limits (base $23k, regular catch-up $7.5k, super $11.25k).
  // The capped amount proves which catch-up applied.
  const capScenarioAt = (age: number) => makeUserData({
    currentAge: age,
    lifeExpectancy: age + 1,
    accounts: [
      { id: '401k-1', name: '401k', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: '401k' },
    ],
    incomeEvents: [
      { id: 'wage-1', name: 'Salary 1', type: 'wage_income', amount: 200000, startAge: age, taxStatus: 'before_tax', colaType: 'fixed' },
      { id: 'contrib-1', name: 'Retirement Contribution 1', type: 'retirement_contribution', amount: 40000, startAge: age, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: '401k-1' },
    ],
    contributionLimits: {
      elective401k: 23000,
      iraLimit: 7000,
      catchUpAge: 50,
      catchUp401k: 7500,
      superCatchUp401k: 11250,
      catchUpIra: 1000,
      inflationAdjusted: false,
    },
    simulationSettings: { numSimulations: 10 },
  });

  const cappedAt = (age: number): number => {
    const result = runSimulation(capScenarioAt(age), createSeededRandom(1));
    return result.nominalBreakdowns[0].contributionsCappedAmount;
  };

  it.each([
    [59, 40000 - (23000 + 7500)],   // regular catch-up
    [60, 40000 - (23000 + 11250)],  // super catch-up starts
    [63, 40000 - (23000 + 11250)],  // last super year
    [64, 40000 - (23000 + 7500)],   // regular catch-up resumes
  ])('age %i → capped amount %i', (age, expectedCut) => {
    expect(cappedAt(age)).toBeCloseTo(expectedCut, 0);
  });

  it('IRA-kind groups get no super catch-up at 61', () => {
    const ud = makeUserData({
      currentAge: 61,
      lifeExpectancy: 62,
      accounts: [
        { id: 'ira-1', name: 'IRA', type: 'traditional', balance: 0, stockAllocation: 0.6, portfolioBalance: '60_40' as const, accountKind: 'ira' },
      ],
      incomeEvents: [
        { id: 'wage-1', name: 'Salary 1', type: 'wage_income', amount: 100000, startAge: 61, taxStatus: 'before_tax', colaType: 'fixed' },
        { id: 'contrib-1', name: 'Retirement Contribution 1', type: 'retirement_contribution', amount: 10000, startAge: 61, taxStatus: 'before_tax', colaType: 'fixed', contributionType: 'pre_tax', accountId: 'ira-1' },
      ],
      contributionLimits: {
        elective401k: 23000,
        iraLimit: 7000,
        catchUpAge: 50,
        catchUp401k: 7500,
        superCatchUp401k: 11250,
        catchUpIra: 1000,
        inflationAdjusted: false,
      },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    // IRA cap = 7000 + 1000 regular catch-up only → $2,000 of the $10k cut.
    expect(result.nominalBreakdowns[0].contributionsCappedAmount).toBeCloseTo(2000, 0);
  });
});

describe('cash bucket floor surfaces the shortfall it creates', () => {
  // Regression: the spending cap counted floor-locked cash as withdrawable, so a
  // floor-constrained year reported capWasBinding=false / spendingShortfall=0
  // while the waterfall silently under-funded (a phantom Roth withdrawal beyond
  // the Roth balance). The cap now excludes dollars below the bucket floor.
  it('floor-locked cash cannot fund spending: shortfall is reported and the run fails', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 61,
      accounts: [
        { id: 'cash-1', name: 'Cash 1', type: 'cash', balance: 50000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'roth-1', name: 'Roth 1', type: 'roth', balance: 10000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      spendingGoals: [baseSpending(55000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      cashBucketPolicy: { minAmount: 30000, targetAmount: 40000, maxAmount: 90000, refillTrigger: 'gains_only' },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    const bd0 = result.nominalBreakdowns[0];
    // Only 20k of cash sits above the floor; Roth adds 10k. 55k of spending
    // leaves a real 25k gap that must be visible, not silently absorbed.
    expect(bd0.withdrawalFromCash).toBeCloseTo(20000, 0);
    expect(bd0.withdrawalFromRoth).toBeLessThanOrEqual(10000.01);
    expect(bd0.spendingShortfall).toBeCloseTo(25000, 0);
    expect(result.probability).toBe(0);
  });

  it('an inverted band (target < min, only reachable via import) never reports a negative refill', () => {
    // The dialog enforces min ≤ target ≤ max, but a hand-edited imported policy
    // does not. With cash below min and target below cash, `desired` went
    // negative and was recorded as a negative cashRefillFromSurplus in detail
    // rows / CSV (the balance transfer itself was already gated on > 0).
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 63,
      accounts: [
        { id: 'cash-1', name: 'Cash 1', type: 'cash', balance: 20000, stockAllocation: 0, portfolioBalance: '60_40' as const },
        { id: 'brok-1', name: 'Brokerage 1', type: 'brokerage', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [
        { id: 'pension-1', name: 'Pension Income 1', type: 'pension_income', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      spendingGoals: [baseSpending(10000 / 12)],
      portfolioAssumptions: {
        stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
        returnDistribution: 'lognormal', degreesOfFreedom: 4,
        cashYieldRate: 0,
      },
      cashBucketPolicy: { minAmount: 50000, targetAmount: 10000, maxAmount: 60000, refillTrigger: 'always' },
      simulationSettings: { numSimulations: 10 },
    });
    const result = runSimulation(ud, createSeededRandom(1));
    for (const bd of result.nominalBreakdowns) {
      expect(bd.cashRefillFromSurplus).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('per-goal spending attribution (audit.spendingGoalBreakdown)', () => {
  const multiGoalUserData = () => makeUserData({
    currentAge: 60,
    lifeExpectancy: 70,
    accounts: [
      { id: 'brok-1', name: 'Brokerage 1', type: 'brokerage', balance: 2_000_000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
    ],
    spendingGoals: [
      { id: 'live-1', name: 'Living Expenses 1', type: 'living_expenses', amount: 60000, startAge: 60, inflationAdjusted: true },
      { id: 'med-1', name: 'Pre-Medicare Health', type: 'healthcare', amount: 14000, startAge: 60, endAge: 64, inflationAdjusted: true },
      { id: 'kid-1', name: 'Mortgage Help', type: 'dependent_support', amount: 30000, startAge: 62, endAge: 65, inflationAdjusted: false },
      { id: 'trip-1', name: 'Big Trip', type: 'vacation', amount: 20000, startAge: 63, isOneTime: true, inflationAdjusted: false },
    ],
    inflationRate: 0.03,
  });

  it('sums to baseSpendingNet / otherSpendingGoalsNet every year and preserves identity', () => {
    const { breakdowns } = runDeterministicProjection(multiGoalUserData());
    for (const bd of breakdowns) {
      const perGoal = bd.audit?.spendingGoalBreakdown ?? [];
      const living = perGoal.filter(g => g.goalType === 'living_expenses').reduce((s, g) => s + g.amountNet, 0);
      const other = perGoal.filter(g => g.goalType !== 'living_expenses').reduce((s, g) => s + g.amountNet, 0);
      expect(living).toBeCloseTo(bd.baseSpendingNet, 6);
      expect(other).toBeCloseTo(bd.otherSpendingGoalsNet, 6);
    }
    // Year 0 (age 60): living + healthcare active; support and trip not yet.
    const ids0 = (breakdowns[0].audit?.spendingGoalBreakdown ?? []).map(g => g.goalId).sort();
    expect(ids0).toEqual(['live-1', 'med-1']);
    // Year 3 (age 63): all four active; the one-time trip appears exactly once.
    const y3 = breakdowns[3].audit?.spendingGoalBreakdown ?? [];
    expect(y3.map(g => g.goalId).sort()).toEqual(['kid-1', 'live-1', 'med-1', 'trip-1']);
    const trip = y3.find(g => g.goalId === 'trip-1');
    expect(trip?.goalName).toBe('Big Trip');
    expect(trip?.amountNet).toBeCloseTo(20000, 6);
    expect(breakdowns[4].audit?.spendingGoalBreakdown?.some(g => g.goalId === 'trip-1')).toBe(false);
  });
});

describe('per-type beginning-of-year balances (boyBalance*)', () => {
  const mixedAccountsUserData = () => makeUserData({
    currentAge: 60,
    lifeExpectancy: 75,
    accounts: [
      { id: 'trad-1', name: 'Trad', type: 'traditional', balance: 400000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      { id: 'roth-1', name: 'Roth', type: 'roth', balance: 200000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      { id: 'brok-1', name: 'Brokerage', type: 'brokerage', balance: 300000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
      { id: 'cash-1', name: 'HYSA', type: 'cash', balance: 50000, stockAllocation: 0, portfolioBalance: '60_40' as const },
    ],
    spendingGoals: [baseSpending(60000 / 12, 60)],
    portfolioAssumptions: {
      stockReturn: 0.07, stockStdDev: 0, bondReturn: 0.04, bondStdDev: 0,
      stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2,
      returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
      cashYieldRate: 0.04,
    },
    inflationRate: 0.03,
  });

  it('deterministic projection: the four types sum to path[i] × inflation[i] exactly', () => {
    const { path, breakdowns, inflation } = runDeterministicProjection(mixedAccountsUserData());
    expect(breakdowns.length).toBe(path.length);
    for (let i = 0; i < breakdowns.length; i++) {
      const bd = breakdowns[i];
      const sum = bd.boyBalanceTraditional + bd.boyBalanceRoth + bd.boyBalanceBrokerage + bd.boyBalanceCash;
      expect(sum).toBeCloseTo(path[i] * inflation[i], 6);
    }
    // Year 0 is the configured starting balances verbatim.
    expect(breakdowns[0].boyBalanceTraditional).toBeCloseTo(400000, 6);
    expect(breakdowns[0].boyBalanceRoth).toBeCloseTo(200000, 6);
    expect(breakdowns[0].boyBalanceBrokerage).toBeCloseTo(300000, 6);
    expect(breakdowns[0].boyBalanceCash).toBeCloseTo(50000, 6);
  });

  it('seeded Monte Carlo: median-path sums hold and cash continuity links years', () => {
    const ud = mixedAccountsUserData();
    ud.portfolioAssumptions.stockStdDev = 0.15;
    ud.portfolioAssumptions.bondStdDev = 0.05;
    ud.simulationSettings = { numSimulations: 25 };
    const result = runSimulation(ud, createSeededRandom(11));
    for (let i = 0; i < result.medianBreakdowns.length; i++) {
      const bd = result.medianBreakdowns[i];
      const sum = bd.boyBalanceTraditional + bd.boyBalanceRoth + bd.boyBalanceBrokerage + bd.boyBalanceCash;
      expect(sum).toBeCloseTo(result.median[i] * result.medianInflation[i], 4);
      // End-of-year cash equals next year's beginning-of-year cash.
      if (i < result.medianBreakdowns.length - 1) {
        expect(result.medianBreakdowns[i + 1].boyBalanceCash).toBeCloseTo(bd.cashEndingBalance, 4);
      }
    }
  });
});

describe('boyBalance continuity through cash-bucket-policy routing years', () => {
  // The existing continuity test runs with no policy configured. This one
  // guards the Balances chart against a discontinuity exactly in refill/sweep
  // years: cashEndingBalance is recomputed AFTER applyPostConvergenceBucketPolicy
  // moves dollars, and next year's boyBalanceCash must equal that post-routing
  // value (and the four types must still sum to the path).
  it('refill and sweep years keep cashEndingBalance[i] == boyBalanceCash[i+1] and per-type sums exact', () => {
    const ud = makeUserData({
      currentAge: 60,
      lifeExpectancy: 72,
      accounts: [
        { id: 'brok-1', name: 'Brokerage', type: 'brokerage', balance: 800000, stockAllocation: 0.6, portfolioBalance: '60_40' as const },
        { id: 'cash-1', name: 'Cash Bucket', type: 'cash', balance: 70000, stockAllocation: 0, portfolioBalance: '60_40' as const },
      ],
      incomeEvents: [
        // Pension surplus keeps netCashFlow positive so the surplus-only
        // refill has fuel; the sweep leg triggers from cash-interest growth
        // pushing the bucket above maxAmount.
        { id: 'pen-1', name: 'Pension Income 1', type: 'pension_income', amount: 60000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
      ],
      spendingGoals: [baseSpending(30000 / 12, 60)],
      cashBucketPolicy: { minAmount: 20000, targetAmount: 40000, maxAmount: 60000, refillTrigger: 'always' },
      portfolioAssumptions: {
        stockReturn: 0.05, stockStdDev: 0, bondReturn: 0.03, bondStdDev: 0,
        stockBondCorrelationEnabled: false, stockBondCorrelation: -0.2,
        returnDistribution: 'lognormal' as const, degreesOfFreedom: 4,
        cashYieldRate: 0.04,
      },
    });
    const { path, breakdowns, inflation } = runDeterministicProjection(ud);
    // The scenario must actually exercise the routing paths, or this test
    // silently degrades to the no-policy case.
    expect(breakdowns.some(b => b.cashSweepToBrokerage > 0 || b.cashRefillFromSurplus > 0)).toBe(true);
    for (let i = 0; i < breakdowns.length; i++) {
      const bd = breakdowns[i];
      const sum = bd.boyBalanceTraditional + bd.boyBalanceRoth + bd.boyBalanceBrokerage + bd.boyBalanceCash;
      expect(sum).toBeCloseTo(path[i] * inflation[i], 4);
      if (i < breakdowns.length - 1) {
        expect(breakdowns[i + 1].boyBalanceCash).toBeCloseTo(bd.cashEndingBalance, 4);
      }
    }
  });
});
