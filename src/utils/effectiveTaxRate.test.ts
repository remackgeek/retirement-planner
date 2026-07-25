import { describe, it, expect } from 'vitest';
import { effectiveTaxRate } from './effectiveTaxRate';
import { fmtPct1 } from './formatPercent';
import type { AnnualCashFlowBreakdown } from '../services/SimulationService';

const makeBd = (overrides: Partial<AnnualCashFlowBreakdown>): AnnualCashFlowBreakdown => ({
  ssGross: 0,
  otherTaxableGross: 0,
  afterTaxIncome: 0,
  totalGrossIncome: 0,
  ssTaxableAmount: 0,
  baseSpendingNet: 0,
  otherSpendingGoalsNet: 0,
  totalSpendingNet: 0,
  portfolioWithdrawal: 0,
  withdrawalFromBrokerage: 0,
  withdrawalFromTraditional: 0,
  withdrawalFromRoth: 0,
  withdrawalFromCash: 0,
  cashInterest: 0,
  cashEndingBalance: 0,
  cashRefillFromSurplus: 0,
  cashSweepToBrokerage: 0,
  totalTax: 0,
  ordinaryTax: 0,
  federalCapGainsTax: 0,
  stateCapGainsTax: 0,
  stateLocalitySurcharge: 0,
  irmaaSurcharge: 0,
  niitTax: 0,
  netCashFlow: 0,
  rmdRequired: 0,
  rmdExcess: 0,
  rmdRequiredSelf: 0,
  rmdRequiredSpouse: 0,
  rothConversionGross: 0,
  rothConversionRequested: 0,
  rothConversionTaxFromCash: 0,
  rothConversionTaxFromBrokerage: 0,
  rothConversionTaxFromRmdExcess: 0,
  rothConversionTaxWithheld: 0,
  rothConversionGrossSelf: 0,
  rothConversionGrossSpouse: 0,
  rothConversionTaxWithheldSelf: 0,
  rothConversionTaxWithheldSpouse: 0,
  spendingShortfall: 0,
  wageIncomeGross: 0,
  preTaxContributions: 0,
  rothContributions: 0,
  afterTaxContributions: 0,
  employerMatch: 0,
  surplusContribution: 0,
  contributionsCappedAmount: 0,
  ...overrides,
});

describe('effectiveTaxRate', () => {
  it('computes tax / income on an income-only year', () => {
    const rate = effectiveTaxRate(makeBd({ totalGrossIncome: 100_000, totalTax: 15_000 }));
    expect(rate).toBeCloseTo(0.15, 5);
  });

  it('uses portfolio withdrawals as part of the base on a withdrawal year', () => {
    const rate = effectiveTaxRate(makeBd({
      totalGrossIncome: 30_000,
      portfolioWithdrawal: 70_000,
      totalTax: 12_000,
    }));
    expect(rate).toBeCloseTo(12_000 / 100_000, 5);
  });

  it('excludes rothConversionGross from the denominator (conversion shuffle is not spendable cash)', () => {
    // Trad balance of $80k converted; $10k tax pulled separately. portfolioWithdrawal includes
    // both the conversion and the tax draw, so without the exclusion the rate would be diluted.
    const rate = effectiveTaxRate(makeBd({
      totalGrossIncome: 0,
      portfolioWithdrawal: 90_000, // 80k conversion + 10k tax draw
      rothConversionGross: 80_000,
      totalTax: 10_000,
    }));
    // denom = 0 + 90_000 - 80_000 = 10_000  →  rate = 10/10 = 100%
    expect(rate).toBeCloseTo(1.0, 5);
  });

  it('returns null when totalTax is zero (Roth-only withdrawal year)', () => {
    expect(effectiveTaxRate(makeBd({
      portfolioWithdrawal: 50_000,
      withdrawalFromRoth: 50_000,
      totalTax: 0,
    }))).toBeNull();
  });

  it('returns null when the denominator is zero', () => {
    expect(effectiveTaxRate(makeBd({ totalTax: 1_000 }))).toBeNull();
  });

  it('excludes irmaaSurcharge from the numerator (it is a Medicare premium, not income tax)', () => {
    // totalTax includes $5k of IRMAA on top of $15k income tax. Rate should reflect
    // only the $15k income-tax portion against $100k income.
    const rate = effectiveTaxRate(makeBd({
      totalGrossIncome: 100_000,
      totalTax: 20_000,
      irmaaSurcharge: 5_000,
    }));
    expect(rate).toBeCloseTo(0.15, 5);
  });

  it('returns null when IRMAA is the only "tax" (no actual income tax)', () => {
    expect(effectiveTaxRate(makeBd({
      totalGrossIncome: 50_000,
      totalTax: 4_000,
      irmaaSurcharge: 4_000,
    }))).toBeNull();
  });

  it('returns null when conversion fully offsets the cash-flow base', () => {
    // A pathological case: conversion equals withdrawal exactly with no income.
    expect(effectiveTaxRate(makeBd({
      portfolioWithdrawal: 50_000,
      rothConversionGross: 50_000,
      totalTax: 5_000,
    }))).toBeNull();
  });
});

describe('fmtPct1', () => {
  it('formats with one decimal place and a percent sign', () => {
    expect(fmtPct1(0.142)).toBe('14.2%');
    expect(fmtPct1(0.15)).toBe('15.0%');
    expect(fmtPct1(1)).toBe('100.0%');
    expect(fmtPct1(0)).toBe('0.0%');
  });
});
