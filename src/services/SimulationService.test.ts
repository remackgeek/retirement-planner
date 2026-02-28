import { describe, it, expect } from 'vitest';
import { calculateAnnualIncome } from './SimulationService';
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
  spouseAge: null,
  state: 'Florida',
  ...overrides,
});

describe('calculateAnnualIncome', () => {
  describe('aggregate taxation', () => {
    it('applies one standard deduction across multiple before_tax events', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
          { id: '2', type: 'pension_income', amount: 20000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      const income = calculateAnnualIncome(userData, 2026, 0);
      // Combined $40k gross, single FL, deduction $16100, taxable $23900
      // Fed tax: 10% on 12400 = 1240, 12% on 11500 = 1380. Total = 2620
      // Net = 40000 - 2620 = 37380
      expect(income).toBeCloseTo(37380, 0);
    });

    it('passes after_tax income through without tax', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'pension_income', amount: 10000, startAge: 60, taxStatus: 'after_tax', colaType: 'fixed' },
        ],
      });
      expect(calculateAnnualIncome(userData, 2026, 0)).toBe(10000);
    });

    it('returns 0 with no active income events', () => {
      const userData = makeUserData({ incomeEvents: [] });
      expect(calculateAnnualIncome(userData, 2026, 0)).toBe(0);
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
      expect(calculateAnnualIncome(userData, 2026, 0)).toBe(24000);
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
      expect(calculateAnnualIncome(userData, 2026, 0)).toBeCloseTo(39360, 0);
    });
  });

  describe('SS haircut', () => {
    it('applies default 23% haircut from 2034', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' },
        ],
      });
      // Year 2034 (age 68): 30000 * 0.77 = 23100. PI = 11550 < 25000 → 0% taxable
      expect(calculateAnnualIncome(userData, 2034, 0)).toBe(23100);
    });

    it('applies custom haircut percentage', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true, ssHaircutPercent: 30 },
        ],
      });
      // 30000 * 0.70 = 21000
      expect(calculateAnnualIncome(userData, 2034, 0)).toBe(21000);
    });

    it('does not apply haircut when disabled', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false },
        ],
      });
      expect(calculateAnnualIncome(userData, 2034, 0)).toBe(30000);
    });

    it('does not apply haircut before 2034', () => {
      const userData = makeUserData({
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 30000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: true },
        ],
      });
      expect(calculateAnnualIncome(userData, 2033, 0)).toBe(30000);
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
      // Claiming year = 2033 (age 67). 7 years of inflation from 2026.
      // Amount = 24000 * (1.03)^7 = 24000 * 1.22987 ≈ 29516.95
      // PI = 0.5 * 29517 = 14758 < 25000 → no tax
      expect(calculateAnnualIncome(userData, 2033, 0.03)).toBeCloseTo(29516.95, 0);
    });

    it('future dollars: inflates only from claiming year forward', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
        ],
      });
      // Claiming year = 2033. Future basis: no inflation at claiming year (0 years from base).
      // Amount = 24000 (no inflation applied in first year of claiming)
      expect(calculateAnnualIncome(userData, 2033, 0.03)).toBe(24000);
    });

    it('future dollars: applies COLA after claiming year', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false, ssAmountBasis: 'future' },
        ],
      });
      // Year 2035 = 2 years after claiming (2033). Amount = 24000 * (1.03)^2 = 25461.60
      expect(calculateAnnualIncome(userData, 2035, 0.03)).toBeCloseTo(25461.60, 0);
    });

    it('default (no ssAmountBasis) behaves as today\'s dollars', () => {
      const userData = makeUserData({
        currentAge: 60,
        referenceYear: 2026,
        incomeEvents: [
          { id: '1', type: 'social_security', amount: 24000, startAge: 67, taxStatus: 'before_tax', colaType: 'inflation_adjusted', ssHaircutEnabled: false },
        ],
      });
      // Same as today's dollars test: inflates from reference year
      expect(calculateAnnualIncome(userData, 2033, 0.03)).toBeCloseTo(29516.95, 0);
    });
  });
});
