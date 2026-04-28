import type { UserData } from '../types/UserData';
import type { Account, AccountType } from '../types/Account';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
} from './TaxCalculator';
import {
  createReturnGenerator,
  createNominalGenerator,
  buildBlackSwanLookup,
  applyBlackSwan,
  type ReturnGenerator,
} from './ReturnGenerator';

// Re-export math primitives for tests/consumers that pulled them from this module
// before the ReturnGenerator extraction.
export {
  lognormalParams,
  standardNormalRandom,
  studentTRandom,
  standardizedTRandom,
} from './ReturnGenerator';

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

function sumBalancesOfTypeAndOwner(
  accounts: Account[],
  balances: Record<string, number>,
  type: AccountType,
  owner: 'self' | 'spouse'
): number {
  let sum = 0;
  for (const a of accounts) {
    if (a.type === type && (a.owner ?? 'self') === owner) sum += balances[a.id] ?? 0;
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

// Add `amount` to all accounts of a given type, proportional to their current balance.
// If no balances exist in the type, deposits to the first account of that type (if any).
function addToType(
  accounts: Account[],
  balances: Record<string, number>,
  type: AccountType,
  amount: number
): void {
  if (amount <= 0) return;
  const typeAccounts = accounts.filter((a) => a.type === type);
  if (typeAccounts.length === 0) return;
  const typeTotal = typeAccounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  if (typeTotal <= 0) {
    const first = typeAccounts[0];
    balances[first.id] = (balances[first.id] ?? 0) + amount;
    return;
  }
  for (const a of typeAccounts) {
    const bal = balances[a.id] ?? 0;
    const share = (bal / typeTotal) * amount;
    balances[a.id] = bal + share;
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
  // Deposit Roth conversion into Roth accounts (pro-rata). A receiving Roth is
  // guaranteed by ensureRothConversionAccount when any conversion event exists.
  if (breakdown.rothConversionGross > 0) {
    addToType(userData.accounts, balances, 'roth', breakdown.rothConversionGross);
  }
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
  const selfReaches73 = 73 - userData.currentAge <= totalYears;
  const spouseReaches73 =
    userData.spouseAge !== null &&
    userData.accounts.some((a) => a.type === 'traditional' && (a.owner ?? 'self') === 'spouse') &&
    73 - userData.spouseAge <= totalYears;
  if (!selfReaches73 && !spouseReaches73) return userData;
  if (userData.accounts.some((a) => a.type === 'taxable')) return userData;
  const rmdAccount: Account = {
    id: 'rmd-reinvestment-auto',
    name: 'RMD Reinvestment',
    type: 'taxable',
    balance: 0,
    stockAllocation: 0.6,
    portfolioBalance: '60_40',
  };
  return { ...userData, accounts: [...userData.accounts, rmdAccount] };
}

// If any Roth conversion events exist but there is no Roth account to receive
// the converted funds, inject a zero-balance "Roth Conversion" Roth account.
function ensureRothConversionAccount(userData: UserData): UserData {
  const hasConversion = userData.incomeEvents.some((e) => e.type === 'roth_conversion');
  if (!hasConversion) return userData;
  if (userData.accounts.some((a) => a.type === 'roth')) return userData;
  const rothAccount: Account = {
    id: 'roth-conversion-auto',
    name: 'Roth Conversion',
    type: 'roth',
    balance: 0,
    stockAllocation: 0.6,
    portfolioBalance: '60_40',
  };
  return { ...userData, accounts: [...userData.accounts, rothAccount] };
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
  withdrawalFromTraditional: number;  // total Traditional outflow: spending + RMD + Roth conversion
  withdrawalFromRoth: number;
  totalTax: number;
  ordinaryTax: number;      // ordinary income tax (federal + state) on Traditional + SS + other taxable
  capitalGainsTax: number;  // LTCG tax on taxable account withdrawals
  netCashFlow: number;
  rmdRequired: number;  // IRS-mandated minimum from Traditional; 0 if age < 73
  rmdExcess: number;    // rmdRequired beyond spending need; reinvested to taxable
  rothConversionGross: number;  // amount converted from Traditional to Roth this year
  spendingShortfall: number;  // unmet spending+tax need when portfolio cap was binding; 0 otherwise
}

function accumulateIncome(
  userData: UserData,
  year: number,
  inflationRate: number
): { ssGross: number; otherTaxableGross: number; afterTaxIncome: number; conversionGross: number } {
  let afterTaxIncome = 0;
  let ssGross = 0;
  let otherTaxableGross = 0;
  let conversionGross = 0;

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

    // Roth conversions are a Trad->Roth transfer: taxed as ordinary income but
    // NOT added to cash available for spending. Tracked separately and applied
    // in calculateAnnualCashFlowCore.
    if (event.type === 'roth_conversion') {
      conversionGross += Math.max(0, amount);
      return;
    }

    if (event.taxStatus === 'after_tax') {
      afterTaxIncome += amount;
    } else if (event.type === 'social_security') {
      ssGross += amount;
    } else {
      otherTaxableGross += amount;
    }
  });

  return { ssGross, otherTaxableGross, afterTaxIncome, conversionGross };
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
  maxWithdrawal?: number,
  beginningTradBalance?: number
): AnnualCashFlowBreakdown {
  const i = year - userData.referenceYear;
  const spouseAge = userData.spouseAge !== null ? userData.spouseAge + i : null;
  const balances = accountBalances ?? initialAccountBalances(userData);

  let beginningTradBalances: { self: number; spouse: number } | undefined;
  if (beginningTradBalance !== undefined) {
    const selfBal = sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'self');
    const spouseBal = sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'spouse');
    const total = selfBal + spouseBal;
    beginningTradBalances = total > 0
      ? { self: beginningTradBalance * (selfBal / total), spouse: beginningTradBalance * (spouseBal / total) }
      : { self: beginningTradBalance, spouse: 0 };
  }

  return calculateAnnualCashFlowCore(
    userData,
    year,
    accumulateIncome(userData, year, inflationRate),
    accumulateSpending(userData, year, inflationRate),
    getStateTaxRate(userData, year),
    userData.currentAge + i,
    spouseAge,
    balances,
    beginningTradBalances,
    maxWithdrawal
  );
}

// Fast-path: accepts precomputed per-year inputs so the MC loop can hoist
// their computation out of the 5000-run inner loop. Logic is identical to
// calculateAnnualCashFlow below the precompute step.
function calculateAnnualCashFlowCore(
  userData: UserData,
  year: number,
  income: {
    ssGross: number;
    otherTaxableGross: number;
    afterTaxIncome: number;
    conversionGross: number;
  },
  spending: { baseSpendingNet: number; otherSpendingGoalsNet: number },
  stateTaxRate: number,
  age: number,
  spouseAge: number | null,
  balances: Record<string, number>,
  // IRS rule: RMD for year N uses Dec 31 of year N-1 (beginning-of-year) balance.
  // Pass pre-growth balance from the simulation loop; falls back to current tradBal.
  beginningTradBalances?: { self: number; spouse: number },
  maxWithdrawal?: number
): AnnualCashFlowBreakdown {
  const { ssGross, otherTaxableGross, afterTaxIncome, conversionGross } = income;
  const totalSpendingNet = spending.baseSpendingNet + spending.otherSpendingGoalsNet;
  const totalGrossIncome = ssGross + otherTaxableGross + afterTaxIncome;
  const availableCash = afterTaxIncome + ssGross + otherTaxableGross;

  const ltcgRate = userData.longTermCapGainsRate ?? 0;
  const taxableBal = sumBalancesOfType(userData.accounts, balances, 'taxable');
  const tradBal = sumBalancesOfType(userData.accounts, balances, 'traditional');
  const rothBal = sumBalancesOfType(userData.accounts, balances, 'roth');
  const totalBal = taxableBal + tradBal + rothBal;
  const cap = Math.min(maxWithdrawal ?? Infinity, totalBal);

  const selfTradBal = beginningTradBalances?.self
    ?? sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'self');
  const spouseTradBal = beginningTradBalances?.spouse
    ?? sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'spouse');
  const selfRmd = calculateRMD(selfTradBal, age);
  const spouseRmd = spouseAge !== null ? calculateRMD(spouseTradBal, spouseAge) : 0;
  const rmdRequired = selfRmd + spouseRmd;
  let withdrawal = Math.min(Math.max(0, totalSpendingNet - availableCash), cap);
  let totalTax = 0;
  let ssTaxableAmount = 0;
  let fromTaxable = 0;
  let fromTrad = 0;
  let fromRoth = 0;
  let spendingFromTrad = 0;
  let rmdExcess = 0;
  let rothConversion = 0;
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
    // Roth conversion: taken from Traditional balance remaining after RMD/spending,
    // routed to Roth. Taxed as ordinary income (added to fromTrad for tax calc).
    // IRS rule: RMD must be satisfied first (not eligible for conversion) — handled
    // implicitly because forcedTrad is already reserved here.
    const availableForConversion = Math.max(0, tradBal - forcedTrad);
    rothConversion = Math.min(Math.max(0, conversionGross), availableForConversion);
    fromTrad = forcedTrad + rothConversion;

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
      const finalAvailableForConversion = Math.max(0, tradBal - finalForcedTrad);
      rothConversion = Math.min(Math.max(0, conversionGross), finalAvailableForConversion);
      fromTrad = finalForcedTrad + rothConversion;
      break;
    }
    withdrawal = newWithdrawal;
  }

  const netCashFlow = capWasBinding
    ? -withdrawal || 0
    : availableCash - totalTax - totalSpendingNet;

  const uncappedNeed = Math.max(0, totalSpendingNet + totalTax - availableCash);
  const spendingShortfall = capWasBinding ? Math.max(0, uncappedNeed - withdrawal) : 0;

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
    rothConversionGross: rothConversion,
    spendingShortfall,
  };
}

interface SimRun {
  path: number[];
  stockFactors: number[];
  bondFactors: number[];
  breakdowns: AnnualCashFlowBreakdown[];
  inflation: number[];
  failed: boolean;
  failedYear: number;
}

// Per-year precomputes shared across every run. Pulled out of the hot loop and
// passed by reference into simulateOneRun.
interface Precomputes {
  stateTaxRateByYear: number[];
  ageByYear: number[];
  spouseAgeByYear: Array<number | null>;
  incomeByYear: Array<{
    ssGross: number;
    otherTaxableGross: number;
    afterTaxIncome: number;
    conversionGross: number;
  }>;
  spendingByYear: Array<{
    baseSpendingNet: number;
    otherSpendingGoalsNet: number;
  }>;
}

// Execute a single simulation run (Monte Carlo sim, historical slice, or nominal
// projection) against the provided ReturnGenerator. Applies the black-swan overlay
// after the base draw. Structure is identical across all generators — only the
// factor source differs.
function simulateOneRun(
  userData: UserData,
  precomputes: Precomputes,
  generator: ReturnGenerator,
  runIndex: number,
  random: () => number,
  blackSwanLookup: Map<number, { stockMultiplier: number; bondMultiplier: number }>
): SimRun {
  const currentYear = userData.referenceYear;
  const totalYears = precomputes.ageByYear.length;
  const inflationRate = userData.inflationRate;

  const allocationById = new Map<string, number>(
    userData.accounts.map((a) => [a.id, a.stockAllocation])
  );

  const balances = initialAccountBalances(userData);
  const path: number[] = [];
  const stockFactors: number[] = [];
  const bondFactors: number[] = [];
  const breakdowns: AnnualCashFlowBreakdown[] = [];
  const inflation: number[] = [];
  let failed = false;
  let failedYear = totalYears;
  let cumulativeInflation = 1;

  for (let i = 0; i < totalYears; i++) {
    const year = currentYear + i;
    const yearIncome = precomputes.incomeByYear[i];
    const yearSpending = precomputes.spendingByYear[i];
    const yearStateTaxRate = precomputes.stateTaxRateByYear[i];
    const yearAge = precomputes.ageByYear[i];
    const yearSpouseAge = precomputes.spouseAgeByYear[i];

    const startBalance = sumBalances(balances);
    path.push(startBalance / cumulativeInflation);
    inflation.push(cumulativeInflation);

    // IRS rule: RMD uses Dec 31 of prior year (beginning-of-year) balance, split by owner.
    const beginningTradBalances = {
      self: sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'self'),
      spouse: sumBalancesOfTypeAndOwner(userData.accounts, balances, 'traditional', 'spouse'),
    };

    // 1. Growth: draw base factors, apply black-swan overlay, blend by allocation.
    const base = generator.drawFactors(runIndex, i, random);
    const { stockFactor: sf, bondFactor: bf } = applyBlackSwan(base, year, blackSwanLookup);
    stockFactors.push(sf);
    bondFactors.push(bf);
    for (const id in balances) {
      const sa = allocationById.get(id) ?? 0.6; // fallback for synthetic accounts added mid-run
      balances[id] *= sa * sf + (1 - sa) * bf;
    }

    // 2. Cash flow.
    const postGrowth = sumBalances(balances);
    const cashFlow = calculateAnnualCashFlowCore(
      userData, year, yearIncome, yearSpending, yearStateTaxRate, yearAge, yearSpouseAge, balances, beginningTradBalances
    );

    let effectiveCashFlow: AnnualCashFlowBreakdown;
    const spendingExceedsIncome = cashFlow.totalSpendingNet > cashFlow.totalGrossIncome;
    const depleting = spendingExceedsIncome && (postGrowth <= 0 || postGrowth + cashFlow.netCashFlow < 0);
    if (depleting && postGrowth <= 0) {
      effectiveCashFlow = calculateAnnualCashFlowCore(
        userData, year, yearIncome, yearSpending, yearStateTaxRate, yearAge, yearSpouseAge, balances, beginningTradBalances, 0
      );
    } else if (depleting) {
      effectiveCashFlow = calculateAnnualCashFlowCore(
        userData, year, yearIncome, yearSpending, yearStateTaxRate, yearAge, yearSpouseAge, balances, beginningTradBalances, postGrowth
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

    const yearInflation = generator.drawInflation(runIndex, i, random);
    cumulativeInflation *= 1 + yearInflation;
  }

  return { path, stockFactors, bondFactors, breakdowns, inflation, failed, failedYear };
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
  medianInflation: number[];
  downside: number[];
  downsideStockFactors: number[];
  downsideBondFactors: number[];
  downsideBreakdowns: AnnualCashFlowBreakdown[];
  downsideInflation: number[];
  nominal: number[];
  nominalBreakdowns: AnnualCashFlowBreakdown[];
  nominalInflation: number[];
  years: number[];
} {
  const userData = ensureRothConversionAccount(ensureRMDReinvestmentAccount(rawUserData));
  const currentYear = userData.referenceYear;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const inflationRate = userData.inflationRate;

  // Precompute balance-independent inputs once. Shared across every run.
  const stateTaxRateByYear: number[] = new Array(totalYears);
  const ageByYear: number[] = new Array(totalYears);
  const spouseAgeByYear: Array<number | null> = new Array(totalYears);
  const incomeByYear: Precomputes['incomeByYear'] = new Array(totalYears);
  const spendingByYear: Precomputes['spendingByYear'] = new Array(totalYears);
  for (let i = 0; i < totalYears; i++) {
    const year = currentYear + i;
    stateTaxRateByYear[i] = getStateTaxRate(userData, year);
    ageByYear[i] = userData.currentAge + i;
    spouseAgeByYear[i] = userData.spouseAge !== null ? userData.spouseAge + i : null;
    incomeByYear[i] = accumulateIncome(userData, year, inflationRate);
    spendingByYear[i] = accumulateSpending(userData, year, inflationRate);
  }
  const precomputes: Precomputes = {
    stateTaxRateByYear, ageByYear, spouseAgeByYear, incomeByYear, spendingByYear,
  };

  const generator = createReturnGenerator(userData, random);
  const blackSwanLookup = buildBlackSwanLookup(userData);
  const numRuns = generator.getNumRuns();

  let successCount = 0;
  const allRuns: SimRun[] = new Array(numRuns);
  for (let r = 0; r < numRuns; r++) {
    const run = simulateOneRun(userData, precomputes, generator, r, random, blackSwanLookup);
    allRuns[r] = run;
    if (!run.failed) successCount++;
  }

  const probability = Math.round((successCount / numRuns) * 100);

  const sorted = [...allRuns].sort((a, b) => {
    const scoreA = a.failed ? a.failedYear : totalYears + a.path[totalYears - 1];
    const scoreB = b.failed ? b.failedYear : totalYears + b.path[totalYears - 1];
    return scoreA - scoreB;
  });
  const medianRun = sorted[Math.floor(numRuns * 0.5)];
  const downsideRun = sorted[Math.floor(numRuns * 0.1)];

  const years = Array.from({ length: totalYears }, (_, i) => currentYear + i);

  // Deterministic nominal projection: blended mean return every year, deterministic
  // inflation. Runs through the same simulateOneRun path with a NominalGenerator —
  // no duplicated loop body. Black-swan overlay applies here too: it's a user-defined
  // override of what happens in a given year, so the deterministic projection should
  // reflect it just like the stochastic runs do.
  const nominalGenerator = createNominalGenerator(userData);
  const nominalRun = simulateOneRun(
    userData, precomputes, nominalGenerator, 0, random, blackSwanLookup
  );

  return {
    probability,
    median: medianRun.path,
    medianStockFactors: medianRun.stockFactors,
    medianBondFactors: medianRun.bondFactors,
    medianBreakdowns: medianRun.breakdowns,
    medianInflation: medianRun.inflation,
    downside: downsideRun.path,
    downsideStockFactors: downsideRun.stockFactors,
    downsideBondFactors: downsideRun.bondFactors,
    downsideBreakdowns: downsideRun.breakdowns,
    downsideInflation: downsideRun.inflation,
    nominal: nominalRun.path,
    nominalBreakdowns: nominalRun.breakdowns,
    nominalInflation: nominalRun.inflation,
    years,
  };
}
