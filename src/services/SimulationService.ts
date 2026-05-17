import type { UserData } from '../types/UserData';
import type { Account, AccountType, AccountKind } from '../types/Account';
import {
  calculateNetFromGross,
  calculateSSTaxableAmount,
  clearTaxCalculationCache,
} from './TaxCalculator';
import { calculateIRMAA, calculateNIIT } from './IRMAA';
import { getContributionLimits } from '../utils/contributionLimits';
import {
  createReturnGenerator,
  createNominalGenerator,
  buildBlackSwanLookup,
  applyBlackSwan,
  type ReturnGenerator,
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

// ---------------- Account index (precompute) ----------------

// Precomputed account lookup tables — hoisted out of the per-year-per-run
// hot path. Treat as immutable per simulation; mutating mid-run silently
// desyncs balances and contribution routing. See the "Precompute phase" note
// above the Precomputes interface.
interface AccountIndex {
  byId: Map<string, Account>;
  byType: Record<AccountType, Account[]>;
  firstTaxable: Account | null;
  // event.id → resolved deposit-target account.id, for retirement_contribution events.
  // Built once so depositContributions doesn't re-resolve per year per run.
  contributionTargetByEventId: Map<string, string>;
  // account.id → stockAllocation, for the inner growth loop.
  allocationById: Map<string, number>;
}

function buildAccountIndex(userData: UserData): AccountIndex {
  const byId = new Map<string, Account>();
  const byType: Record<AccountType, Account[]> = { taxable: [], traditional: [], roth: [] };
  const allocationById = new Map<string, number>();
  for (const a of userData.accounts) {
    byId.set(a.id, a);
    byType[a.type].push(a);
    allocationById.set(a.id, a.stockAllocation);
  }
  const contributionTargetByEventId = new Map<string, string>();
  for (const e of userData.incomeEvents) {
    if (e.type !== 'retirement_contribution') continue;
    const id = resolveContributionAccountId(userData, e);
    if (id) contributionTargetByEventId.set(e.id, id);
  }
  return {
    byId,
    byType,
    firstTaxable: byType.taxable[0] ?? null,
    contributionTargetByEventId,
    allocationById,
  };
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

// Subtract `amount` from a precomputed list of accounts, proportional to current balance.
function subtractFromAccounts(
  typeAccounts: Account[],
  balances: Record<string, number>,
  amount: number
): void {
  if (amount <= 0) return;
  let typeTotal = 0;
  for (const a of typeAccounts) typeTotal += balances[a.id] ?? 0;
  if (typeTotal <= 0) return;
  const actual = Math.min(amount, typeTotal);
  for (const a of typeAccounts) {
    const bal = balances[a.id] ?? 0;
    const share = (bal / typeTotal) * actual;
    balances[a.id] = Math.max(0, bal - share);
  }
}

// Add `amount` to a precomputed list of accounts, proportional to current balance.
// If no balances exist in the type, deposits to the first account of that type (if any).
function addToAccounts(
  typeAccounts: Account[],
  balances: Record<string, number>,
  amount: number
): void {
  if (amount <= 0 || typeAccounts.length === 0) return;
  let typeTotal = 0;
  for (const a of typeAccounts) typeTotal += balances[a.id] ?? 0;
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

// Resolve the deposit-target account for a retirement_contribution event.
// Falls back to the first account of the type implied by contributionType, then any account.
function resolveContributionAccountId(
  userData: UserData,
  event: UserData['incomeEvents'][number]
): string | null {
  const requiredType: AccountType =
    event.contributionType === 'pre_tax'
      ? 'traditional'
      : event.contributionType === 'roth'
        ? 'roth'
        : 'taxable';
  if (event.accountId) {
    const explicit = userData.accounts.find((a) => a.id === event.accountId);
    if (explicit) return explicit.id;
  }
  const ofType = userData.accounts.find((a) => a.type === requiredType);
  if (ofType) return ofType.id;
  return userData.accounts[0]?.id ?? null;
}

// Deposit retirement contributions (employee + employer match) into precomputed targets.
// Routing: pre_tax → traditional, roth → roth, after_tax → taxable. Employer match
// is deposited to the same target as the employee contribution (a documented
// simplification — pre-SECURE 2.0 employer match always went to the pre-tax bucket;
// modeling it consistently with the employee contribution is the cleaner approximation).
function depositContributions(
  accountIndex: AccountIndex,
  contributions: ContributionDeposit[],
  balances: Record<string, number>
): void {
  for (const c of contributions) {
    const total = c.employeeAmount + c.employerMatch;
    if (total <= 0) continue;
    const targetId = accountIndex.contributionTargetByEventId.get(c.eventId);
    if (!targetId) continue;
    balances[targetId] = (balances[targetId] ?? 0) + total;
  }
}

// Apply the per-bucket withdrawals from a cash-flow breakdown to the account balances,
// then deposit retirement contributions and any positive netCashFlow surplus.
function applyCashFlow(
  accountIndex: AccountIndex,
  breakdown: AnnualCashFlowBreakdown,
  contributions: ContributionDeposit[],
  balances: Record<string, number>
): void {
  subtractFromAccounts(accountIndex.byType.taxable, balances, breakdown.withdrawalFromTaxable);
  subtractFromAccounts(accountIndex.byType.traditional, balances, breakdown.withdrawalFromTraditional);
  subtractFromAccounts(accountIndex.byType.roth, balances, breakdown.withdrawalFromRoth);
  // Deposit Roth conversion into Roth accounts (pro-rata). A receiving Roth is
  // guaranteed by ensureRothConversionAccount when any conversion event exists.
  if (breakdown.rothConversionGross > 0) {
    addToAccounts(accountIndex.byType.roth, balances, breakdown.rothConversionGross);
  }
  // Deposit RMD excess into the first taxable account (already ensured to exist by caller).
  if (breakdown.rmdExcess > 0 && accountIndex.firstTaxable) {
    const id = accountIndex.firstTaxable.id;
    balances[id] = (balances[id] ?? 0) + breakdown.rmdExcess;
  }
  // Retirement contributions (explicit deposit instructions, independent of surplus).
  depositContributions(accountIndex, contributions, balances);
  // Surplus: deposit any positive netCashFlow into the first taxable account.
  // ensureReinvestmentAccount guarantees one exists when surplus is possible.
  if (breakdown.netCashFlow > 0 && accountIndex.firstTaxable) {
    const id = accountIndex.firstTaxable.id;
    balances[id] = (balances[id] ?? 0) + breakdown.netCashFlow;
  }
}

// Ensure a taxable account exists to receive (a) excess RMD reinvestment from
// Traditional balances after age 73 and (b) general surplus (positive netCashFlow)
// from any year. The synthetic "Reinvestment" account starts at $0 and only matters
// if it actually receives deposits; injecting it whenever no taxable account exists
// is trivially safe. Returns a shallow copy with the account added when needed.
function ensureReinvestmentAccount(userData: UserData): UserData {
  if (userData.accounts.some((a) => a.type === 'taxable')) return userData;
  const reinvestAccount: Account = {
    id: 'reinvestment-auto',
    name: 'Reinvestment',
    type: 'taxable',
    balance: 0,
    stockAllocation: 0.6,
    portfolioBalance: '60_40',
  };
  return { ...userData, accounts: [...userData.accounts, reinvestAccount] };
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
  otherTaxableGross: number;     // post-pre-tax-deduction (wage_income + other before_tax − pre_tax contributions)
  afterTaxIncome: number;
  totalGrossIncome: number;      // post-pre-tax-deduction sum of taxable + after_tax + SS
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
  federalCapGainsTax: number; // federal LTCG tax on taxable account withdrawals (longTermCapGainsRate × fromTaxable)
  stateCapGainsTax: number;   // state tax on taxable account withdrawals (most states treat LTCG as ordinary)
  irmaaSurcharge: number;     // Medicare IRMAA Part B+D surcharge (per enrollee × enrollee count); 0 if disabled or pre-65
  niitTax: number;            // 3.8% Net Investment Income Tax on the lesser of investment income or MAGI excess
  netCashFlow: number;
  rmdRequired: number;  // IRS-mandated minimum from Traditional; 0 if age < 73
  rmdExcess: number;    // rmdRequired beyond spending need; reinvested to taxable
  rothConversionGross: number;  // amount converted from Traditional to Roth this year
  spendingShortfall: number;  // unmet spending+tax need when portfolio cap was binding; 0 otherwise
  wageIncomeGross: number;          // sum of wage_income events (already included in otherTaxableGross before any pre-tax deduction)
  preTaxContributions: number;      // employee pre_tax contributions deposited to Traditional this year
  rothContributions: number;        // employee Roth contributions deposited to Roth this year
  afterTaxContributions: number;    // employee after_tax contributions deposited to Taxable this year
  employerMatch: number;            // employer match deposited (routed to same target as employee contribution)
  contributionsCappedAmount: number; // total employee contribution dollars cut by IRS caps this year
  surplusContribution: number;       // positive netCashFlow deposited to taxable as general surplus this year
}

// Per-event contribution deposit instruction emitted by accumulateIncome and consumed
// by applyCashFlow. Kept separate from AnnualCashFlowBreakdown so the deposit routing
// has access to the originating event (for accountId / contributionType).
export interface ContributionDeposit {
  eventId: string;
  employeeAmount: number;
  employerMatch: number;
}

export interface AccumulatedIncome {
  ssGross: number;
  // otherTaxableGross is wage_income + other before_tax events MINUS pre_tax contributions
  // (i.e., already net of pre-tax deduction — feeds directly into the tax calc).
  otherTaxableGross: number;
  afterTaxIncome: number;
  conversionGross: number;
  wageIncomeGross: number;        // sum of wage_income events (pre-deduction)
  preTaxContributions: number;    // employee pre_tax contributions for this year
  rothContributions: number;
  afterTaxContributions: number;
  employerMatch: number;
  contributions: ContributionDeposit[];
  contributionsCappedAmount: number;
}

// Resolve the cap-classification kind for a given target account.
// Defaults: 'taxable' → brokerage; 'traditional' / 'roth' → IRA when accountKind is absent.
function getAccountKind(account: Account): AccountKind {
  if (account.accountKind) return account.accountKind;
  return account.type === 'taxable' ? 'brokerage' : 'ira';
}

function inflateAmount(
  userData: UserData,
  event: UserData['incomeEvents'][number],
  year: number,
  inflationRate: number
): number {
  let amount = event.amount;
  if (event.colaType === 'inflation_adjusted') {
    const ownerAge =
      event.owner === 'spouse' && userData.spouseAge !== null
        ? userData.spouseAge
        : userData.currentAge;
    const startYear = userData.referenceYear + (event.startAge - ownerAge);
    let baseYear = userData.referenceYear;
    if (event.type === 'social_security' && event.ssAmountBasis === 'future') {
      baseYear = startYear;
    }
    const yearsFromBase = year - baseYear;
    if (yearsFromBase > 0) {
      amount *= Math.pow(1 + inflationRate, yearsFromBase);
    }
  }
  return amount;
}

function accumulateIncome(
  userData: UserData,
  year: number,
  inflationRate: number
): AccumulatedIncome {
  let afterTaxIncome = 0;
  let ssGross = 0;
  let otherTaxableGross = 0;
  let conversionGross = 0;
  let wageIncomeGross = 0;
  let preTaxContributions = 0;
  let rothContributions = 0;
  let afterTaxContributions = 0;
  let employerMatchTotal = 0;
  const contributions: ContributionDeposit[] = [];

  // Pre-pass: build wage-amount lookup keyed by event id so contributions linked to
  // a wage event can compute employer-match base off the inflated wage amount.
  const wageAmountById = new Map<string, number>();
  userData.incomeEvents.forEach((event) => {
    if (event.type !== 'wage_income') return;
    if (!eventActiveInYear(userData, event, year)) return;
    wageAmountById.set(event.id, inflateAmount(userData, event, year, inflationRate));
  });

  userData.incomeEvents.forEach((event) => {
    if (!eventActiveInYear(userData, event, year)) return;

    const amount = inflateAmount(userData, event, year, inflationRate);

    // Roth conversions are a Trad->Roth transfer: taxed as ordinary income but
    // NOT added to cash available for spending. Tracked separately.
    if (event.type === 'roth_conversion') {
      conversionGross += Math.max(0, amount);
      return;
    }

    // Retirement contributions are deposit instructions — they do NOT add to
    // spendable cash. pre_tax additionally reduces taxable income (handled below).
    if (event.type === 'retirement_contribution') {
      const employeeAmount = Math.max(0, amount);
      const matchBase = event.wageEventId
        ? wageAmountById.get(event.wageEventId) ?? employeeAmount
        : employeeAmount;
      let match = 0;
      if (event.employerMatchPercent && event.employerMatchPercent > 0) {
        const matchRate = event.employerMatchPercent / 100;
        const ceilingRate =
          event.employerMatchCeilingPercent != null
            ? Math.max(0, event.employerMatchCeilingPercent) / 100
            : Infinity;
        // Industry convention: match X% of every dollar contributed up to a ceiling
        // expressed as % of the wage base. Cap contribution-eligible-for-match at
        // ceiling × wageBase, then multiply by matchRate.
        const cappedContribution =
          ceilingRate === Infinity
            ? employeeAmount
            : Math.min(employeeAmount, ceilingRate * matchBase);
        match = cappedContribution * matchRate;
      }
      contributions.push({ eventId: event.id, employeeAmount, employerMatch: match });
      employerMatchTotal += match;
      switch (event.contributionType) {
        case 'pre_tax':
          preTaxContributions += employeeAmount;
          break;
        case 'roth':
          rothContributions += employeeAmount;
          break;
        case 'after_tax':
        default:
          afterTaxContributions += employeeAmount;
          break;
      }
      return;
    }

    if (event.type === 'wage_income') {
      // Wage income is taxable ordinary income (always before_tax).
      wageIncomeGross += amount;
      otherTaxableGross += amount;
      return;
    }

    let effectiveAmount = amount;
    if (event.type === 'social_security' && event.ssHaircutEnabled !== false && year >= 2034) {
      const reduction = (event.ssHaircutPercent ?? 23) / 100;
      effectiveAmount *= 1 - reduction;
    }

    if (event.taxStatus === 'after_tax') {
      afterTaxIncome += effectiveAmount;
    } else if (event.type === 'social_security') {
      ssGross += effectiveAmount;
    } else {
      otherTaxableGross += effectiveAmount;
    }
  });

  // Enforce IRS contribution caps per (owner, kind). Excess is removed from the deposit
  // instructions and refunded to the owner as spendable cash (added to afterTaxIncome).
  // Overflow goes to afterTaxIncome rather than netCashFlow because the cap is applied
  // pre-tax-calc — the un-deposited dollars are effectively after-tax wages the owner
  // keeps. Phase 4 may route this overflow to a taxable account via the surplus path.
  const limits = getContributionLimits(userData);
  const inflationFactor = limits.inflationAdjusted
    ? Math.pow(1 + inflationRate, year - userData.referenceYear)
    : 1;
  // Group contributions by (owner, kind) — kind ∈ {'401k','ira'}; 'brokerage' is uncapped.
  type Group = {
    owner: 'self' | 'spouse';
    kind: '401k' | 'ira';
    age: number;
    employeeTotal: number;
    preTax: number;
    roth: number;
    indices: number[]; // indices into `contributions` array for proportional scaling
  };
  const groups = new Map<string, Group>();
  contributions.forEach((c, idx) => {
    const event = userData.incomeEvents.find((e) => e.id === c.eventId);
    if (!event || event.type !== 'retirement_contribution') return;
    const targetId = resolveContributionAccountId(userData, event);
    if (!targetId) return;
    const target = userData.accounts.find((a) => a.id === targetId);
    if (!target) return;
    const kind = getAccountKind(target);
    if (kind === 'brokerage') return; // after_tax / brokerage deposits are uncapped
    const owner: 'self' | 'spouse' = event.owner ?? 'self';
    const age =
      owner === 'spouse' && userData.spouseAge !== null
        ? userData.spouseAge + (year - userData.referenceYear)
        : userData.currentAge + (year - userData.referenceYear);
    const key = `${owner}:${kind}`;
    let g = groups.get(key);
    if (!g) {
      g = { owner, kind, age, employeeTotal: 0, preTax: 0, roth: 0, indices: [] };
      groups.set(key, g);
    }
    g.employeeTotal += c.employeeAmount;
    if (event.contributionType === 'pre_tax') g.preTax += c.employeeAmount;
    else if (event.contributionType === 'roth') g.roth += c.employeeAmount;
    g.indices.push(idx);
  });

  let contributionsCappedAmount = 0;
  groups.forEach((g) => {
    const baseLimit = g.kind === '401k' ? limits.elective401k : limits.iraLimit;
    const catchUp = g.age >= limits.catchUpAge
      ? (g.kind === '401k' ? limits.catchUp401k : limits.catchUpIra)
      : 0;
    const cap = (baseLimit + catchUp) * inflationFactor;
    if (g.employeeTotal <= cap || g.employeeTotal <= 0) return;
    const scale = cap / g.employeeTotal;
    // Scale this group's deposits proportionally and tally the cut.
    let cutThisGroup = 0;
    let preTaxCutThisGroup = 0;
    for (const idx of g.indices) {
      const c = contributions[idx];
      const event = userData.incomeEvents.find((e) => e.id === c.eventId);
      const oldEmp = c.employeeAmount;
      const newEmp = oldEmp * scale;
      const cut = oldEmp - newEmp;
      cutThisGroup += cut;
      if (event?.contributionType === 'pre_tax') preTaxCutThisGroup += cut;
      // Scale employer match proportionally — the match base shrinks with the
      // employee contribution, so the previously-computed match is reduced 1:1.
      c.employeeAmount = newEmp;
      c.employerMatch *= scale;
    }
    // Adjust per-bucket totals.
    if (g.preTax > 0 && preTaxCutThisGroup > 0) {
      preTaxContributions -= preTaxCutThisGroup;
    }
    const rothCut = g.roth > 0 ? cutThisGroup * (g.roth / g.employeeTotal) : 0;
    if (rothCut > 0) rothContributions -= rothCut;
    // Recompute employer match total from scratch for safety (cheap).
    contributionsCappedAmount += cutThisGroup;
  });
  // Recompute employer match total after scaling.
  if (contributionsCappedAmount > 0) {
    employerMatchTotal = contributions.reduce((s, c) => s + c.employerMatch, 0);
  }

  // Pre-tax contributions reduce taxable wage/before-tax income for the tax calc.
  // Floor at zero so contributions in excess of taxable income don't create a refund.
  // Note on overflow routing: capped pre_tax dollars stay in `otherTaxableGross`
  // automatically because we already reduced `preTaxContributions` above before
  // this subtraction — the worker is taxed on the un-diverted wages. Capped roth
  // dollars come out of post-tax wages that already flowed through wage_income;
  // since the deposit is just skipped, the dollars naturally remain in the year's
  // available cash via the wage event. No explicit re-injection needed.
  otherTaxableGross = Math.max(0, otherTaxableGross - preTaxContributions);

  return {
    ssGross,
    otherTaxableGross,
    afterTaxIncome,
    conversionGross,
    wageIncomeGross,
    preTaxContributions,
    rothContributions,
    afterTaxContributions,
    employerMatch: employerMatchTotal,
    contributions,
    contributionsCappedAmount,
  };
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
    maxWithdrawal,
    inflationRate
  );
}

// Fast-path: accepts precomputed per-year inputs so the MC loop can hoist
// their computation out of the 5000-run inner loop. Logic is identical to
// calculateAnnualCashFlow below the precompute step.
function calculateAnnualCashFlowCore(
  userData: UserData,
  year: number,
  income: AccumulatedIncome,
  spending: { baseSpendingNet: number; otherSpendingGoalsNet: number },
  stateTaxRate: number,
  age: number,
  spouseAge: number | null,
  balances: Record<string, number>,
  // IRS rule: RMD for year N uses Dec 31 of year N-1 (beginning-of-year) balance.
  // Pass pre-growth balance from the simulation loop; falls back to current tradBal.
  beginningTradBalances?: { self: number; spouse: number },
  maxWithdrawal?: number,
  inflationRate?: number,
  // 2-year-prior MAGI proxy used to determine the current year's IRMAA surcharge
  // (IRS lookback rule). Caller passes undefined / 0 when unavailable.
  priorMagi?: number,
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
  let rmdExcess = 0;
  let rothConversion = 0;
  let capWasBinding = false;
  let ordinaryTax = 0;
  let federalCapGainsTax = 0;
  let stateCapGainsTax = 0;
  let niitTax = 0;

  // IRMAA is determined by the 2-year-prior MAGI, so it does not depend on this
  // year's withdrawal — compute it once outside the fixed-point loop.
  const irmaaEnabled = userData.enableIRMAA !== false;
  const niitEnabled = userData.enableNIIT !== false;
  const irmaaSurcharge = irmaaEnabled
    ? calculateIRMAA(priorMagi ?? 0, userData.filingStatus, year, inflationRate ?? 0, age, spouseAge)
    : 0;

  // RMD-first waterfall: the RMD will be pulled and taxed regardless, so apply its
  // gross toward spending need before tapping Taxable. Without this, the loop
  // over-pulls from Taxable to fill a gap the RMD already covers — generating
  // phantom federal/state LTCG and NIIT. Order: Trad-up-to-RMD → Taxable →
  // Trad-above-RMD → Roth. When rmdRequired = 0, this reduces to the original
  // Taxable → Traditional → Roth waterfall.
  function computeWaterfall(w: number) {
    const rmdSpendingPull = Math.min(w, rmdRequired, tradBal);
    let remaining = w - rmdSpendingPull;
    const ft = Math.min(remaining, taxableBal);
    remaining -= ft;
    const tradAboveRmd = Math.max(0, tradBal - rmdRequired);
    const spendingFromTradExtra = Math.min(remaining, tradAboveRmd);
    remaining -= spendingFromTradExtra;
    const fr = Math.max(0, remaining);
    const sft = rmdSpendingPull + spendingFromTradExtra;
    const forcedTrad = Math.min(Math.max(sft, rmdRequired), tradBal);
    const rmdExc = Math.max(0, forcedTrad - sft);
    // Roth conversion: taken from Traditional balance remaining after RMD/spending,
    // routed to Roth. Taxed as ordinary income (added to fromTrad for tax calc).
    // IRS rule: RMD must be satisfied first (not eligible for conversion) — handled
    // implicitly because forcedTrad is already reserved here.
    const availableForConversion = Math.max(0, tradBal - forcedTrad);
    const rc = Math.min(Math.max(0, conversionGross), availableForConversion);
    return {
      fromTaxable: ft,
      fromTrad: forcedTrad + rc,
      fromRoth: fr,
      rmdExcess: rmdExc,
      rothConversion: rc,
    };
  }

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const w = computeWaterfall(withdrawal);
    fromTaxable = w.fromTaxable;
    fromTrad = w.fromTrad;
    fromRoth = w.fromRoth;
    rmdExcess = w.rmdExcess;
    rothConversion = w.rothConversion;

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
        userData.spouseAge,
        inflationRate
      );
      ordinaryTax = combinedTaxable - net;
    }
    federalCapGainsTax = fromTaxable * ltcgRate;
    // Most states tax LTCG as ordinary income at the state rate. Apply the same
    // state rate used for ordinary income above; state-specific LTCG preferences
    // (e.g. WA capital gains tax) are not modeled.
    stateCapGainsTax = fromTaxable * stateTaxRate;
    // NIIT: 3.8% × min(investment income, MAGI − threshold). Investment-income
    // proxy is the gross taxable-account withdrawal (same proxy as federal LTCG).
    // MAGI proxy = ordinary gross + SS taxable portion + taxable-account withdrawal.
    if (niitEnabled) {
      const magi = ordinaryGross + ssTaxableAmount + fromTaxable;
      niitTax = calculateNIIT(magi, fromTaxable, userData.filingStatus);
    } else {
      niitTax = 0;
    }
    totalTax = ordinaryTax + federalCapGainsTax + stateCapGainsTax + niitTax + irmaaSurcharge;

    const uncappedNewWithdrawal = Math.max(0, totalSpendingNet + totalTax - availableCash);
    const newWithdrawal = Math.min(uncappedNewWithdrawal, cap);
    capWasBinding = uncappedNewWithdrawal > cap;

    if (Math.abs(newWithdrawal - withdrawal) < 0.01) {
      withdrawal = newWithdrawal;
      const finalW = computeWaterfall(withdrawal);
      fromTaxable = finalW.fromTaxable;
      fromTrad = finalW.fromTrad;
      fromRoth = finalW.fromRoth;
      rmdExcess = finalW.rmdExcess;
      rothConversion = finalW.rothConversion;
      break;
    }
    withdrawal = newWithdrawal;
  }

  const netCashFlow = capWasBinding
    ? -withdrawal || 0
    : availableCash - totalTax - totalSpendingNet;
  // Surplus is the portion of netCashFlow deposited to a taxable account as general
  // reinvestment. Zero when the cap was binding (no surplus possible) or when net
  // cash flow is non-positive. ensureReinvestmentAccount guarantees a taxable target.
  const surplusContribution = capWasBinding ? 0 : Math.max(0, netCashFlow);

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
    federalCapGainsTax,
    stateCapGainsTax,
    irmaaSurcharge,
    niitTax,
    netCashFlow,
    rmdRequired,
    rmdExcess,
    rothConversionGross: rothConversion,
    spendingShortfall,
    wageIncomeGross: income.wageIncomeGross,
    preTaxContributions: income.preTaxContributions,
    rothContributions: income.rothContributions,
    afterTaxContributions: income.afterTaxContributions,
    employerMatch: income.employerMatch,
    contributionsCappedAmount: income.contributionsCappedAmount,
    surplusContribution,
  };
}

// MAGI proxy for IRMAA lookback: ordinary taxable income + taxable SS portion +
// gross taxable-account withdrawals (treated as investment income proxy, matching
// the NIIT proxy). True MAGI adds tax-exempt muni interest and a few other items
// the model doesn't track.
function magiFromBreakdown(b: AnnualCashFlowBreakdown): number {
  return b.otherTaxableGross + b.withdrawalFromTraditional + b.ssTaxableAmount + b.withdrawalFromTaxable;
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

// Precompute phase convention: anything that doesn't depend on per-run randomness
// or evolving balances belongs here, hoisted out of the per-year-per-run inner loop.
// If you're tempted to call `find` / `filter` over `userData.*` inside `simulateOneRun`,
// hoist it into a precompute instead. See also `AccountIndex` and `buildBlackSwanLookup`.
//
// Per-year precomputes shared across every run. Pulled out of the hot loop and
// passed by reference into simulateOneRun.
interface Precomputes {
  stateTaxRateByYear: number[];
  ageByYear: number[];
  spouseAgeByYear: Array<number | null>;
  incomeByYear: AccumulatedIncome[];
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
  accountIndex: AccountIndex,
  generator: ReturnGenerator,
  runIndex: number,
  random: () => number,
  blackSwanLookup: Map<number, { stockMultiplier: number; bondMultiplier: number }>
): SimRun {
  const currentYear = userData.referenceYear;
  const totalYears = precomputes.ageByYear.length;

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
      const sa = accountIndex.allocationById.get(id) ?? 0.6; // fallback for synthetic accounts
      balances[id] *= sa * sf + (1 - sa) * bf;
    }

    // 2. Cash flow. IRMAA uses MAGI from 2 years prior; pull from completed
    // breakdowns. First two retirement years fall back to userData.priorWorkingMagi
    // (the user's last working year MAGI), defaulting to 0 if unset.
    const priorMagi = i >= 2
      ? magiFromBreakdown(breakdowns[i - 2])
      : (userData.priorWorkingMagi ?? 0);
    // Pass postGrowth as maxWithdrawal so the calc caps at the available portfolio
    // when depleting. In solvent years the cap doesn't bind and the result is
    // identical to an uncapped call. Depletion is then detected via spendingShortfall.
    const postGrowth = sumBalances(balances);
    const cap = Math.max(0, postGrowth);
    const effectiveCashFlow = calculateAnnualCashFlowCore(
      userData, year, yearIncome, yearSpending, yearStateTaxRate, yearAge, yearSpouseAge, balances, beginningTradBalances, cap, userData.inflationRate, priorMagi
    );
    breakdowns.push(effectiveCashFlow);

    if (effectiveCashFlow.spendingShortfall > 0) {
      if (!failed) failedYear = i;
      failed = true;
    }

    applyCashFlow(accountIndex, effectiveCashFlow, yearIncome.contributions, balances);
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
  // Tax cache key is per-(taxable, status, age, year, ...) — across a 5000-run MC
  // the cache fills with millions of pathologically-unique entries that mostly never
  // hit. Clear at the top of each simulation so cache hits come only from the
  // fixed-point loop iterating the same combinedTaxable ± delta within one year.
  clearTaxCalculationCache();
  const userData = ensureRothConversionAccount(ensureReinvestmentAccount(rawUserData));
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

  const accountIndex = buildAccountIndex(userData);
  const generator = createReturnGenerator(userData, random);
  const blackSwanLookup = buildBlackSwanLookup(userData);
  const numRuns = generator.getNumRuns();

  let successCount = 0;
  const allRuns: SimRun[] = new Array(numRuns);
  for (let r = 0; r < numRuns; r++) {
    const run = simulateOneRun(userData, precomputes, accountIndex, generator, r, random, blackSwanLookup);
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
    userData, precomputes, accountIndex, nominalGenerator, 0, random, blackSwanLookup
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
