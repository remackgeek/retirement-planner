import type { UserData } from '../types/UserData';
import type { Account, AccountType, AccountKind } from '../types/Account';
import {
  calculateNetFromGross,
  calculateNetFromGrossDetailed,
  calculateSSTaxableAmount,
  calculateSSTaxableAmountDetailed,
  clearTaxCalculationCache,
  getBracketCeilingTaxableIncome,
  getNumQualifyingSeniors,
  getStandardDeduction,
  getUsualSeniorExtra,
  type FederalBracketDetail,
  type FilingStatus,
  type SsZone,
} from './TaxCalculator';
import { calculateIRMAA, calculateIRMAADetailed, calculateNIIT, calculateNIITDetailed } from './IRMAA';
import { computeStateTax, type StateTaxResult } from './StateTaxCalculator';
import { getStateTaxProfile, type StateTaxProfile } from '../data/stateTaxProfiles';
import { getContributionLimits } from '../utils/contributionLimits';
import {
  createReturnGenerator,
  createNominalGenerator,
  buildBlackSwanLookup,
  applyBlackSwan,
  type ReturnGenerator,
} from './ReturnGenerator';

// State tax modeling has moved to a per-state profile registry
// (`src/data/stateTaxProfiles.ts`) + `computeStateTax` in `StateTaxCalculator.ts`.
// Profiles encode brackets, deductions, SS taxability, retirement-income
// exclusions, LTCG rules, and locality surcharges. Resolve a profile for a
// scenario year via:
//
//   const profile = getStateTaxProfile(getEffectiveStateName(userData, year), year);
//
// The simulation loop precomputes one profile per year (see `Precomputes`).

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

// Resolve the active state name for a given calendar year by walking the
// scenario's stateTimeline. Used by the tax-audit detail rendering to label
// which state's rate applied this year (the federal/state ordinary-tax split
// is more interpretable when the user can see "this is California's 8% on
// gross").
export function getEffectiveStateName(userData: UserData, year: number): string {
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
  return effectiveState;
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
// Optional `sink` accumulates the per-account amount actually withdrawn — used by the
// Tax Audit view to surface which account each dollar came from.
function subtractFromAccounts(
  typeAccounts: Account[],
  balances: Record<string, number>,
  amount: number,
  sink?: Map<string, number>
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
    if (sink && share > 0) sink.set(a.id, (sink.get(a.id) ?? 0) + share);
  }
}

// Add `amount` to a precomputed list of accounts, proportional to current balance.
// If no balances exist in the type, deposits to the first account of that type (if any).
// Optional `sink` accumulates the per-account amount actually deposited.
function addToAccounts(
  typeAccounts: Account[],
  balances: Record<string, number>,
  amount: number,
  sink?: Map<string, number>
): void {
  if (amount <= 0 || typeAccounts.length === 0) return;
  let typeTotal = 0;
  for (const a of typeAccounts) typeTotal += balances[a.id] ?? 0;
  if (typeTotal <= 0) {
    const first = typeAccounts[0];
    balances[first.id] = (balances[first.id] ?? 0) + amount;
    if (sink) sink.set(first.id, (sink.get(first.id) ?? 0) + amount);
    return;
  }
  for (const a of typeAccounts) {
    const bal = balances[a.id] ?? 0;
    const share = (bal / typeTotal) * amount;
    balances[a.id] = bal + share;
    if (sink && share > 0) sink.set(a.id, (sink.get(a.id) ?? 0) + share);
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
  balances: Record<string, number>,
  sink?: Map<string, number>
): void {
  for (const c of contributions) {
    const total = c.employeeAmount + c.employerMatch;
    if (total <= 0) continue;
    const targetId = accountIndex.contributionTargetByEventId.get(c.eventId);
    if (!targetId) continue;
    balances[targetId] = (balances[targetId] ?? 0) + total;
    if (sink) sink.set(targetId, (sink.get(targetId) ?? 0) + total);
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
  const withdrawalSink = new Map<string, number>();
  const depositSink = new Map<string, number>();
  subtractFromAccounts(accountIndex.byType.taxable, balances, breakdown.withdrawalFromTaxable, withdrawalSink);
  subtractFromAccounts(accountIndex.byType.traditional, balances, breakdown.withdrawalFromTraditional, withdrawalSink);
  subtractFromAccounts(accountIndex.byType.roth, balances, breakdown.withdrawalFromRoth, withdrawalSink);
  // Deposit Roth conversion into Roth accounts (pro-rata). A receiving Roth is
  // guaranteed by ensureRothConversionAccount when any conversion event exists.
  // The deposit is the gross conversion minus any withheld tax (when Taxable +
  // RMD-excess couldn't cover the marginal ordinary tax — IRS Form 1099-R Box 4).
  if (breakdown.rothConversionGross > 0) {
    const rothDeposit = breakdown.rothConversionGross - breakdown.rothConversionTaxWithheld;
    if (rothDeposit > 0) {
      addToAccounts(accountIndex.byType.roth, balances, rothDeposit, depositSink);
    }
  }
  // Deposit RMD excess into the first taxable account (already ensured to exist by caller).
  if (breakdown.rmdExcess > 0 && accountIndex.firstTaxable) {
    const id = accountIndex.firstTaxable.id;
    balances[id] = (balances[id] ?? 0) + breakdown.rmdExcess;
    depositSink.set(id, (depositSink.get(id) ?? 0) + breakdown.rmdExcess);
  }
  // Retirement contributions (explicit deposit instructions, independent of surplus).
  depositContributions(accountIndex, contributions, balances, depositSink);
  // Surplus: deposit any positive netCashFlow into the first taxable account.
  // ensureReinvestmentAccount guarantees one exists when surplus is possible.
  if (breakdown.netCashFlow > 0 && accountIndex.firstTaxable) {
    const id = accountIndex.firstTaxable.id;
    balances[id] = (balances[id] ?? 0) + breakdown.netCashFlow;
    depositSink.set(id, (depositSink.get(id) ?? 0) + breakdown.netCashFlow);
  }

  // Surface per-account flows for the Tax Audit view. One row per account that
  // had any movement this year — withdrawal + deposit on the same row when both
  // happened (e.g. a taxable account that paid for spending then received the
  // surplus deposit). Lookup is via accountIndex.byId so we resolve the
  // up-to-date account name and type even for synthetic Reinvestment / Roth
  // Conversion accounts injected by ensure*Account.
  const seen = new Set<string>();
  const rows: AccountFlowRow[] = [];
  withdrawalSink.forEach((amount, id) => {
    if (amount <= 0) return;
    seen.add(id);
    const acct = accountIndex.byId.get(id);
    rows.push({
      accountId: id,
      accountName: acct?.name ?? id,
      accountType: acct?.type ?? 'taxable',
      withdrawal: amount,
      deposit: depositSink.get(id) ?? 0,
    });
  });
  depositSink.forEach((amount, id) => {
    if (seen.has(id) || amount <= 0) return;
    const acct = accountIndex.byId.get(id);
    rows.push({
      accountId: id,
      accountName: acct?.name ?? id,
      accountType: acct?.type ?? 'taxable',
      withdrawal: 0,
      deposit: amount,
    });
  });
  // breakdown.audit.accountFlows is populated here — not inside
  // calculateAnnualCashFlowCore — because it depends on the actual pro-rata
  // distribution over current account balances, which is only known once the
  // withdrawal sinks have run. Callers of the public calculateAnnualCashFlow
  // wrapper that don't subsequently call applyCashFlow will see accountFlows
  // as undefined; tests that need it should drive runSimulation.
  if (breakdown.audit) breakdown.audit.accountFlows = rows;
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
  ordinaryTax: number;      // ordinary income tax (federal + state + locality surcharge) on Traditional + SS + other taxable
  federalCapGainsTax: number; // federal LTCG tax on taxable account withdrawals (longTermCapGainsRate × fromTaxable)
  stateCapGainsTax: number;   // state tax on taxable account withdrawals (most states treat LTCG as ordinary; WA flat threshold; MO exempt)
  stateLocalitySurcharge: number; // NYC ~3.876% municipal income tax (0 elsewhere); already included in `ordinaryTax` total
  irmaaSurcharge: number;     // Medicare IRMAA Part B+D surcharge (per enrollee × enrollee count); 0 if disabled or pre-65
  niitTax: number;            // 3.8% Net Investment Income Tax on the lesser of investment income or MAGI excess
  netCashFlow: number;
  rmdRequired: number;  // IRS-mandated minimum from Traditional; 0 if age < 73
  rmdExcess: number;    // rmdRequired beyond spending need; reinvested to taxable
  // Gross conversion amount = Trad withdrawal for the conversion = IRS Form
  // 1099-R Box 1 (gross distribution). Roth deposit = this minus rothConversionTaxWithheld.
  // May be < requested only when capped by available Trad balance (a rare true cap).
  rothConversionGross: number;
  rothConversionRequested: number;  // user-configured conversion amount before any cap
  rothConversionTaxFromTaxable: number;  // portion of conversion ordinary tax pulled from Taxable
  rothConversionTaxFromRmdExcess: number;  // portion of conversion ordinary tax absorbed by RMD-excess cash
  // Portion of conversion ordinary tax withheld from the conversion itself
  // (IRS Form 1099-R Box 4 mechanic). Subtracted from the Roth deposit by
  // applyCashFlow. Non-zero when Taxable + RMD-excess can't cover the marginal
  // ordinary tax; surfaces a dialog warning advising the user that withholding
  // is suboptimal vs. funding from Taxable.
  rothConversionTaxWithheld: number;
  spendingShortfall: number;  // unmet spending+tax need when portfolio cap was binding; 0 otherwise
  wageIncomeGross: number;          // sum of wage_income events (already included in otherTaxableGross before any pre-tax deduction)
  preTaxContributions: number;      // employee pre_tax contributions deposited to Traditional this year
  rothContributions: number;        // employee Roth contributions deposited to Roth this year
  afterTaxContributions: number;    // employee after_tax contributions deposited to Taxable this year
  employerMatch: number;            // employer match deposited (routed to same target as employee contribution)
  contributionsCappedAmount: number; // total employee contribution dollars cut by IRS caps this year
  surplusContribution: number;       // positive netCashFlow deposited to taxable as general surplus this year
  audit?: AnnualAuditBreakdown;      // IRS-audit-level intermediates (always populated; optional for back-compat)
}

// Per-event ordinary-income source as it actually fed the year's tax calc.
// Built once in accumulateIncome (precompute phase) so the hot loop doesn't
// rewalk userData.incomeEvents.
export interface EventIncomeRecord {
  eventId: string;
  eventName: string;
  eventType: string;        // IncomeEvent['type']
  gross: number;            // post-inflation, post-haircut, post-cap amount
  // Classification drives the marginal-stack ordering for tax attribution.
  // 'ordinary' covers wage_income and all before_tax pension/rental/annuity/etc.
  // 'pre_tax_contribution' is a NEGATIVE-direction reduction to ordinary income
  //   (gross is positive; in the stack it subtracts).
  // 'social_security' is special-cased (provisional-income formula).
  // 'roth_conversion' is added at the top of the ordinary stack.
  // 'after_tax' / 'roth_contribution' / 'after_tax_contribution' carry no
  //   ordinary tax burden.
  classification:
    | 'ordinary'
    | 'pre_tax_contribution'
    | 'social_security'
    | 'roth_conversion'
    | 'after_tax'
    | 'roth_contribution'
    | 'after_tax_contribution';
}

export interface AccountFlowRow {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  withdrawal: number;    // positive dollars taken out of this account this year
  deposit: number;       // positive dollars added to this account this year
}

// Per-event marginal-stack tax attribution: events are ordered IRS-style
// (wages → other before-tax → pre-tax-deduction → Trad withdrawal for spending
// → Roth conversion → SS), and each entry's marginalTax is the incremental
// federal+state ordinary tax delta when that source is stacked on top of the
// prior cumulative gross. Marginal rates sum-to-total within ~rounding.
export interface IncomeEventTaxAttribution {
  eventId: string;
  eventName: string;
  eventType: string;       // event type or synthetic source label (e.g. 'traditional_withdrawal')
  gross: number;
  taxableContribution: number;  // signed: pre-tax contributions are negative
  marginalTax: number;
  marginalRate: number;    // marginalTax / |taxableContribution| (0 when contribution is 0)
}

// IRS-audit-level intermediates surfaced for the Tax Audit detail view. Always
// populated for every representative breakdown (median / projected / downside);
// also computed inside the MC hot loop for all runs, but only the
// representative-run audit data is actually rendered.
export interface AnnualAuditBreakdown {
  // ----- Tax (federal + state ordinary) -----
  agi: number;                       // grossIncome handed to the deduction step (= otherTaxableGross + fromTrad + ssTaxableAmount)
  standardDeduction: number;
  seniorAddOn: number;
  obbbReduction: number;             // OBBB ("Old Age Bonus" temporary 2025–2028) extra senior deduction
  totalDeductions: number;
  taxableIncome: number;
  federalBracketIndex: number;       // 0..6 (10% .. 37%)
  federalMarginalRate: number;
  federalOrdinaryTax: number;
  stateOrdinaryTax: number;
  federalBrackets: FederalBracketDetail[];
  numQualifyingSeniors: number;
  effectiveStateName: string;

  // ----- State tax detail (profile-based) -----
  /** State ordinary base prior to deduction = ordinary + (Trad − exclusion) + (SS if included). */
  stateOrdinaryBaseGross: number;
  /** Inflation-indexed state standard deduction applied this year. */
  stateStdDeduction: number;
  /** Dollars of Traditional withdrawal excluded by the profile's retirement-income exclusion. */
  stateRetirementExclusionApplied: number;
  /** SS taxable portion that ended up in the state ordinary base. */
  stateSsIncludedInState: number;
  /** State ordinary marginal rate (top bracket reached). */
  stateMarginalRate: number;
  /** Index into the profile's bracket array for the top bracket reached. */
  stateBracketIndex: number;
  /** Locality (NYC) surcharge dollars (separate from stateOrdinaryTax). */
  stateLocalitySurcharge: number;
  /** Dollars of LTCG taxed at the state level (after WA threshold / MO exemption). */
  stateLtcgTaxableAtState: number;
  /** WA-style indexed threshold above which state LTCG applies (0 elsewhere). */
  stateLtcgThresholdApplied: number;
  /** Optional short caveat/note from the profile (surfaced in audit UI). */
  stateNotes?: string;

  // ----- Social Security taxability -----
  ssProvisionalIncome: number;
  ssProvisionalThreshold1: number;
  ssProvisionalThreshold2: number;
  ssZone: SsZone;

  // ----- IRMAA -----
  irmaaLookbackMagi: number;
  irmaaTierIndex: number;
  irmaaTierUpperScaled: number;      // inflation-indexed upper bound of the hit tier
  irmaaPerEnrolleeAnnual: number;
  irmaaEnrolleeCount: number;
  irmaaMonthlySurcharge: number;     // per-enrollee monthly Part B + Part D surcharge

  // ----- NIIT -----
  niitMagi: number;
  niitThreshold: number;
  niitMagiExcess: number;
  niitInvestmentIncome: number;
  niitTaxableBase: number;

  // ----- RMD per owner -----
  rmdSelf: number;
  rmdSpouse: number;
  rmdDivisorSelf: number;            // 0 when no RMD (age < 73 or no traditional balance)
  rmdDivisorSpouse: number;
  rmdBoyBalanceSelf: number;         // beginning-of-year Traditional balance, self-owned
  rmdBoyBalanceSpouse: number;

  // ----- Per-event tax attribution -----
  incomeEventTaxBreakdown: IncomeEventTaxAttribution[];

  // ----- Per-account flows (populated by applyCashFlow) -----
  accountFlows?: AccountFlowRow[];
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
  // Per-event records for the Tax Audit / Income Detail tab. Built once during
  // precompute. Cap scaling is reflected in the recorded gross (cap applies in
  // the same pass that produces this list).
  eventBreakdowns: EventIncomeRecord[];
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
  const eventBreakdowns: EventIncomeRecord[] = [];

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
      const v = Math.max(0, amount);
      conversionGross += v;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Roth Conversion',
        eventType: event.type,
        gross: v,
        classification: 'roth_conversion',
      });
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
      let classification: EventIncomeRecord['classification'];
      switch (event.contributionType) {
        case 'pre_tax':
          preTaxContributions += employeeAmount;
          classification = 'pre_tax_contribution';
          break;
        case 'roth':
          rothContributions += employeeAmount;
          classification = 'roth_contribution';
          break;
        case 'after_tax':
        default:
          afterTaxContributions += employeeAmount;
          classification = 'after_tax_contribution';
          break;
      }
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Retirement Contribution',
        eventType: event.type,
        gross: employeeAmount,
        classification,
      });
      return;
    }

    if (event.type === 'wage_income') {
      // Wage income is taxable ordinary income (always before_tax).
      wageIncomeGross += amount;
      otherTaxableGross += amount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Wages',
        eventType: event.type,
        gross: amount,
        classification: 'ordinary',
      });
      return;
    }

    let effectiveAmount = amount;
    if (event.type === 'social_security' && event.ssHaircutEnabled !== false && year >= 2034) {
      const reduction = (event.ssHaircutPercent ?? 23) / 100;
      effectiveAmount *= 1 - reduction;
    }

    if (event.taxStatus === 'after_tax') {
      afterTaxIncome += effectiveAmount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? event.type,
        eventType: event.type,
        gross: effectiveAmount,
        classification: 'after_tax',
      });
    } else if (event.type === 'social_security') {
      ssGross += effectiveAmount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Social Security',
        eventType: event.type,
        gross: effectiveAmount,
        classification: 'social_security',
      });
    } else {
      otherTaxableGross += effectiveAmount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? event.type,
        eventType: event.type,
        gross: effectiveAmount,
        classification: 'ordinary',
      });
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

  // Sync per-event records' gross with the (possibly cap-scaled) contribution
  // amounts so the Tax Audit view shows the actual deposited dollars.
  if (contributionsCappedAmount > 0) {
    const empByEvent = new Map<string, number>();
    for (const c of contributions) empByEvent.set(c.eventId, c.employeeAmount);
    for (const r of eventBreakdowns) {
      if (
        r.classification === 'pre_tax_contribution' ||
        r.classification === 'roth_contribution' ||
        r.classification === 'after_tax_contribution'
      ) {
        const scaled = empByEvent.get(r.eventId);
        if (scaled !== undefined) r.gross = scaled;
      }
    }
  }

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
    eventBreakdowns,
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

// Synthetic event IDs used by the marginal-stack attribution for sources that
// aren't a user-configured income event (Traditional withdrawal for spending,
// aggregated SS step). Exported so UI / tests can match against them without
// duplicating the literal strings.
export const SYNTHETIC_TRAD_WITHDRAWAL_ID = '__trad_withdrawal__';
export const SYNTHETIC_SS_AGGREGATE_ID = '__ss_aggregate__';

// Marginal-stack per-event tax attribution. Events are walked in IRS-style
// stacking order so each event's `marginalTax` is the incremental federal+state
// ordinary-tax delta when added on top of the prior cumulative gross. Marginal
// rates sum to the total ordinary tax (modulo rounding). Exported for testing.
export function computeMarginalStackAttribution(args: {
  eventBreakdowns: EventIncomeRecord[];
  ssGross: number;
  ssTaxableAmount: number;
  fromTrad: number;
  rothConversionTotal: number;
  filingStatus: FilingStatus;
  /** Year's actual state-tax / federal-combinedTaxable ratio. State tax is
   *  distributed across stack steps proportional to each step's federal taxable
   *  contribution. Honest approximation: state rules (SS exemption, retirement
   *  exclusion, locality) don't map 1:1 to the federal marginal stack, so we
   *  use a single effective state rate for the year. */
  stateEffectiveRate: number;
  age: number;
  taxYear: number;
  spouseAge: number | null;
  inflationRate: number | undefined;
}): IncomeEventTaxAttribution[] {
  const {
    eventBreakdowns, ssGross, ssTaxableAmount, fromTrad, rothConversionTotal,
    filingStatus, stateEffectiveRate, age, taxYear, spouseAge, inflationRate,
  } = args;

  // 1. Build the ordered list of stack steps.
  type Step = {
    event: { id: string; name: string; type: string; gross: number };
    signedTaxable: number;          // signed contribution to ordinary gross
    kind: 'ordinary' | 'pre_tax' | 'ss' | 'trad_withdrawal' | 'roth_conversion';
  };
  const steps: Step[] = [];
  // Ordinary income events (wages, pension, rental, etc.)
  for (const r of eventBreakdowns) {
    if (r.classification === 'ordinary') {
      steps.push({
        event: { id: r.eventId, name: r.eventName, type: r.eventType, gross: r.gross },
        signedTaxable: r.gross,
        kind: 'ordinary',
      });
    }
  }
  // Pre-tax contributions (reduce ordinary, signed-negative)
  for (const r of eventBreakdowns) {
    if (r.classification === 'pre_tax_contribution') {
      steps.push({
        event: { id: r.eventId, name: r.eventName, type: r.eventType, gross: r.gross },
        signedTaxable: -r.gross,
        kind: 'pre_tax',
      });
    }
  }
  // Synthetic: Traditional withdrawal for spending need (excludes conversion).
  const tradForSpending = Math.max(0, fromTrad - rothConversionTotal);
  if (tradForSpending > 0) {
    steps.push({
      event: { id: SYNTHETIC_TRAD_WITHDRAWAL_ID, name: 'Traditional Withdrawal (spending+RMD)', type: 'traditional_withdrawal', gross: tradForSpending },
      signedTaxable: tradForSpending,
      kind: 'trad_withdrawal',
    });
  }
  // Roth conversion events. If multiple, scale each to match `rothConversionTotal`
  // exactly (the calc caps conversion at the Trad balance after RMD/spending).
  const conversionRecords = eventBreakdowns.filter((r) => r.classification === 'roth_conversion');
  const conversionRequested = conversionRecords.reduce((s, r) => s + r.gross, 0);
  if (rothConversionTotal > 0 && conversionRequested > 0) {
    const scale = rothConversionTotal / conversionRequested;
    for (const r of conversionRecords) {
      const actualGross = r.gross * scale;
      steps.push({
        event: { id: r.eventId, name: r.eventName, type: r.eventType, gross: actualGross },
        signedTaxable: actualGross,
        kind: 'roth_conversion',
      });
    }
  }
  // Social Security step. If multiple SS events, aggregate into one step then
  // split the marginal tax proportionally across the events.
  const ssRecords = eventBreakdowns.filter((r) => r.classification === 'social_security');
  const ssRecordsTotal = ssRecords.reduce((s, r) => s + r.gross, 0);
  if (ssGross > 0) {
    steps.push({
      event: { id: SYNTHETIC_SS_AGGREGATE_ID, name: 'Social Security (aggregate)', type: 'social_security', gross: ssGross },
      signedTaxable: ssTaxableAmount,
      kind: 'ss',
    });
  }

  // 2. Walk the stack, recording each step's marginal tax. Cumulative ordinary
  // gross is floored at zero after each step (matches accumulateIncome's
  // Math.max(0, otherTaxableGross - preTaxContributions) for negative steps).
  const attributions: IncomeEventTaxAttribution[] = [];
  let cumulativeOrdinary = 0;
  let prevTax = 0;
  for (const step of steps) {
    let stepCumulative = cumulativeOrdinary;
    if (step.kind !== 'ss') {
      stepCumulative = Math.max(0, stepCumulative + step.signedTaxable);
    }
    const combinedTaxable = stepCumulative + (step.kind === 'ss' ? step.signedTaxable : 0);
    let totalTax = 0;
    if (combinedTaxable > 0) {
      const fedTax = combinedTaxable - calculateNetFromGross(
        combinedTaxable, filingStatus, age, taxYear, spouseAge, inflationRate,
      );
      totalTax = fedTax + combinedTaxable * stateEffectiveRate;
    }
    const marginalTax = totalTax - prevTax;
    if (step.kind === 'ss' && ssRecords.length > 1 && ssRecordsTotal > 0) {
      // Split SS marginal tax across multiple SS events proportionally by gross.
      for (const r of ssRecords) {
        const portion = r.gross / ssRecordsTotal;
        attributions.push({
          eventId: r.eventId,
          eventName: r.eventName,
          eventType: r.eventType,
          gross: r.gross,
          taxableContribution: ssTaxableAmount * portion,
          marginalTax: marginalTax * portion,
          marginalRate: r.gross > 0 ? (marginalTax * portion) / r.gross : 0,
        });
      }
    } else if (step.kind === 'ss' && ssRecords.length === 1) {
      const r = ssRecords[0];
      attributions.push({
        eventId: r.eventId,
        eventName: r.eventName,
        eventType: r.eventType,
        gross: r.gross,
        taxableContribution: ssTaxableAmount,
        marginalTax,
        marginalRate: r.gross > 0 ? marginalTax / r.gross : 0,
      });
    } else {
      attributions.push({
        eventId: step.event.id,
        eventName: step.event.name,
        eventType: step.event.type,
        gross: step.event.gross,
        taxableContribution: step.signedTaxable,
        marginalTax,
        marginalRate: step.signedTaxable !== 0 ? marginalTax / Math.abs(step.signedTaxable) : 0,
      });
    }
    cumulativeOrdinary = stepCumulative;
    prevTax = totalTax;
  }
  return attributions;
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

  const stateName = getEffectiveStateName(userData, year);
  const { profile: stateProfile, resolvedKey: stateResolvedKey } = getStateTaxProfile(stateName, year);
  const income = accumulateIncome(userData, year, inflationRate);
  const spendingOrder = resolveSpendingWithdrawalOrder(userData);
  const bracketHeadroom = spendingOrder === 'bracket_aware'
    ? computeBracketHeadroomForTrad(userData, income, year, inflationRate, userData.currentAge + i, spouseAge)
    : 0;
  return calculateAnnualCashFlowCore(
    userData,
    year,
    income,
    accumulateSpending(userData, year, inflationRate),
    stateProfile,
    stateResolvedKey,
    userData.currentAge + i,
    spouseAge,
    balances,
    beginningTradBalances,
    maxWithdrawal,
    inflationRate,
    undefined,
    spendingOrder,
    bracketHeadroom,
  );
}

/**
 * Per-year 12%-federal-bracket headroom for additional Traditional spending
 * pulls, **conv-inclusive, SS-inclusive, and senior-bonus-inclusive**.
 *
 * The deduction used here matches the tax calc's `baseStdDed + usualExtra`
 * (the long-standing IRS age-65 add-on, deterministic by age/year). It
 * deliberately omits the temporary OBBB extra deduction — that's
 * AGI-dependent and would force a fixed point. Skipping it keeps the
 * headroom honestly conservative across the 2025-2028 OBBB window and
 * bit-for-bit identical after the sunset.
 *
 * Used by the `bracket_aware` spending waterfall — see CLAUDE.md
 * "Cross-year spending source policy" for the rationale and remaining
 * blind spots.
 *
 * Note: SS taxability is sensitive to the conversion-spending Trad pull
 * itself (more ordinary income → more SS provisional → higher ss-taxable
 * fraction). The precompute uses ordinary income WITHOUT the spending Trad
 * pull, so a Trad pull that materially bumps SS into a higher fraction
 * could slightly overshoot 12%. Conservative compromise: precompute is
 * static (balance-independent), and the SS fraction maxes at 85%, so the
 * residual error is bounded.
 */
export function computeBracketHeadroomForTrad(
  userData: UserData,
  income: AccumulatedIncome,
  year: number,
  inflationRate: number,
  age: number,
  spouseAge: number | null,
): number {
  const ordForSS = income.otherTaxableGross + income.conversionGross;
  const ssTaxable = income.ssGross > 0
    ? calculateSSTaxableAmount(income.ssGross, ordForSS, userData.filingStatus)
    : 0;
  const baselineOrdGross = ordForSS + ssTaxable;
  const stdDed = getStandardDeduction(userData.filingStatus, year, inflationRate);
  const numQualifying = getNumQualifyingSeniors(userData.filingStatus, age, spouseAge);
  const seniorExtra = getUsualSeniorExtra(userData.filingStatus, year, numQualifying, inflationRate);
  const totalDed = stdDed + seniorExtra;
  // bracketIndex 1 = top of 12% bracket (above 10% bracket, below 22%)
  const topOf12 = getBracketCeilingTaxableIncome(userData.filingStatus, 1, year, inflationRate);
  if (!isFinite(topOf12)) return 0;
  const baselineTaxable = Math.max(0, baselineOrdGross - totalDed);
  return Math.max(0, topOf12 - baselineTaxable);
}

// Fast-path: accepts precomputed per-year inputs so the MC loop can hoist
// their computation out of the 5000-run inner loop. Logic is identical to
// calculateAnnualCashFlow below the precompute step.
function calculateAnnualCashFlowCore(
  userData: UserData,
  year: number,
  income: AccumulatedIncome,
  spending: { baseSpendingNet: number; otherSpendingGoalsNet: number },
  stateProfile: StateTaxProfile,
  // Resolved profile key (may differ from the timeline's state name when a
  // year-bounded successor profile applied — e.g. "South Carolina (2027+)").
  // Used as the audit/UI display name.
  stateResolvedKey: string,
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
  // Resolved spending-source strategy (see resolveSpendingWithdrawalOrder).
  // Public wrapper resolves it; fast-path passes the precomputed value.
  spendingOrder: ResolvedSpendingOrder = 'taxable_first',
  // Max additional Trad-spending dollars that stay within the 12% federal
  // bracket, **conv-inclusive**. Only consulted when spendingOrder === 'bracket_aware'.
  bracketHeadroomForTrad: number = 0,
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
  const selfRmdDivisor = selfRmd > 0 ? (IRS_UNIFORM_LIFETIME_TABLE[Math.min(age, 114)] ?? 2.9) : 0;
  const spouseRmdDivisor = spouseAge !== null && spouseRmd > 0
    ? (IRS_UNIFORM_LIFETIME_TABLE[Math.min(spouseAge, 114)] ?? 2.9)
    : 0;
  // `withdrawal` is the SPENDING portion only: dollars pulled from the portfolio
  // to cover spending + spending-related tax beyond what income provides. Conversion
  // ordinary tax is sourced separately from Taxable + RMD-excess (see below).
  let withdrawal = Math.min(Math.max(0, totalSpendingNet - availableCash), cap);
  let totalTax = 0;
  let ssTaxableAmount = 0;
  let fromTaxable = 0;
  let fromTrad = 0;
  let fromRoth = 0;
  let rmdExcess = 0;
  let rothConversion = 0;
  let rothConversionRequested = Math.max(0, conversionGross);
  let capWasBinding = false;
  let ordinaryTax = 0;
  let federalCapGainsTax = 0;
  let stateCapGainsTax = 0;
  let stateLocalitySurcharge = 0;
  let stateOrdinaryTaxOnly = 0;
  let stateResultFinal: StateTaxResult | null = null;
  let niitTax = 0;
  // Conversion tax sourcing — populated inside the loop. `convTaxFromTaxable` is
  // the Taxable pull added specifically to cover the conversion's ordinary tax
  // delta; `convTaxFromRmdExc` is the part absorbed by RMD-excess cash before
  // any reinvestment. Their sum is the conversion's marginal ordinary tax.
  let convTaxFromTaxable = 0;
  let convTaxFromRmdExc = 0;
  // Conversion tax withheld from the conversion's own Trad pull when Taxable +
  // RMD-excess can't cover the marginal ordinary tax. The Roth deposit shrinks
  // by this amount; the Trad pull stays at the requested conversion gross.
  let convTaxWithheld = 0;

  // IRMAA is determined by the 2-year-prior MAGI, so it does not depend on this
  // year's withdrawal — compute it once outside the fixed-point loop.
  const irmaaEnabled = userData.enableIRMAA !== false;
  const niitEnabled = userData.enableNIIT !== false;
  const irmaaSurcharge = irmaaEnabled
    ? calculateIRMAA(priorMagi ?? 0, userData.filingStatus, year, inflationRate ?? 0, age, spouseAge)
    : 0;

  // Spending waterfall: RMD-up-to-spending → Taxable → Trad-above-RMD → Roth.
  // The RMD-first ordering avoids over-pulling Taxable to fill a gap the RMD
  // already covers (phantom LTCG/NIIT). Conversion is NOT included here —
  // conversion principal and conversion tax are handled separately so that
  // conversion tax never leaks into Trad-above-RMD or Roth (which would defeat
  // the conversion's tax arbitrage). See CLAUDE.md "Intents and funding sources".
  //
  // Under spendingOrder === 'bracket_aware', a Trad-spending pull is inserted
  // BEFORE Taxable, up to `bracketHeadroomForTrad`. The headroom is conv-inclusive
  // (precomputed), so the Trad pull + active conversion together stay within the
  // 12% federal bracket. This is the "Cross-year spending source policy" layer
  // documented in CLAUDE.md — it preserves Taxable for high-mt conversion years.
  function computeSpendingWaterfall(w: number) {
    const rmdSpendingPull = Math.min(w, rmdRequired, tradBal);
    let remaining = w - rmdSpendingPull;

    let tradLowBracketPull = 0;
    if (spendingOrder === 'bracket_aware' && bracketHeadroomForTrad > 0) {
      const tradAboveRmd = Math.max(0, tradBal - rmdRequired);
      // The FULL `rmdRequired` is mandatorily pulled and taxed as ordinary
      // income — it consumes bracket headroom regardless of whether it covered
      // spending. Subtracting `rmdSpendingPull` (which can be < rmdRequired
      // when RMD exceeds spending) would let `tradLowBracketPull` claim
      // bracket space that the RMD excess already used, bumping actual
      // taxable income past top-of-12%. Use rmdRequired here.
      const headroomAfterRmd = Math.max(0, bracketHeadroomForTrad - rmdRequired);
      tradLowBracketPull = Math.min(remaining, headroomAfterRmd, tradAboveRmd);
      remaining -= tradLowBracketPull;
    }
    const ft = Math.min(remaining, taxableBal);
    remaining -= ft;
    const tradAboveHeadroom = Math.max(0, tradBal - rmdRequired - tradLowBracketPull);
    const spendingFromTradExtra = Math.min(remaining, tradAboveHeadroom);
    remaining -= spendingFromTradExtra;
    const fr = Math.max(0, remaining);
    const sft = rmdSpendingPull + tradLowBracketPull + spendingFromTradExtra;
    const forcedTrad = Math.min(Math.max(sft, rmdRequired), tradBal);
    const rmdExc = Math.max(0, forcedTrad - sft);
    return {
      spendingFromTaxable: ft,
      forcedTrad,
      spendingFromRoth: fr,
      rmdExc,
    };
  }

  // Compute the year's ordinary tax (federal + state ordinary + locality) for
  // a hypothetical Traditional withdrawal `tradVal`, holding the Taxable LTCG
  // pull constant at `ltcgVal`. Used to compute the conversion's marginal
  // ordinary tax (= tax-with-conversion minus baseline-without-conversion);
  // that delta drives the conv-tax sourcing split (RMD-excess / Taxable /
  // withheld).
  function computeOrdinaryTaxFor(tradVal: number, ltcgVal: number): {
    ordinaryTax: number;
    federalOrdinaryTax: number;
    ssTaxable: number;
    stateRes: StateTaxResult;
  } {
    const ord = otherTaxableGross + tradVal;
    const ssTax = calculateSSTaxableAmount(ssGross, ord, userData.filingStatus);
    const comb = ord + ssTax;
    const fed = comb > 0
      ? comb - calculateNetFromGross(comb, userData.filingStatus, age, year, spouseAge, inflationRate)
      : 0;
    const sres = computeStateTax(stateProfile, {
      ordinaryGross: income.otherTaxableGross,
      ssTaxableFederal: ssTax,
      ssGross,
      traditionalWithdrawal: tradVal,
      ltcgFromTaxable: ltcgVal,
      age,
      spouseAge,
      filingStatus: userData.filingStatus,
      year,
      inflationRate: inflationRate ?? 0,
      disableStateRetirementExclusion: userData.disableStateRetirementExclusion,
    }, stateResolvedKey);
    return {
      ordinaryTax: fed + sres.stateOrdinaryTax + sres.stateLocalitySurcharge,
      federalOrdinaryTax: fed,
      ssTaxable: ssTax,
      stateRes: sres,
    };
  }

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const sw = computeSpendingWaterfall(withdrawal);

    // Conversion principal capped by Trad balance remaining after forcedTrad
    // (RMD must be satisfied first — IRS rule that RMD is not eligible for
    // conversion).
    const tradAvailForConv = Math.max(0, tradBal - sw.forcedTrad);
    let convCandidate = Math.min(rothConversionRequested, tradAvailForConv);

    // Baseline ordinary tax (no conversion) at the current spending waterfall.
    const baseTax = computeOrdinaryTaxFor(sw.forcedTrad, sw.spendingFromTaxable);

    const marginalOrdTax = (rc: number): number => {
      if (rc <= 0) return 0;
      const r = computeOrdinaryTaxFor(sw.forcedTrad + rc, sw.spendingFromTaxable);
      return Math.max(0, r.ordinaryTax - baseTax.ordinaryTax);
    };

    // Conversion ordinary tax is funded in priority order:
    //   1. RMD-excess cash (already pulled from Trad as part of forcedTrad; using
    //      it for conv tax costs nothing extra)
    //   2. Taxable balance not consumed by spending
    //   3. Withheld from the conversion itself (IRS Form 1099-R Box 4 mechanic) —
    //      Trad pull still equals convCandidate, but the Roth deposit shrinks by
    //      the withheld amount. This is mathematically suboptimal vs. paying from
    //      Taxable (gives up some of the conversion's arbitrage) but always lets
    //      the conversion execute. The dialog surfaces a warning when withholding
    //      is non-zero.
    // Conversion tax is NEVER pulled from Trad-above-RMD or Roth — that's the
    // phantom-tax leak the prior PR fixed.
    const mt = marginalOrdTax(convCandidate);
    const ctRmd = Math.min(mt, sw.rmdExc);
    const taxableRemainingForConvTax = Math.max(0, taxableBal - sw.spendingFromTaxable);
    const ctTaxable = Math.min(mt - ctRmd, taxableRemainingForConvTax);
    const ctWithheld = Math.max(0, mt - ctRmd - ctTaxable);

    // Final per-account flows for this iteration. Trad pull is the full
    // convCandidate; the Roth deposit (applied in applyCashFlow) subtracts
    // ctWithheld from rothConversionGross.
    fromTaxable = sw.spendingFromTaxable + ctTaxable;
    fromTrad = sw.forcedTrad + convCandidate;
    fromRoth = sw.spendingFromRoth;
    rothConversion = convCandidate;
    convTaxFromTaxable = ctTaxable;
    convTaxFromRmdExc = ctRmd;
    convTaxWithheld = ctWithheld;
    rmdExcess = sw.rmdExc - ctRmd;

    // Full tax recomputation with final pulls (captures LTCG/NIIT on the extra
    // Taxable pull used to pay conversion tax).
    const ordinaryGross = otherTaxableGross + fromTrad;
    ssTaxableAmount = calculateSSTaxableAmount(ssGross, ordinaryGross, userData.filingStatus);
    const combinedTaxable = ordinaryGross + ssTaxableAmount;

    let federalOrdinaryTaxIter = 0;
    if (combinedTaxable > 0) {
      const fedNet = calculateNetFromGross(
        combinedTaxable,
        userData.filingStatus,
        age,
        year,
        spouseAge,
        inflationRate
      );
      federalOrdinaryTaxIter = combinedTaxable - fedNet;
    }
    const stateRes = computeStateTax(stateProfile, {
      ordinaryGross: income.otherTaxableGross,
      ssTaxableFederal: ssTaxableAmount,
      ssGross,
      traditionalWithdrawal: fromTrad,
      ltcgFromTaxable: fromTaxable,
      age,
      spouseAge,
      filingStatus: userData.filingStatus,
      year,
      inflationRate: inflationRate ?? 0,
      disableStateRetirementExclusion: userData.disableStateRetirementExclusion,
    }, stateResolvedKey);
    stateResultFinal = stateRes;
    stateOrdinaryTaxOnly = stateRes.stateOrdinaryTax;
    stateLocalitySurcharge = stateRes.stateLocalitySurcharge;
    stateCapGainsTax = stateRes.stateCapGainsTax;
    ordinaryTax = federalOrdinaryTaxIter + stateOrdinaryTaxOnly + stateLocalitySurcharge;
    federalCapGainsTax = fromTaxable * ltcgRate;
    if (niitEnabled) {
      const magi = ordinaryGross + ssTaxableAmount + fromTaxable;
      niitTax = calculateNIIT(magi, fromTaxable, userData.filingStatus);
    } else {
      niitTax = 0;
    }
    totalTax = ordinaryTax + federalCapGainsTax + stateCapGainsTax + niitTax + irmaaSurcharge;

    // Spending withdrawal sized to cover spending + tax − availableCash − (conv
    // tax funded separately). `mt` (conv ordinary tax) is paid from Taxable +
    // rmdExc, so the spending pull doesn't need to cover it.
    const uncappedNewWithdrawal = Math.max(0, totalSpendingNet + totalTax - availableCash - mt);
    const newWithdrawal = Math.min(uncappedNewWithdrawal, cap);
    capWasBinding = uncappedNewWithdrawal > cap;

    if (Math.abs(newWithdrawal - withdrawal) < 0.01) {
      withdrawal = newWithdrawal;
      break;
    }
    withdrawal = newWithdrawal;
  }

  // Conversion ordinary tax (mt) is funded from Taxable + RMD-excess, not from
  // the spending withdrawal. So neither the surplus calc nor the spendingShortfall
  // should attribute mt to the spending-side cash gap.
  const mtFinal = convTaxFromTaxable + convTaxFromRmdExc;
  const netCashFlow = capWasBinding
    ? -withdrawal || 0
    : availableCash + mtFinal - totalTax - totalSpendingNet;
  // Surplus is the portion of netCashFlow deposited to a taxable account as general
  // reinvestment. Zero when the cap was binding (no surplus possible) or when net
  // cash flow is non-positive. ensureReinvestmentAccount guarantees a taxable target.
  // rmdExcess (the residual after conv-tax consumption) is deposited separately
  // by applyCashFlow.
  const surplusContribution = capWasBinding ? 0 : Math.max(0, netCashFlow);

  const uncappedNeed = Math.max(0, totalSpendingNet + totalTax - availableCash - mtFinal);
  const spendingShortfall = capWasBinding ? Math.max(0, uncappedNeed - withdrawal) : 0;

  // ---- Tax Audit intermediates (always computed; cheap recomputation of values
  // that the fixed-point loop already produced internally) ----
  const ordinaryGrossFinal = otherTaxableGross + fromTrad;
  const combinedTaxableFinal = ordinaryGrossFinal + ssTaxableAmount;
  const detailedTax = combinedTaxableFinal > 0
    ? calculateNetFromGrossDetailed(
        combinedTaxableFinal, userData.filingStatus, age, year, spouseAge, inflationRate,
      )
    : null;
  const ssDetail = calculateSSTaxableAmountDetailed(ssGross, ordinaryGrossFinal, userData.filingStatus);
  const irmaaDetail = irmaaEnabled
    ? calculateIRMAADetailed(priorMagi ?? 0, userData.filingStatus, year, inflationRate ?? 0, age, spouseAge)
    : null;
  const niitMagiFinal = ordinaryGrossFinal + ssTaxableAmount + fromTaxable;
  const niitDetail = niitEnabled
    ? calculateNIITDetailed(niitMagiFinal, fromTaxable, userData.filingStatus)
    : null;
  // Marginal-stack attribution: each event's tax contribution is computed
  // federally only here (state tax is allocated post-hoc proportional to each
  // event's federal taxable contribution — see `stateEffectiveRate`). State
  // rules (SS exemption, retirement exclusion, locality) don't map 1:1 to the
  // federal marginal stack, so we distribute the year's actual state tax
  // proportionally; sum reconciliation holds, individual event rows are an
  // approximation.
  const stateEffectiveRateOnFederalTaxable = combinedTaxableFinal > 0
    ? (stateOrdinaryTaxOnly + stateLocalitySurcharge) / combinedTaxableFinal
    : 0;
  const eventTaxAttr = computeMarginalStackAttribution({
    eventBreakdowns: income.eventBreakdowns,
    ssGross,
    ssTaxableAmount,
    fromTrad,
    rothConversionTotal: rothConversion,
    filingStatus: userData.filingStatus,
    stateEffectiveRate: stateEffectiveRateOnFederalTaxable,
    age,
    taxYear: year,
    spouseAge,
    inflationRate,
  });
  const audit: AnnualAuditBreakdown = {
    agi: combinedTaxableFinal,
    standardDeduction: detailedTax?.standardDeduction ?? 0,
    seniorAddOn: detailedTax?.seniorAddOn ?? 0,
    obbbReduction: detailedTax?.obbbReduction ?? 0,
    totalDeductions: detailedTax?.totalDeductions ?? 0,
    taxableIncome: detailedTax?.taxableIncome ?? 0,
    federalBracketIndex: detailedTax?.federalBracketIndex ?? 0,
    federalMarginalRate: detailedTax?.federalMarginalRate ?? 0,
    federalOrdinaryTax: detailedTax?.federalTax ?? 0,
    stateOrdinaryTax: stateOrdinaryTaxOnly,
    federalBrackets: detailedTax?.federalBrackets ?? [],
    numQualifyingSeniors: detailedTax?.numQualifyingSeniors ?? 0,
    effectiveStateName: stateResolvedKey,

    ssProvisionalIncome: ssDetail.provisionalIncome,
    ssProvisionalThreshold1: ssDetail.threshold1,
    ssProvisionalThreshold2: ssDetail.threshold2,
    ssZone: ssDetail.zone,

    irmaaLookbackMagi: irmaaDetail?.lookbackMagi ?? 0,
    irmaaTierIndex: irmaaDetail?.tierIndex ?? 0,
    irmaaTierUpperScaled: irmaaDetail?.tierUpperScaled ?? 0,
    irmaaPerEnrolleeAnnual: irmaaDetail?.perEnrolleeAnnual ?? 0,
    irmaaEnrolleeCount: irmaaDetail?.enrolleeCount ?? 0,
    irmaaMonthlySurcharge: irmaaDetail?.monthlySurcharge ?? 0,

    niitMagi: niitDetail?.magi ?? 0,
    niitThreshold: niitDetail?.threshold ?? 0,
    niitMagiExcess: niitDetail?.magiExcess ?? 0,
    niitInvestmentIncome: niitDetail?.investmentIncome ?? 0,
    niitTaxableBase: niitDetail?.taxableBase ?? 0,

    rmdSelf: selfRmd,
    rmdSpouse: spouseRmd,
    rmdDivisorSelf: selfRmdDivisor,
    rmdDivisorSpouse: spouseRmdDivisor,
    rmdBoyBalanceSelf: selfTradBal,
    rmdBoyBalanceSpouse: spouseTradBal,

    incomeEventTaxBreakdown: eventTaxAttr,

    stateOrdinaryBaseGross: stateResultFinal?.stateOrdinaryBaseGross ?? 0,
    stateStdDeduction: stateResultFinal?.stateStdDeduction ?? 0,
    stateRetirementExclusionApplied: stateResultFinal?.retirementExclusionApplied ?? 0,
    stateSsIncludedInState: stateResultFinal?.ssIncludedInState ?? 0,
    stateMarginalRate: stateResultFinal?.stateMarginalRate ?? 0,
    stateBracketIndex: stateResultFinal?.stateBracketIndex ?? 0,
    stateLocalitySurcharge,
    stateLtcgTaxableAtState: stateResultFinal?.ltcgTaxableAtState ?? 0,
    stateLtcgThresholdApplied: stateResultFinal?.ltcgThresholdApplied ?? 0,
    stateNotes: stateResultFinal?.notes,
  };

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
    stateLocalitySurcharge,
    irmaaSurcharge,
    niitTax,
    netCashFlow,
    rmdRequired,
    rmdExcess,
    rothConversionGross: rothConversion,
    rothConversionRequested,
    rothConversionTaxFromTaxable: convTaxFromTaxable,
    rothConversionTaxFromRmdExcess: convTaxFromRmdExc,
    rothConversionTaxWithheld: convTaxWithheld,
    spendingShortfall,
    wageIncomeGross: income.wageIncomeGross,
    preTaxContributions: income.preTaxContributions,
    rothContributions: income.rothContributions,
    afterTaxContributions: income.afterTaxContributions,
    employerMatch: income.employerMatch,
    contributionsCappedAmount: income.contributionsCappedAmount,
    surplusContribution,
    audit,
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
  /** Resolved profile key per year — follows successor-profile chains so post-transition
   *  years carry e.g. "South Carolina (2027+)" rather than the timeline's "South Carolina". */
  stateResolvedKeyByYear: string[];
  /** Per-state profile resolved for each year (follows successor profiles for SC, WV). */
  stateProfileByYear: StateTaxProfile[];
  ageByYear: number[];
  spouseAgeByYear: Array<number | null>;
  incomeByYear: AccumulatedIncome[];
  spendingByYear: Array<{
    baseSpendingNet: number;
    otherSpendingGoalsNet: number;
  }>;
  /** Max additional Trad-spending dollars per year that stay within the 12%
   *  federal bracket, **conv-inclusive** (the year's conversion gross is already
   *  in the baseline). Used by `computeSpendingWaterfall` under
   *  `spendingWithdrawalOrder === 'bracket_aware'`. Zero when no headroom
   *  (high-bracket years) or when the strategy is `taxable_first`. */
  bracketHeadroomForTradByYear: number[];
  /** Resolved spending-source strategy for the scenario. Computed once via
   *  `resolveSpendingWithdrawalOrder` so each MC run doesn't re-scan
   *  `incomeEvents`. */
  spendingOrder: ResolvedSpendingOrder;
}

// Resolve the spending-source strategy for the scenario. Content-aware default:
// if any roth_conversion event exists, default to 'bracket_aware' (preserves
// Taxable for high-mt conversion years); otherwise 'taxable_first' (current
// conservative behavior). User can override via UserData.spendingWithdrawalOrder.
//
// Unknown values (legacy 'pro_rata' from a prior enum draft, typos in
// hand-edited JSON, etc.) are NOT trusted — they fall through to the
// content-aware default rather than silently behaving like taxable_first
// with no signal. The TypeScript type prevents this for code-authored
// scenarios; the runtime check covers JSON-imported scenarios.
export type ResolvedSpendingOrder = 'taxable_first' | 'bracket_aware';
export function resolveSpendingWithdrawalOrder(userData: UserData): ResolvedSpendingOrder {
  const v = userData.spendingWithdrawalOrder;
  if (v === 'taxable_first' || v === 'bracket_aware') return v;
  const hasConversion = userData.incomeEvents.some((e) => e.type === 'roth_conversion');
  return hasConversion ? 'bracket_aware' : 'taxable_first';
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
  // Spending-source strategy is resolved once in the precompute layer
  // (runSimulation / runDeterministicProjection) so each MC run reuses it.
  const spendingOrder = precomputes.spendingOrder;

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
    const yearStateProfile = precomputes.stateProfileByYear[i];
    // Resolved profile key (may differ from the timeline's state name when a
    // successor profile applied — precompute stored the resolved key, not the raw input).
    const yearStateResolvedKey = precomputes.stateResolvedKeyByYear[i];
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
      userData, year, yearIncome, yearSpending, yearStateProfile, yearStateResolvedKey, yearAge, yearSpouseAge, balances, beginningTradBalances, cap, userData.inflationRate, priorMagi,
      spendingOrder, precomputes.bracketHeadroomForTradByYear[i],
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

export interface PercentileBand {
  p10: number[];
  p90: number[];
}

export interface McStats {
  medianEndingBalance: number;
  p10EndingBalance: number;
  medianDepletionAge: number | null;
  worstDecileDepletionAge: number | null;
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
  percentileBand: PercentileBand | null;
  mcStats: McStats | null;
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
  const stateResolvedKeyByYear: string[] = new Array(totalYears);
  const stateProfileByYear: StateTaxProfile[] = new Array(totalYears);
  const ageByYear: number[] = new Array(totalYears);
  const spouseAgeByYear: Array<number | null> = new Array(totalYears);
  const incomeByYear: Precomputes['incomeByYear'] = new Array(totalYears);
  const spendingByYear: Precomputes['spendingByYear'] = new Array(totalYears);
  const bracketHeadroomForTradByYear: number[] = new Array(totalYears);
  const resolvedSpendingOrder = resolveSpendingWithdrawalOrder(userData);
  for (let i = 0; i < totalYears; i++) {
    const year = currentYear + i;
    const sn = getEffectiveStateName(userData, year);
    const resolved = getStateTaxProfile(sn, year);
    // Store the resolved registry key (may differ from `sn` when a year-bounded
    // successor profile applies — e.g. "South Carolina" → "South Carolina (2027+)").
    stateResolvedKeyByYear[i] = resolved.resolvedKey;
    stateProfileByYear[i] = resolved.profile;
    ageByYear[i] = userData.currentAge + i;
    spouseAgeByYear[i] = userData.spouseAge !== null ? userData.spouseAge + i : null;
    incomeByYear[i] = accumulateIncome(userData, year, inflationRate);
    spendingByYear[i] = accumulateSpending(userData, year, inflationRate);
    bracketHeadroomForTradByYear[i] = resolvedSpendingOrder === 'bracket_aware'
      ? computeBracketHeadroomForTrad(userData, incomeByYear[i], year, inflationRate, ageByYear[i], spouseAgeByYear[i])
      : 0;
  }
  const precomputes: Precomputes = {
    stateResolvedKeyByYear, stateProfileByYear, ageByYear, spouseAgeByYear, incomeByYear, spendingByYear,
    bracketHeadroomForTradByYear, spendingOrder: resolvedSpendingOrder,
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

  // Year-by-year percentile envelope and ending-balance / depletion stats.
  // Skipped when there aren't enough runs to compute meaningful percentiles
  // (e.g. historical_single mode has numRuns === 1).
  let percentileBand: PercentileBand | null = null;
  let mcStats: McStats | null = null;
  if (numRuns >= 10) {
    const p10Idx = Math.floor(numRuns * 0.1);
    const p90Idx = Math.floor(numRuns * 0.9);
    const p50Idx = Math.floor(numRuns * 0.5);
    const p10 = new Array<number>(totalYears);
    const p90 = new Array<number>(totalYears);
    const colBuf = new Array<number>(numRuns);
    for (let y = 0; y < totalYears; y++) {
      for (let r = 0; r < numRuns; r++) colBuf[r] = allRuns[r].path[y];
      colBuf.sort((a, b) => a - b);
      p10[y] = colBuf[p10Idx];
      p90[y] = colBuf[p90Idx];
    }
    percentileBand = { p10, p90 };

    const finals = new Array<number>(numRuns);
    for (let r = 0; r < numRuns; r++) finals[r] = allRuns[r].path[totalYears - 1];
    finals.sort((a, b) => a - b);

    // Depletion year: failedYear when failed, Infinity for survivors. Sort ascending
    // so the p10 index lands on the earliest-depleting decile, p50 on the median.
    const depletionYears = new Array<number>(numRuns);
    for (let r = 0; r < numRuns; r++) {
      depletionYears[r] = allRuns[r].failed ? allRuns[r].failedYear : Infinity;
    }
    depletionYears.sort((a, b) => a - b);
    const medianDepYear = depletionYears[p50Idx];
    const worstDecileDepYear = depletionYears[p10Idx];

    mcStats = {
      medianEndingBalance: finals[p50Idx],
      p10EndingBalance: finals[p10Idx],
      medianDepletionAge: Number.isFinite(medianDepYear) ? userData.currentAge + medianDepYear : null,
      worstDecileDepletionAge: Number.isFinite(worstDecileDepYear) ? userData.currentAge + worstDecileDepYear : null,
    };
  }

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
    percentileBand,
    mcStats,
  };
}

// Single-path deterministic projection using the nominal generator — the same
// engine that drives the "Deterministic" chart line. Exposed so callers (e.g.,
// the Roth Conversion dialog's Net impact preview) can compute with-vs-without
// deltas without paying for a full Monte Carlo run.
export function runDeterministicProjection(rawUserData: UserData): {
  path: number[];
  breakdowns: AnnualCashFlowBreakdown[];
  inflation: number[];
  years: number[];
} {
  clearTaxCalculationCache();
  const userData = ensureRothConversionAccount(ensureReinvestmentAccount(rawUserData));
  const currentYear = userData.referenceYear;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const inflationRate = userData.inflationRate;

  const stateResolvedKeyByYear: string[] = new Array(totalYears);
  const stateProfileByYear: StateTaxProfile[] = new Array(totalYears);
  const ageByYear: number[] = new Array(totalYears);
  const spouseAgeByYear: Array<number | null> = new Array(totalYears);
  const incomeByYear: Precomputes['incomeByYear'] = new Array(totalYears);
  const spendingByYear: Precomputes['spendingByYear'] = new Array(totalYears);
  const bracketHeadroomForTradByYear: number[] = new Array(totalYears);
  const resolvedSpendingOrder = resolveSpendingWithdrawalOrder(userData);
  for (let i = 0; i < totalYears; i++) {
    const year = currentYear + i;
    const sn = getEffectiveStateName(userData, year);
    const resolved = getStateTaxProfile(sn, year);
    // Store the resolved registry key (may differ from `sn` when a year-bounded
    // successor profile applies — e.g. "South Carolina" → "South Carolina (2027+)").
    stateResolvedKeyByYear[i] = resolved.resolvedKey;
    stateProfileByYear[i] = resolved.profile;
    ageByYear[i] = userData.currentAge + i;
    spouseAgeByYear[i] = userData.spouseAge !== null ? userData.spouseAge + i : null;
    incomeByYear[i] = accumulateIncome(userData, year, inflationRate);
    spendingByYear[i] = accumulateSpending(userData, year, inflationRate);
    bracketHeadroomForTradByYear[i] = resolvedSpendingOrder === 'bracket_aware'
      ? computeBracketHeadroomForTrad(userData, incomeByYear[i], year, inflationRate, ageByYear[i], spouseAgeByYear[i])
      : 0;
  }
  const precomputes: Precomputes = {
    stateResolvedKeyByYear, stateProfileByYear, ageByYear, spouseAgeByYear, incomeByYear, spendingByYear,
    bracketHeadroomForTradByYear, spendingOrder: resolvedSpendingOrder,
  };
  const accountIndex = buildAccountIndex(userData);
  const blackSwanLookup = buildBlackSwanLookup(userData);
  const nominalGenerator = createNominalGenerator(userData);
  const run = simulateOneRun(
    userData, precomputes, accountIndex, nominalGenerator, 0, Math.random, blackSwanLookup
  );
  const years = Array.from({ length: totalYears }, (_, i) => currentYear + i);
  return { path: run.path, breakdowns: run.breakdowns, inflation: run.inflation, years };
}
