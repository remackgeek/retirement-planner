import type { UserData } from '../types/UserData';
import type { Account, AccountType } from '../types/Account';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
} from './TaxCalculator';

// State tax rates (from user's table, converted to decimal)
export const STATE_TAX_RATES: Record<string, number> = {
  Alabama: 0.05,
  Alaska: 0.0,
  Arizona: 0.025,
  Arkansas: 0.039,
  California: 0.08,
  Colorado: 0.044,
  Connecticut: 0.06,
  Delaware: 0.066,
  Florida: 0.0,
  Georgia: 0.0539,
  Hawaii: 0.079,
  Idaho: 0.057,
  Illinois: 0.0495,
  Indiana: 0.03,
  Iowa: 0.038,
  Kansas: 0.0558,
  Kentucky: 0.04,
  Louisiana: 0.03,
  Maine: 0.0675,
  Maryland: 0.05,
  Massachusetts: 0.05,
  Michigan: 0.0425,
  Minnesota: 0.068,
  Mississippi: 0.044,
  Missouri: 0.047,
  Montana: 0.059,
  Nebraska: 0.052,
  Nevada: 0.0,
  'New Hampshire': 0.0,
  'New Jersey': 0.053,
  'New Mexico': 0.047,
  'New York': 0.055,
  'North Carolina': 0.0425,
  'North Dakota': 0.0195,
  Ohio: 0.0275,
  Oklahoma: 0.0475,
  Oregon: 0.0875,
  Pennsylvania: 0.0307,
  'Rhode Island': 0.0475,
  'South Carolina': 0.062,
  'South Dakota': 0.0,
  Tennessee: 0.0,
  Texas: 0.0,
  Utah: 0.0455,
  Vermont: 0.066,
  Virginia: 0.0575,
  Washington: 0.0,
  'West Virginia': 0.0482,
  Wisconsin: 0.053,
  Wyoming: 0.0,
  'Washington, DC': 0.085,
};

// IRS Uniform Lifetime Table (SECURE 2.0 / 2022 tables) — divisors by age.
// Used to compute Required Minimum Distributions from Traditional accounts at age 73+.
export const IRS_UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94:  9.5, 95:  8.9,
  96:  8.4, 97:  7.8, 98:  7.3, 99:  6.8, 100:  6.4, 101:  6.0,
  102:  5.6, 103:  5.2, 104:  4.9, 105:  4.6, 106:  4.3, 107:  4.1,
  108:  3.9, 109:  3.7, 110:  3.5, 111:  3.4, 112:  3.3, 113:  3.1,
  114:  3.0,
};

export function calculateRMD(tradBalance: number, age: number): number {
  if (age < 73) return 0;
  const divisor = IRS_UNIFORM_LIFETIME_TABLE[Math.min(age, 114)] ?? 2.9;
  return tradBalance / divisor;
}

// Derive log-normal mu/sigma from arithmetic mean return and standard deviation.
function lognormalParams(mean: number, stdDev: number): { mu: number; sigma: number } {
  const sigma = Math.sqrt(Math.log(1 + (stdDev * stdDev) / ((1 + mean) * (1 + mean))));
  const mu = Math.log(1 + mean) - (sigma * sigma) / 2;
  return { mu, sigma };
}

function standardNormalRandom(random: () => number = Math.random): number {
  let u = 0,
    v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateReturnFactor(
  mean: number,
  stdDev: number,
  random: () => number = Math.random
): number {
  const { mu, sigma } = lognormalParams(mean, stdDev);
  const normalSample = mu + sigma * standardNormalRandom(random);
  return Math.exp(normalSample);
}

function getStateTaxRate(userData: UserData, year: number): number {
  const timeline = userData.stateTimeline;
  let effectiveState = timeline[0].state;
  for (let i = 1; i < timeline.length; i++) {
    const startYear = timeline[i].startYear;
    if (startYear != null && year >= startYear) {
      effectiveState = timeline[i].state;
    } else {
      break;
    }
  }
  return STATE_TAX_RATES[effectiveState] || 0;
}

// ---------------- Account helpers ----------------

export function initialAccountBalances(userData: UserData): Record<string, number> {
  return Object.fromEntries(userData.accounts.map((a) => [a.id, a.balance]));
}

export function sumBalances(balances: Record<string, number>): number {
  let sum = 0;
  for (const id in balances) sum += balances[id];
  return sum;
}

function sumBalancesOfType(
  accounts: Account[],
  balances: Record<string, number>,
  type: AccountType
): number {
  let sum = 0;
  for (const a of accounts) {
    if (a.type === type) sum += balances[a.id] ?? 0;
  }
  return sum;
}

// Subtract `amount` from all accounts of a given type, proportional to their current balance.
function subtractFromType(
  accounts: Account[],
  balances: Record<string, number>,
  type: AccountType,
  amount: number
): void {
  if (amount <= 0) return;
  const typeAccounts = accounts.filter((a) => a.type === type);
  const typeTotal = typeAccounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  if (typeTotal <= 0) return;
  const actual = Math.min(amount, typeTotal);
  for (const a of typeAccounts) {
    const bal = balances[a.id] ?? 0;
    const share = (bal / typeTotal) * actual;
    balances[a.id] = Math.max(0, bal - share);
  }
}

function eventActiveInYear(
  userData: UserData,
  event: UserData['incomeEvents'][number],
  year: number
): boolean {
  const ownerAge =
    event.owner === 'spouse' && userData.spouseAge !== null
      ? userData.spouseAge
      : userData.currentAge;
  const startYear = userData.referenceYear + (event.startAge - ownerAge);
  const endYear = event.endAge
    ? userData.referenceYear + (event.endAge - ownerAge)
    : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;
  if (event.isOneTime) return year === startYear;
  return year >= startYear && year <= endYear;
}

function resolveEmploymentSavingsAccountId(
  userData: UserData,
  accountId: string | undefined
): string | null {
  if (accountId && userData.accounts.some((a) => a.id === accountId)) return accountId;
  const trad = userData.accounts.find((a) => a.type === 'traditional');
  if (trad) return trad.id;
  return userData.accounts[0]?.id ?? null;
}

// Distribute a positive net cash flow (surplus or savings contribution) into accounts.
// If any employment_savings events are active this year, split proportionally by their
// inflation-adjusted gross amounts; otherwise deposit into the first available
// taxable → traditional → roth account.
function distributeDeposit(
  userData: UserData,
  year: number,
  amount: number,
  balances: Record<string, number>,
  inflationRate: number
): void {
  if (amount <= 0 || userData.accounts.length === 0) return;
  const active = userData.incomeEvents.filter(
    (e) => e.type === 'employment_savings' && eventActiveInYear(userData, e, year)
  );
  if (active.length > 0) {
    // Use inflation-adjusted amounts so the proportional split matches actual event cash flows.
    const adjustedAmounts = active.map((e) => {
      let amt = Math.max(0, e.amount);
      if (e.colaType === 'inflation_adjusted') {
        const yearsFromBase = year - userData.referenceYear;
        if (yearsFromBase > 0) amt *= Math.pow(1 + inflationRate, yearsFromBase);
      }
      return amt;
    });
    const totalGross = adjustedAmounts.reduce((s, a) => s + a, 0);
    if (totalGross > 0) {
      for (let i = 0; i < active.length; i++) {
        const e = active[i];
        const targetId = resolveEmploymentSavingsAccountId(userData, e.accountId);
        if (!targetId) continue;
        const share = (adjustedAmounts[i] / totalGross) * amount;
        balances[targetId] = (balances[targetId] ?? 0) + share;
      }
      return;
    }
  }
  const target =
    userData.accounts.find((a) => a.type === 'taxable') ??
    userData.accounts.find((a) => a.type === 'traditional') ??
    userData.accounts.find((a) => a.type === 'roth') ??
    userData.accounts[0];
  if (target) {
    balances[target.id] = (balances[target.id] ?? 0) + amount;
  }
}

// Apply the per-bucket withdrawals from a cash-flow breakdown to the account balances,
// then deposit any positive netCashFlow surplus.
function applyCashFlow(
  userData: UserData,
  year: number,
  breakdown: AnnualCashFlowBreakdown,
  balances: Record<string, number>,
  inflationRate: number
): void {
  subtractFromType(userData.accounts, balances, 'taxable', breakdown.withdrawalFromTaxable);
  subtractFromType(userData.accounts, balances, 'traditional', breakdown.withdrawalFromTraditional);
  subtractFromType(userData.accounts, balances, 'roth', breakdown.withdrawalFromRoth);
  // Deposit RMD excess into the first taxable account (already ensured to exist by caller).
  if (breakdown.rmdExcess > 0) {
    const taxableTarget = userData.accounts.find((a) => a.type === 'taxable');
    if (taxableTarget) {
      balances[taxableTarget.id] = (balances[taxableTarget.id] ?? 0) + breakdown.rmdExcess;
    }
  }
  if (breakdown.netCashFlow > 0) {
    distributeDeposit(userData, year, breakdown.netCashFlow, balances, inflationRate);
  }
}

// If Traditional accounts exist and the user will reach age 73, ensure a taxable account
// exists to receive excess RMD reinvestment. Returns a shallow copy with the account added.
function ensureRMDReinvestmentAccount(userData: UserData): UserData {
  if (!userData.accounts.some((a) => a.type === 'traditional')) return userData;
  const totalYears = userData.lifeExpectancy - userData.currentAge;
  if (73 - userData.currentAge > totalYears) return userData; // never reaches RMD age
  if (userData.accounts.some((a) => a.type === 'taxable')) return userData;
  const rmdAccount: Account = {
    id: 'rmd-reinvestment-auto',
    name: 'RMD Reinvestment',
    type: 'taxable',
    balance: 0,
  };
  return { ...userData, accounts: [...userData.accounts, rmdAccount] };
}

// ---------------- Cash-flow calculation ----------------

export interface AnnualCashFlowBreakdown {
  ssGross: number;
  otherTaxableGross: number;
  afterTaxIncome: number;
  totalGrossIncome: number;
  ssTaxableAmount: number;
  baseSpendingNet: number;
  otherSpendingGoalsNet: number;
  totalSpendingNet: number;
  portfolioWithdrawal: number;
  withdrawalFromTaxable: number;
  withdrawalFromTraditional: number;
  withdrawalFromRoth: number;
  totalTax: number;
  ordinaryTax: number;      // ordinary income tax (federal + state) on Traditional + SS + other taxable
  capitalGainsTax: number;  // LTCG tax on taxable account withdrawals
  netCashFlow: number;
  rmdRequired: number;  // IRS-mandated minimum from Traditional; 0 if age < 73
  rmdExcess: number;    // rmdRequired beyond spending need; reinvested to taxable
}

function accumulateIncome(
  userData: UserData,
  year: number,
  inflationRate: number
): { ssGross: number; otherTaxableGross: number; afterTaxIncome: number } {
  let afterTaxIncome = 0;
  let ssGross = 0;
  let otherTaxableGross = 0;

  userData.incomeEvents.forEach((event) => {
    if (!eventActiveInYear(userData, event, year)) return;

    const ownerAge =
      event.owner === 'spouse' && userData.spouseAge !== null
        ? userData.spouseAge
        : userData.currentAge;
    const startYear = userData.referenceYear + (event.startAge - ownerAge);

    let amount = event.amount;
    if (event.colaType === 'inflation_adjusted') {
      let baseYear = userData.referenceYear;
      if (event.type === 'social_security' && event.ssAmountBasis === 'future') {
        baseYear = startYear;
      }
      const yearsFromBase = year - baseYear;
      if (yearsFromBase > 0) {
        amount *= Math.pow(1 + inflationRate, yearsFromBase);
      }
    }

    if (event.type === 'social_security' && event.ssHaircutEnabled !== false && year >= 2034) {
      const reduction = (event.ssHaircutPercent ?? 23) / 100;
      amount *= 1 - reduction;
    }

    if (event.taxStatus === 'after_tax') {
      afterTaxIncome += amount;
    } else if (event.type === 'social_security') {
      ssGross += amount;
    } else {
      otherTaxableGross += amount;
    }
  });

  return { ssGross, otherTaxableGross, afterTaxIncome };
}

function accumulateSpending(
  userData: UserData,
  year: number,
  inflationRate: number
): { baseSpendingNet: number; otherSpendingGoalsNet: number } {
  let baseSpendingNet = 0;
  let otherSpendingGoalsNet = 0;

  userData.spendingGoals.forEach((goal) => {
    const startYear =
      userData.referenceYear + (goal.startAge - userData.currentAge);
    const endYear = goal.endAge
      ? userData.referenceYear + (goal.endAge - userData.currentAge)
      : userData.lifeExpectancy + userData.referenceYear - userData.currentAge;

    let shouldInclude = false;
    if (goal.isOneTime) {
      shouldInclude = year === startYear;
    } else {
      shouldInclude = year >= startYear && year <= endYear;
    }

    if (shouldInclude) {
      let amount = goal.amount;
      if (goal.inflationAdjusted) {
        const yearsFromReference = year - userData.referenceYear;
        amount *= Math.pow(1 + inflationRate, yearsFromReference);
      }
      if (goal.yearlyDecreasePercent != null) {
        const yearsSinceStart = year - startYear;
        amount *= Math.pow(1 - goal.yearlyDecreasePercent / 100, yearsSinceStart);
      }
      if (goal.type === 'living_expenses') {
        baseSpendingNet += amount;
      } else {
        otherSpendingGoalsNet += amount;
      }
    }
  });

  return { baseSpendingNet, otherSpendingGoalsNet };
}

export function calculateAnnualCashFlow(
  userData: UserData,
  year: number,
  inflationRate: number = 0.03,
  accountBalances?: Record<string, number>,
  maxWithdrawal?: number
): AnnualCashFlowBreakdown {
  const income = accumulateIncome(userData, year, inflationRate);
  const spending = accumulateSpending(userData, year, inflationRate);
  const { ssGross, otherTaxableGross, afterTaxIncome } = income;
  const totalSpendingNet = spending.baseSpendingNet + spending.otherSpendingGoalsNet;
  const totalGrossIncome = ssGross + otherTaxableGross + afterTaxIncome;
  const availableCash = afterTaxIncome + ssGross + otherTaxableGross;

  const stateTaxRate = getStateTaxRate(userData, year);
  const age = userData.currentAge + (year - userData.referenceYear);
  const ltcgRate = userData.longTermCapGainsRate ?? 0;

  const balances = accountBalances ?? initialAccountBalances(userData);
  const taxableBal = sumBalancesOfType(userData.accounts, balances, 'taxable');
  const tradBal = sumBalancesOfType(userData.accounts, balances, 'traditional');
  const rothBal = sumBalancesOfType(userData.accounts, balances, 'roth');
  const totalBal = taxableBal + tradBal + rothBal;
  const cap = Math.min(maxWithdrawal ?? Infinity, totalBal);

  const rmdRequired = calculateRMD(tradBal, age);
  let withdrawal = Math.min(Math.max(0, totalSpendingNet - availableCash), cap);
  let totalTax = 0;
  let ssTaxableAmount = 0;
  let fromTaxable = 0;
  let fromTrad = 0;
  let fromRoth = 0;
  let spendingFromTrad = 0;
  let rmdExcess = 0;
  let capWasBinding = false;
  let ordinaryTax = 0;
  let ltcgTax = 0;

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    fromTaxable = Math.min(withdrawal, taxableBal);
    spendingFromTrad = Math.min(Math.max(0, withdrawal - fromTaxable), tradBal);
    fromRoth = Math.max(0, withdrawal - fromTaxable - spendingFromTrad);
    // Force Traditional withdrawal to satisfy RMD even if spending need is lower.
    const forcedTrad = Math.min(Math.max(spendingFromTrad, rmdRequired), tradBal);
    rmdExcess = Math.max(0, forcedTrad - spendingFromTrad);
    fromTrad = forcedTrad;

    const ordinaryGross = otherTaxableGross + fromTrad;
    ssTaxableAmount = calculateSSTaxableAmount(ssGross, ordinaryGross, userData.filingStatus);
    const combinedTaxable = ordinaryGross + ssTaxableAmount;

    ordinaryTax = 0;
    if (combinedTaxable > 0) {
      const net = calculateNetFromGross(
        combinedTaxable,
        stateTaxRate,
        userData.filingStatus,
        age,
        year,
        userData.spouseAge
      );
      ordinaryTax = combinedTaxable - net;
    }
    ltcgTax = fromTaxable * ltcgRate;
    totalTax = ordinaryTax + ltcgTax;

    const uncappedNewWithdrawal = Math.max(0, totalSpendingNet + totalTax - availableCash);
    const newWithdrawal = Math.min(uncappedNewWithdrawal, cap);
    capWasBinding = uncappedNewWithdrawal > cap;

    if (Math.abs(newWithdrawal - withdrawal) < 0.01) {
      withdrawal = newWithdrawal;
      fromTaxable = Math.min(withdrawal, taxableBal);
      spendingFromTrad = Math.min(Math.max(0, withdrawal - fromTaxable), tradBal);
      fromRoth = Math.max(0, withdrawal - fromTaxable - spendingFromTrad);
      const finalForcedTrad = Math.min(Math.max(spendingFromTrad, rmdRequired), tradBal);
      rmdExcess = Math.max(0, finalForcedTrad - spendingFromTrad);
      fromTrad = finalForcedTrad;
      break;
    }
    withdrawal = newWithdrawal;
  }

  const netCashFlow = capWasBinding
    ? -withdrawal || 0
    : availableCash - totalTax - totalSpendingNet;

  return {
    ssGross,
    otherTaxableGross,
    afterTaxIncome,
    totalGrossIncome,
    ssTaxableAmount,
    baseSpendingNet: spending.baseSpendingNet,
    otherSpendingGoalsNet: spending.otherSpendingGoalsNet,
    totalSpendingNet,
    portfolioWithdrawal: fromTaxable + fromTrad + fromRoth,
    withdrawalFromTaxable: fromTaxable,
    withdrawalFromTraditional: fromTrad,
    withdrawalFromRoth: fromRoth,
    totalTax,
    ordinaryTax,
    capitalGainsTax: ltcgTax,
    netCashFlow,
    rmdRequired,
    rmdExcess,
  };
}

interface SimRun {
  path: number[];
  stockFactors: number[];
  bondFactors: number[];
  breakdowns: AnnualCashFlowBreakdown[];
  failed: boolean;
  failedYear: number;
}

export function runSimulation(
  rawUserData: UserData,
  random: () => number = Math.random
): {
  probability: number;
  median: number[];
  medianStockFactors: number[];
  medianBondFactors: number[];
  medianBreakdowns: AnnualCashFlowBreakdown[];
  downside: number[];
  downsideStockFactors: number[];
  downsideBondFactors: number[];
  downsideBreakdowns: AnnualCashFlowBreakdown[];
  nominal: number[];
  nominalBreakdowns: AnnualCashFlowBreakdown[];
  years: number[];
} {
  const userData = ensureRMDReinvestmentAccount(rawUserData);
  const currentYear = userData.referenceYear;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const inflationRate = userData.inflationRate;
  const inflationStdDev = userData.inflationStdDev;
  const numSims = userData.simulationSettings.numSimulations;
  const { stockAllocation, stockReturn, stockStdDev, bondReturn, bondStdDev } =
    userData.portfolioAssumptions;
  const bondAllocation = 1 - stockAllocation;

  let successCount = 0;
  const allRuns: SimRun[] = [];

  for (let sim = 0; sim < numSims; sim++) {
    const balances = initialAccountBalances(userData);
    const path: number[] = [];
    const stockFactors: number[] = [];
    const bondFactors: number[] = [];
    const breakdowns: AnnualCashFlowBreakdown[] = [];
    let failed = false;
    let failedYear = totalYears;
    let cumulativeInflation = 1;

    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;

      const startBalance = sumBalances(balances);
      path.push(startBalance / cumulativeInflation);

      // 1. Growth: apply the same year factor uniformly to each bucket.
      const sf = generateReturnFactor(stockReturn, stockStdDev, random);
      const bf = generateReturnFactor(bondReturn, bondStdDev, random);
      stockFactors.push(sf);
      bondFactors.push(bf);
      const growthFactor = stockAllocation * sf + bondAllocation * bf;
      for (const id in balances) balances[id] *= growthFactor;

      // 2. Cash flow.
      const postGrowth = sumBalances(balances);
      const cashFlow = calculateAnnualCashFlow(userData, year, inflationRate, balances);

      let effectiveCashFlow: AnnualCashFlowBreakdown;
      const spendingExceedsIncome = cashFlow.totalSpendingNet > cashFlow.totalGrossIncome;
      const depleting = spendingExceedsIncome && (postGrowth <= 0 || postGrowth + cashFlow.netCashFlow < 0);
      if (depleting && postGrowth <= 0) {
        effectiveCashFlow = calculateAnnualCashFlow(userData, year, inflationRate, balances, 0);
      } else if (depleting) {
        effectiveCashFlow = calculateAnnualCashFlow(
          userData,
          year,
          inflationRate,
          balances,
          postGrowth
        );
      } else {
        effectiveCashFlow = cashFlow;
      }
      breakdowns.push(effectiveCashFlow);

      if (depleting) {
        if (!failed) failedYear = i;
        failed = true;
      }

      applyCashFlow(userData, year, effectiveCashFlow, balances, inflationRate);
      // Clamp against float drift.
      for (const id in balances) if (balances[id] < 0) balances[id] = 0;

      const yearInflation =
        inflationStdDev > 0
          ? generateReturnFactor(inflationRate, inflationStdDev, random) - 1
          : inflationRate;
      cumulativeInflation *= 1 + yearInflation;
    }

    allRuns.push({ path, stockFactors, bondFactors, breakdowns, failed, failedYear });
    if (!failed) successCount++;
  }

  const probability = Math.round((successCount / numSims) * 100);

  const sorted = [...allRuns].sort((a, b) => {
    const scoreA = a.failed ? a.failedYear : totalYears + a.path[totalYears - 1];
    const scoreB = b.failed ? b.failedYear : totalYears + b.path[totalYears - 1];
    return scoreA - scoreB;
  });
  const medianRun = sorted[Math.floor(numSims * 0.5)];
  const downsideRun = sorted[Math.floor(numSims * 0.1)];

  const years = Array.from({ length: totalYears }, (_, i) => currentYear + i);

  // Deterministic nominal path
  const nominalBlendedReturn = stockAllocation * stockReturn + bondAllocation * bondReturn;
  const nominal: number[] = [];
  const nominalBreakdowns: AnnualCashFlowBreakdown[] = [];
  {
    const balances = initialAccountBalances(userData);
    for (let i = 0; i < totalYears; i++) {
      const year = currentYear + i;
      const inflationFactor = Math.pow(1 + inflationRate, i);
      nominal.push(sumBalances(balances) / inflationFactor);

      for (const id in balances) balances[id] *= 1 + nominalBlendedReturn;
      const postGrowth = sumBalances(balances);
      const cashFlow = calculateAnnualCashFlow(userData, year, inflationRate, balances);
      let effectiveCashFlow: AnnualCashFlowBreakdown;
      const spendExcInc = cashFlow.totalSpendingNet > cashFlow.totalGrossIncome;
      const depleting = spendExcInc && (postGrowth <= 0 || postGrowth + cashFlow.netCashFlow < 0);
      if (depleting && postGrowth <= 0) {
        effectiveCashFlow = calculateAnnualCashFlow(userData, year, inflationRate, balances, 0);
      } else if (depleting) {
        effectiveCashFlow = calculateAnnualCashFlow(userData, year, inflationRate, balances, postGrowth);
      } else {
        effectiveCashFlow = cashFlow;
      }
      nominalBreakdowns.push(effectiveCashFlow);
      applyCashFlow(userData, year, effectiveCashFlow, balances, inflationRate);
      for (const id in balances) if (balances[id] < 0) balances[id] = 0;
    }
  }

  return {
    probability,
    median: medianRun.path,
    medianStockFactors: medianRun.stockFactors,
    medianBondFactors: medianRun.bondFactors,
    medianBreakdowns: medianRun.breakdowns,
    downside: downsideRun.path,
    downsideStockFactors: downsideRun.stockFactors,
    downsideBondFactors: downsideRun.bondFactors,
    downsideBreakdowns: downsideRun.breakdowns,
    nominal,
    nominalBreakdowns,
    years,
  };
}
