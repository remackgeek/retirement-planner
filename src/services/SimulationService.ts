import type { UserData, CashBucketPolicy } from '../types/UserData';
// Spending-source order is auto-selected per scenario via
// `selectBestSpendingOrder`. The legacy `taxStrategy` field on UserData is
// no longer consulted by the engine — it is stripped on scenario load by
// `migrateLegacyTaxStrategy` in RetirementContext. The legacy
// `spendingWithdrawalOrder` field is similarly stripped by
// `stripDeprecatedSpendingWithdrawalOrder`.
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
  computeFederalLTCGTax,
  getFederalTaxableIncome,
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
import { HISTORICAL_YEARS } from '../data/historicalReturns';

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

/**
 * Translate a CashBucketPolicy's month-denominated thresholds into dollar
 * amounts for the year, given the year's total spending net. Single source of
 * truth used by BOTH the in-loop spending waterfall (clamps Cash pulls at
 * `minCash`) and the post-convergence step (sweep above `maxCash`, refill
 * toward `targetCash`). Keeping the formula here prevents the two sites from
 * drifting if the definition of "monthly" ever changes.
 */
export function cashBucketBounds(
  policy: { minMonths: number; targetMonths: number; maxMonths: number },
  totalSpendingNet: number,
): { minCash: number; targetCash: number; maxCash: number } {
  const monthly = totalSpendingNet / 12;
  return {
    minCash: policy.minMonths * monthly,
    targetCash: policy.targetMonths * monthly,
    maxCash: policy.maxMonths * monthly,
  };
}

// Resolve the active state name for a given calendar year by walking the
// scenario's stateTimeline. Used by the tax-audit detail rendering to label
// which state's rate applied this year (the federal/state ordinary-tax split
// is more interpretable when the user can see "this is California's 8% on
// gross").
export function getEffectiveStateName(userData: UserData, year: number): string {
  const timeline = userData.stateTimeline;
  // Defense-in-depth: the import validator enforces non-empty stateTimeline,
  // but the engine shouldn't trust UI invariants for programmatically-built
  // scenarios. Fall back to Florida (zero state tax) and warn so any leakage
  // surfaces in dev rather than throwing on `timeline[0].state`.
  if (!timeline || timeline.length === 0) {
    if (typeof console !== 'undefined') {
      console.warn('[getEffectiveStateName] stateTimeline is empty; falling back to Florida.');
    }
    return 'Florida';
  }
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
  firstBrokerage: Account | null;
  firstCash: Account | null;
  // event.id → resolved deposit-target account.id, for retirement_contribution events.
  // Built once so depositContributions doesn't re-resolve per year per run.
  contributionTargetByEventId: Map<string, string>;
  // account.id → stockAllocation, for the inner growth loop.
  allocationById: Map<string, number>;
  // account.id → true iff the account is type 'cash'. Used in the growth loop's
  // hot path to bypass the stock/bond shock multiplier + black-swan overlay and
  // apply a deterministic yield instead. Cash is non-volatile by construction
  // in this model (see CLAUDE.md).
  isCashById: Map<string, boolean>;
}

export function buildAccountIndex(userData: UserData): AccountIndex {
  const byId = new Map<string, Account>();
  const byType: Record<AccountType, Account[]> = { brokerage: [], traditional: [], roth: [], cash: [] };
  const allocationById = new Map<string, number>();
  const isCashById = new Map<string, boolean>();
  for (const a of userData.accounts) {
    byId.set(a.id, a);
    byType[a.type].push(a);
    allocationById.set(a.id, a.stockAllocation);
    isCashById.set(a.id, a.type === 'cash');
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
    firstBrokerage: byType.brokerage[0] ?? null,
    firstCash: byType.cash[0] ?? null,
    contributionTargetByEventId,
    allocationById,
    isCashById,
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
// Optional `sink` accumulates the per-account amount actually deposited. Optional
// `extraSink` receives the same per-account amounts — useful when a single call
// site needs to mirror its deposits into both a shared deposit aggregator and a
// purpose-specific sink (e.g., isolating Roth-conversion-deposit shares from
// Roth-contribution-deposit shares in audit.rothConvDepositByAccount).
function addToAccounts(
  typeAccounts: Account[],
  balances: Record<string, number>,
  amount: number,
  sink?: Map<string, number>,
  extraSink?: Map<string, number>,
): void {
  if (amount <= 0 || typeAccounts.length === 0) return;
  let typeTotal = 0;
  for (const a of typeAccounts) typeTotal += balances[a.id] ?? 0;
  if (typeTotal <= 0) {
    const first = typeAccounts[0];
    balances[first.id] = (balances[first.id] ?? 0) + amount;
    if (sink) sink.set(first.id, (sink.get(first.id) ?? 0) + amount);
    if (extraSink) extraSink.set(first.id, (extraSink.get(first.id) ?? 0) + amount);
    return;
  }
  for (const a of typeAccounts) {
    const bal = balances[a.id] ?? 0;
    const share = (bal / typeTotal) * amount;
    balances[a.id] = bal + share;
    if (sink && share > 0) sink.set(a.id, (sink.get(a.id) ?? 0) + share);
    if (extraSink && share > 0) extraSink.set(a.id, (extraSink.get(a.id) ?? 0) + share);
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
        : 'brokerage';
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
  balances: Record<string, number>,
  // When false, skip building the per-account flow rows used by the Tax Audit
  // UI. The Map sinks are still allocated (cheap, needed by the rebalancing
  // helpers' optional-sink contract) — only the rows-array construction and
  // the breakdown.audit.accountFlows assignment are skipped.
  includeAudit: boolean = true
): void {
  const withdrawalSink = new Map<string, number>();
  const depositSink = new Map<string, number>();
  // rmdSink tracks per-account RMD shares only (Pass 1 + Pass 2 below). This
  // is what powers `audit.rmdByAccount` for the Cash Flow Sankey's per-account
  // RMD detail. The non-RMD Trad withdrawal (Pass 3) accumulates into
  // withdrawalSink alongside other account types — its per-account number is
  // visible in accountFlows but isn't decomposed by sub-purpose.
  const rmdSink = new Map<string, number>();
  // rothConvDepositSink isolates the per-Roth-account share of the Roth
  // conversion deposit (separate from `depositSink`, which also includes
  // retirement_contribution Roth deposits and would conflate the two).
  // Surfaced as `audit.rothConvDepositByAccount` for the Sankey per-account
  // deposit detail.
  const rothConvDepositSink = new Map<string, number>();
  // Cash withdrawals are tax-free principal pulls — sourced first by the
  // waterfall, but the order of subtractFromAccounts calls here doesn't matter
  // since each one operates on its own account-type subset of balances.
  subtractFromAccounts(accountIndex.byType.cash, balances, breakdown.withdrawalFromCash, withdrawalSink);
  subtractFromAccounts(accountIndex.byType.brokerage, balances, breakdown.withdrawalFromBrokerage, withdrawalSink);

  // Traditional withdrawal is split into three passes so per-owner RMD discipline
  // is honored (IRS rule: each owner's RMD must be satisfied from their own
  // accounts — a Spouse's IRA cannot fund Self's RMD). Non-RMD Trad pulls
  // (discretionary spending + Roth conversion gross) keep the existing pro-rata-
  // across-all-Trad behavior (no household-level IRS constraint on those).
  //
  // Order: RMD passes BEFORE the non-RMD pass. The IRS doesn't dictate intra-year
  // order so either sequence would conserve total cash flow, but RMD-first matches
  // the spending-waterfall mental model (forced obligations satisfied before
  // discretionary). Per-account ending balances differ subtly between the two
  // orders because Pass 3 sees post-RMD reduced balances; this is harmless.
  const rmdSelf = breakdown.audit?.rmdSelf ?? 0;
  const rmdSpouse = breakdown.audit?.rmdSpouse ?? 0;
  const tradAccounts = accountIndex.byType.traditional;
  if (rmdSelf > 0) {
    // Default ownership is 'self' when the field is absent (matches the rest of the engine).
    const selfTrad = tradAccounts.filter(a => (a.owner ?? 'self') === 'self');
    subtractFromAccounts(selfTrad, balances, rmdSelf, rmdSink);
  }
  if (rmdSpouse > 0) {
    const spouseTrad = tradAccounts.filter(a => a.owner === 'spouse');
    subtractFromAccounts(spouseTrad, balances, rmdSpouse, rmdSink);
  }
  // Pass 3a — Self conversion pulls from Self-owned Trad only (IRS rule:
  // a conversion moves Self's Trad to Self's Roth; Spouse's Trad cannot fund it).
  const convSelf = breakdown.rothConversionGrossSelf;
  if (convSelf > 0) {
    const selfTrad = tradAccounts.filter(a => (a.owner ?? 'self') === 'self');
    subtractFromAccounts(selfTrad, balances, convSelf, withdrawalSink);
  }
  // Pass 3b — Spouse conversion pulls from Spouse-owned Trad only.
  const convSpouse = breakdown.rothConversionGrossSpouse;
  if (convSpouse > 0) {
    const spouseTrad = tradAccounts.filter(a => a.owner === 'spouse');
    subtractFromAccounts(spouseTrad, balances, convSpouse, withdrawalSink);
  }
  // Pass 3c — discretionary spending pull (the leftover non-RMD non-conversion
  // portion). No household-level IRS constraint, so pro-rata across ALL Trad.
  const discretionaryTrad = Math.max(
    0,
    breakdown.withdrawalFromTraditional - rmdSelf - rmdSpouse - convSelf - convSpouse,
  );
  if (discretionaryTrad > 0) {
    subtractFromAccounts(tradAccounts, balances, discretionaryTrad, withdrawalSink);
  }
  // Merge rmdSink into withdrawalSink so accountFlows reports total per-account
  // Trad outflow (RMD + non-RMD). rmdSink stays separate for rmdByAccount.
  rmdSink.forEach((amount, id) => {
    if (amount <= 0) return;
    withdrawalSink.set(id, (withdrawalSink.get(id) ?? 0) + amount);
  });

  subtractFromAccounts(accountIndex.byType.roth, balances, breakdown.withdrawalFromRoth, withdrawalSink);
  // Deposit Roth conversion into Roth accounts — PER OWNER (IRS rule: each
  // owner's conversion deposits into their own Roth accounts). The deposit
  // is the per-owner gross minus that owner's withheld-tax share.
  // ensureRothConversionAccount guarantees a per-owner receiving Roth exists
  // whenever a per-owner conversion event exists.
  if (breakdown.rothConversionGross > 0) {
    const rothAccounts = accountIndex.byType.roth;
    const selfRoth   = rothAccounts.filter(a => (a.owner ?? 'self') === 'self');
    const spouseRoth = rothAccounts.filter(a => a.owner === 'spouse');
    const depositSelf   = Math.max(0, breakdown.rothConversionGrossSelf   - breakdown.rothConversionTaxWithheldSelf);
    const depositSpouse = Math.max(0, breakdown.rothConversionGrossSpouse - breakdown.rothConversionTaxWithheldSpouse);
    if (depositSelf > 0)   addToAccounts(selfRoth,   balances, depositSelf,   depositSink, rothConvDepositSink);
    if (depositSpouse > 0) addToAccounts(spouseRoth, balances, depositSpouse, depositSink, rothConvDepositSink);
  }
  // Deposit RMD excess into the first taxable account (already ensured to exist by caller).
  if (breakdown.rmdExcess > 0 && accountIndex.firstBrokerage) {
    const id = accountIndex.firstBrokerage.id;
    balances[id] = (balances[id] ?? 0) + breakdown.rmdExcess;
    depositSink.set(id, (depositSink.get(id) ?? 0) + breakdown.rmdExcess);
  }
  // Retirement contributions (explicit deposit instructions, independent of surplus).
  depositContributions(accountIndex, contributions, balances, depositSink);
  // Surplus: deposit any positive netCashFlow into the first taxable account.
  // ensureReinvestmentAccount guarantees one exists when surplus is possible.
  if (breakdown.netCashFlow > 0 && accountIndex.firstBrokerage) {
    const id = accountIndex.firstBrokerage.id;
    balances[id] = (balances[id] ?? 0) + breakdown.netCashFlow;
    depositSink.set(id, (depositSink.get(id) ?? 0) + breakdown.netCashFlow);
  }

  // Surface per-account flows for the Tax Audit view. One row per account that
  // had any movement this year — withdrawal + deposit on the same row when both
  // happened (e.g. a taxable account that paid for spending then received the
  // surplus deposit). Lookup is via accountIndex.byId so we resolve the
  // up-to-date account name and type even for synthetic Reinvestment / Roth
  // Conversion accounts injected by ensure*Account.
  if (!includeAudit) return;
  const seen = new Set<string>();
  const rows: AccountFlowRow[] = [];
  withdrawalSink.forEach((amount, id) => {
    if (amount <= 0) return;
    seen.add(id);
    const acct = accountIndex.byId.get(id);
    rows.push({
      accountId: id,
      accountName: acct?.name ?? id,
      accountType: acct?.type ?? 'brokerage',
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
      accountType: acct?.type ?? 'brokerage',
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
  if (breakdown.audit) {
    breakdown.audit.accountFlows = rows;
    // Per-account RMD attribution. Built from rmdSink alone so non-RMD Trad
    // pulls in the same year don't pollute the row values. Conservation:
    // sum equals rmdRequired within $1 (engine assertion).
    const rmdRows: AccountFlowRow[] = [];
    rmdSink.forEach((amount, id) => {
      if (amount <= 0) return;
      const acct = accountIndex.byId.get(id);
      rmdRows.push({
        accountId: id,
        accountName: acct?.name ?? id,
        accountType: acct?.type ?? 'traditional',
        withdrawal: amount,
        deposit: 0,
      });
    });
    breakdown.audit.rmdByAccount = rmdRows;
    // Per-account Roth conversion deposit. Built from rothConvDepositSink so
    // Roth contribution deposits (from retirement_contribution events) don't
    // pollute the row values. Conservation: sum equals
    // (rothConversionGross − rothConversionTaxWithheld) within $1.
    const rothConvDepositRows: AccountFlowRow[] = [];
    rothConvDepositSink.forEach((amount, id) => {
      if (amount <= 0) return;
      const acct = accountIndex.byId.get(id);
      rothConvDepositRows.push({
        accountId: id,
        accountName: acct?.name ?? id,
        accountType: acct?.type ?? 'roth',
        withdrawal: 0,
        deposit: amount,
      });
    });
    breakdown.audit.rothConvDepositByAccount = rothConvDepositRows;
  }
}

/**
 * Phase 2 post-convergence bucket-policy step. Runs AFTER `applyCashFlow` has
 * settled all account flows for the year (withdrawals, conversion deposit,
 * RMD-excess reinvestment, surplus deposit to Taxable, contribution deposits).
 *
 * STRUCTURAL INVARIANT (load-bearing — type-enforced by this signature):
 * This function receives only the *settled* balances and a minimal subset of
 * the breakdown needed to compute floor/target/ceiling against monthly spending,
 * plus the policy and trigger inputs. It does NOT receive the full breakdown,
 * does NOT import tax modules, and its return type contains only cash-routing
 * fields. As a result, it cannot accidentally mutate `totalTax`,
 * `ordinaryTax`, `federalCapGainsTax`, NIIT, IRMAA, or any income field.
 * This makes "post-convergence step never re-enters the tax calc" a type-level
 * guarantee rather than a discipline.
 *
 * Operations:
 *  - SWEEP: when cashBal > maxMonths × monthly, move excess to first Taxable.
 *    Tax-free balance transfer (no withdrawal path, no LTCG realized).
 *  - REFILL: when cashBal < minMonths × monthly AND refillTrigger fires AND
 *    surplus dollars are available (capped by `netCashFlow > 0` from this
 *    year, already deposited into Taxable by applyCashFlow), move that surplus
 *    from Taxable to first Cash up to targetMonths × monthly. Surplus-only
 *    sourcing prevents phantom-tax archetype #3.
 *
 * Returns the dollar amounts moved so the breakdown / CSV / audit can show
 * exactly where cash came from / went.
 */
function applyPostConvergenceBucketPolicy(
  settled: { baseSpendingNet: number; otherSpendingGoalsNet: number; netCashFlow: number; spendingShortfall: number },
  balances: Record<string, number>,
  policy: CashBucketPolicy,
  accountIndex: AccountIndex,
  triggerInputs: { stockFactor: number; portfolioPostGrowth: number; deterministicBaseline: number | null },
): { cashRefillFromSurplus: number; cashSweepToBrokerage: number } {
  // No-op when policy is manual mode. Caller could also gate the call, but
  // making this no-op internally keeps the call-site simpler.
  if (policy.refillTrigger === 'none') {
    return { cashRefillFromSurplus: 0, cashSweepToBrokerage: 0 };
  }
  // No-op when neither a Cash nor a Taxable bucket exists — nothing to route between.
  const cashAcct = accountIndex.firstCash;
  const brokerageAcct = accountIndex.firstBrokerage;
  if (!cashAcct || !brokerageAcct) {
    return { cashRefillFromSurplus: 0, cashSweepToBrokerage: 0 };
  }

  // Use TOTAL spending net as the monthly basis (mirrors the floor used in
  // computeSpendingWaterfall). The cashBucketBounds helper is the single
  // source of truth so the spending floor and the refill/sweep thresholds
  // can't drift independently.
  const totalSpendingNet = settled.baseSpendingNet + settled.otherSpendingGoalsNet;
  const { minCash, targetCash, maxCash } = cashBucketBounds(policy, totalSpendingNet);

  // Sum cash across all cash accounts (multiple are unusual but supported);
  // sweeps and refills route to/from the first cash account in the index.
  let cashBal = 0;
  for (const a of accountIndex.byType.cash) cashBal += balances[a.id] ?? 0;

  // SWEEP first. If cash is well above max, move the excess to Taxable.
  // Pure balance transfer.
  let cashSweepToBrokerage = 0;
  if (cashBal > maxCash) {
    cashSweepToBrokerage = cashBal - maxCash;
    balances[cashAcct.id] = (balances[cashAcct.id] ?? 0) - cashSweepToBrokerage;
    balances[brokerageAcct.id] = (balances[brokerageAcct.id] ?? 0) + cashSweepToBrokerage;
    cashBal -= cashSweepToBrokerage;
  }

  // REFILL: when cash is below min and the trigger fires.
  // Surplus is the dollars that just deposited into Taxable via applyCashFlow's
  // surplus-routing branch. We "reroute" that same money into Cash up to target.
  let cashRefillFromSurplus = 0;
  // Suppress refill in shortfall years (depletion-edge). When the portfolio is
  // already failing, surplus by definition can't exist, but the early-exit also
  // documents intent.
  if (cashBal < minCash && settled.spendingShortfall === 0) {
    let triggerFired = false;
    switch (policy.refillTrigger) {
      case 'always':
        triggerFired = true;
        break;
      case 'gains_only':
        triggerFired = triggerInputs.stockFactor > 1;
        break;
      case 'above_baseline':
        triggerFired = triggerInputs.deterministicBaseline !== null
          && triggerInputs.deterministicBaseline > 0
          && triggerInputs.portfolioPostGrowth / triggerInputs.deterministicBaseline > 1;
        break;
      // 'none' is filtered out by the early-return at the top of the function;
      // TypeScript narrows it out of the switch's discriminated union.
    }
    if (triggerFired) {
      const surplus = Math.max(0, settled.netCashFlow);
      const desired = targetCash - cashBal;
      cashRefillFromSurplus = Math.min(desired, surplus);
      if (cashRefillFromSurplus > 0) {
        // Surplus already lives in the first taxable (via applyCashFlow);
        // move that amount over to cash.
        balances[brokerageAcct.id] = (balances[brokerageAcct.id] ?? 0) - cashRefillFromSurplus;
        balances[cashAcct.id] = (balances[cashAcct.id] ?? 0) + cashRefillFromSurplus;
      }
    }
  }

  return { cashRefillFromSurplus, cashSweepToBrokerage };
}

// Ensure a taxable account exists to receive (a) excess RMD reinvestment from
// Traditional balances after age 73 and (b) general surplus (positive netCashFlow)
// from any year. The synthetic "Reinvestment" account starts at $0 and only matters
// if it actually receives deposits; injecting it whenever no taxable account exists
// is trivially safe. Returns a shallow copy with the account added when needed.
/** Account IDs reserved for engine-injected synthetic accounts. The
 *  `ensure*Account` helpers below gate on account *type* (not id), so a
 *  user-defined account of the matching type prevents the synthetic from
 *  being added regardless of its id. These constants are kept as named
 *  exports for clarity and as audit anchors in scenario JSON exports. */
export const SYNTHETIC_REINVESTMENT_ID = 'reinvestment-auto';
export const SYNTHETIC_CASH_BUCKET_ID = 'cash-bucket-auto';
export const SYNTHETIC_ROTH_CONVERSION_ID = 'roth-conversion-auto';

function ensureReinvestmentAccount(userData: UserData): UserData {
  if (userData.accounts.some((a) => a.type === 'brokerage')) return userData;
  const reinvestAccount: Account = {
    id: SYNTHETIC_REINVESTMENT_ID,
    name: 'Reinvestment',
    type: 'brokerage',
    balance: 0,
    stockAllocation: 0.6,
    portfolioBalance: '60_40',
  };
  return { ...userData, accounts: [...userData.accounts, reinvestAccount] };
}

// When a `cashBucketPolicy` is configured but the user hasn't created a cash
// account, inject a synthetic zero-balance "Cash Bucket" cash account so that
// surplus routing + bucket refill have a destination. Activates only when the
// policy is present — without policy, no cash account = no cash management,
// no synthetic. Mirrors the `ensureReinvestmentAccount` / `ensureRothConversionAccount`
// pattern. Must run BEFORE `ensureReinvestmentAccount` so the synthetic-account
// selection rule (Cash if policy, else Reinvestment-Taxable) holds when neither
// taxable nor cash exists.
function ensureCashAccount(userData: UserData): UserData {
  if (!userData.cashBucketPolicy) return userData;
  if (userData.accounts.some((a) => a.type === 'cash')) return userData;
  const cashAccount: Account = {
    id: SYNTHETIC_CASH_BUCKET_ID,
    name: 'Cash Bucket',
    type: 'cash',
    balance: 0,
    stockAllocation: 0,
    portfolioBalance: '60_40',
  };
  return { ...userData, accounts: [...userData.accounts, cashAccount] };
}

// If any Roth conversion events exist but there is no per-owner Roth account
// to receive the converted funds, inject one zero-balance synthetic Roth per
// owner. The IRS rule that a conversion deposits to the same-owner Roth means
// a Spouse conversion event with no Spouse-owned Roth needs a Spouse synthetic
// (even if a Self-owned Roth already exists — Self's Roth can't receive
// Spouse's conversion).
function ensureRothConversionAccount(userData: UserData): UserData {
  const conversionEvents = userData.incomeEvents.filter((e) => e.type === 'roth_conversion');
  if (conversionEvents.length === 0) return userData;
  const needsOwners = new Set<'self' | 'spouse'>();
  for (const e of conversionEvents) needsOwners.add(e.owner ?? 'self');
  const existingRothByOwner = new Set<'self' | 'spouse'>();
  for (const a of userData.accounts) {
    if (a.type === 'roth') existingRothByOwner.add(a.owner ?? 'self');
  }
  const newAccounts: Account[] = [];
  for (const owner of needsOwners) {
    if (existingRothByOwner.has(owner)) continue;
    newAccounts.push({
      // Self keeps the legacy ID for back-compat with any persisted scenario
      // that already injected the synthetic before this fix.
      id: owner === 'self' ? SYNTHETIC_ROTH_CONVERSION_ID : `${SYNTHETIC_ROTH_CONVERSION_ID}-spouse`,
      name: owner === 'self' ? 'Roth Conversion' : 'Roth Conversion (Spouse)',
      type: 'roth',
      owner,
      balance: 0,
      stockAllocation: 0.6,
      portfolioBalance: '60_40',
    });
  }
  if (newAccounts.length === 0) return userData;
  return { ...userData, accounts: [...userData.accounts, ...newAccounts] };
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
  withdrawalFromBrokerage: number;
  withdrawalFromTraditional: number;  // total Traditional outflow: spending + RMD + Roth conversion
  withdrawalFromRoth: number;
  withdrawalFromCash: number;        // spending pull from cash accounts (tax-free principal); 0 when no cash account
  cashInterest: number;              // deterministic yield credited on beginning-of-year cash balance; taxed as ordinary income (folded into otherTaxableGross)
  cashEndingBalance: number;         // sum of cash account balances at end of year (post-growth, post-withdrawal, POST refill/sweep). 0 when no cash account exists
  cashRefillFromSurplus: number;     // (Phase 2) dollars moved Taxable→Cash by the post-convergence bucket policy refill step this year. Surplus-funded only; never realizes LTCG.
  cashSweepToBrokerage: number;        // (Phase 2) dollars moved Cash→Taxable by the post-convergence sweep when cash > maxMonths × monthly. Tax-free balance transfer.
  totalTax: number;
  ordinaryTax: number;      // ordinary income tax (federal + state + locality surcharge) on Traditional + SS + other taxable
  federalCapGainsTax: number; // federal LTCG tax on taxable account withdrawals (flat longTermCapGainsRate × fromBrokerage, or 0/15/20% stacked when useStackedLtcgBrackets)
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
  rothConversionTaxFromCash: number;     // portion of conversion ordinary tax pulled from cash accounts (tax-free)
  rothConversionTaxFromBrokerage: number;  // portion of conversion ordinary tax pulled from Taxable
  rothConversionTaxFromRmdExcess: number;  // portion of conversion ordinary tax absorbed by RMD-excess cash
  // Portion of conversion ordinary tax withheld from the conversion itself
  // (IRS Form 1099-R Box 4 mechanic). Subtracted from the Roth deposit by
  // applyCashFlow. Non-zero when Taxable + RMD-excess can't cover the marginal
  // ordinary tax; surfaces a dialog warning advising the user that withholding
  // is suboptimal vs. funding from Taxable.
  rothConversionTaxWithheld: number;
  // Per-owner split of the conversion gross (sum = rothConversionGross within $1).
  // Self's conversion pulls from Self-owned Trad only and deposits to Self-owned
  // Roth only; same for Spouse. The per-owner cap binds independently.
  rothConversionGrossSelf: number;
  rothConversionGrossSpouse: number;
  // Per-owner split of the withheld portion (sum = rothConversionTaxWithheld
  // within $1). Each owner's Roth deposit = their gross − their withheld share.
  rothConversionTaxWithheldSelf: number;
  rothConversionTaxWithheldSpouse: number;
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
  // IRS owner of the underlying event. Drives per-owner conversion sourcing
  // (Self conv pulls from Self-Trad only) and per-owner deposit (Self conv
  // deposits to Self-Roth only). Synthetic records (e.g. the
  // 'traditional_withdrawal' step in computeMarginalStackAttribution) default
  // to 'self' — the discretionary spending pull is household-pooled with no
  // IRS owner constraint, so the field is informational there.
  owner: 'self' | 'spouse';
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

  // ----- Per-account RMD attribution (populated by applyCashFlow) -----
  // Self-owned Traditional accounts contribute pro-rata to rmdSelf; Spouse-owned
  // contribute pro-rata to rmdSpouse. Sum equals rmdRequired (within $1 rounding).
  // `deposit` is always 0 on these rows — RMD is a withdrawal. Used by the Cash
  // Flow Sankey to decompose the RMD aggregator into per-account detail nodes.
  rmdByAccount?: AccountFlowRow[];

  // ----- Per-account Roth conversion deposit (populated by applyCashFlow) -----
  // Self conversion lands pro-rata in Self-owned Roth accounts only; Spouse
  // conversion in Spouse-owned Roth only. Sum equals (rothConversionGross −
  // rothConversionTaxWithheld) within $1. `withdrawal` is always 0 on these
  // rows — conversion deposit is by definition a deposit. Used by the Cash
  // Flow Sankey to decompose the dst_rothdep use-node into per-account detail
  // downstream. Isolated from the combined depositSink so Roth contributions
  // don't pollute the per-account conversion totals.
  rothConvDepositByAccount?: AccountFlowRow[];
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
  // Per-owner split of conversion gross (sum = conversionGross). Drives the
  // per-owner cap in calculateAnnualCashFlowCore (Self-conv capped by Self-Trad
  // available, Spouse-conv by Spouse-Trad — independently).
  conversionGrossSelf: number;
  conversionGrossSpouse: number;
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
// Defaults: 'brokerage' → brokerage; 'traditional' / 'roth' → IRA when accountKind is absent.
function getAccountKind(account: Account): AccountKind {
  if (account.accountKind) return account.accountKind;
  return account.type === 'brokerage' ? 'brokerage' : 'ira';
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
  let conversionGrossSelf = 0;
  let conversionGrossSpouse = 0;
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
      const convOwner: 'self' | 'spouse' = event.owner ?? 'self';
      if (convOwner === 'self') conversionGrossSelf += v;
      else                       conversionGrossSpouse += v;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Roth Conversion',
        eventType: event.type,
        gross: v,
        classification: 'roth_conversion',
        owner: convOwner,
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
        owner: event.owner ?? 'self',
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
        owner: event.owner ?? 'self',
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
        owner: event.owner ?? 'self',
      });
    } else if (event.type === 'social_security') {
      ssGross += effectiveAmount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? 'Social Security',
        eventType: event.type,
        gross: effectiveAmount,
        classification: 'social_security',
        owner: event.owner ?? 'self',
      });
    } else {
      otherTaxableGross += effectiveAmount;
      eventBreakdowns.push({
        eventId: event.id,
        eventName: event.name ?? event.type,
        eventType: event.type,
        gross: effectiveAmount,
        classification: 'ordinary',
        owner: event.owner ?? 'self',
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
    conversionGrossSelf,
    conversionGrossSpouse,
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
        // Clamp the base above 0 to keep Math.pow real-valued. A
        // yearlyDecreasePercent of 100 would make the base zero (and any
        // subsequent fractional exponent NaN); >100 would make it negative
        // (Math.pow(negative, fractional) = NaN). User input shouldn't hit
        // these, but cheap defense costs nothing in the hot loop.
        const base = Math.max(0.0001, 1 - goal.yearlyDecreasePercent / 100);
        amount *= Math.pow(base, yearsSinceStart);
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
  /** Aggregate conversion total = self + spouse. Drives the synthetic
   *  `traditional_withdrawal` step's gross (fromTrad − rothConversionTotal). */
  rothConversionTotal: number;
  /** Per-owner conversion totals used to scale per-event conversion records
   *  independently. When a per-owner cap binds (e.g. Self capped, Spouse not),
   *  a uniform aggregate scale misallocates per-event gross — Self events
   *  would over-scale, Spouse events under-scale. Per-owner scaling fixes that. */
  rothConversionTotalSelf: number;
  rothConversionTotalSpouse: number;
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
    rothConversionTotalSelf, rothConversionTotalSpouse,
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
  // Roth conversion events. The per-owner cap (each owner's conversion is
  // capped by their own Trad balance after their RMD) can bind independently,
  // so events scale by their owner's ratio — not a single aggregate scale.
  // Example: Self requests $50k capped at $40k, Spouse requests $30k all
  // allowed. Uniform scale 70/80 would mis-show Self events at $43.75k and
  // Spouse at $26.25k; per-owner scale gives Self $40k and Spouse $30k.
  const conversionRecords = eventBreakdowns.filter((r) => r.classification === 'roth_conversion');
  if (conversionRecords.length > 0) {
    const selfRecords   = conversionRecords.filter((r) => r.owner === 'self');
    const spouseRecords = conversionRecords.filter((r) => r.owner === 'spouse');
    const selfRequested   = selfRecords.reduce((s, r) => s + r.gross, 0);
    const spouseRequested = spouseRecords.reduce((s, r) => s + r.gross, 0);
    const selfScale   = selfRequested   > 0 && rothConversionTotalSelf   > 0
      ? rothConversionTotalSelf   / selfRequested   : 0;
    const spouseScale = spouseRequested > 0 && rothConversionTotalSpouse > 0
      ? rothConversionTotalSpouse / spouseRequested : 0;
    for (const r of selfRecords) {
      const actualGross = r.gross * selfScale;
      if (actualGross <= 0) continue;
      steps.push({
        event: { id: r.eventId, name: r.eventName, type: r.eventType, gross: actualGross },
        signedTaxable: actualGross,
        kind: 'roth_conversion',
      });
    }
    for (const r of spouseRecords) {
      const actualGross = r.gross * spouseScale;
      if (actualGross <= 0) continue;
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
  beginningTradBalance?: number,
  /** Optional pin for the spending policy. When omitted, runs the auto-selector
   *  (which costs two deterministic projections). Tests and callers that want
   *  to isolate a specific policy — or skip the selector's cost — should pass
   *  this explicitly. */
  _forceSpendingOrder?: ResolvedSpendingOrder,
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
  const spendingOrder = _forceSpendingOrder ?? selectBestSpendingOrder(userData);
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
  // No IRMAA/NIIT cliff clamp here on purpose: the 12% bracket fills to roughly
  // $66k (single) / $133k (MFJ) of gross MAGI, both well below the first IRMAA
  // tier ($103k / $206k) and the NIIT threshold ($200k / $250k), so a 12%-bracket
  // spending pull can never trip those cliffs. Cliff-awareness lives where it can
  // bind — the 22%/24% conversion-sizing fill (respectIrmaaNiitCliffs in
  // FillToBracketStrategy).
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
  // Resolved spending-source strategy (see selectBestSpendingOrder).
  // Public wrapper resolves it; fast-path passes the precomputed value.
  spendingOrder: ResolvedSpendingOrder = 'brokerage_first',
  // Max additional Trad-spending dollars that stay within the 12% federal
  // bracket, **conv-inclusive**. Only consulted when spendingOrder === 'bracket_aware'.
  bracketHeadroomForTrad: number = 0,
  // When false, skip building the AnnualAuditBreakdown — the dominant per-iter
  // cost in the MC loop, used only by the 3 representative paths surfaced in
  // the Tax Audit UI. The 4997 stat-only runs pass false. Public wrapper
  // (calculateAnnualCashFlow) defaults to true to preserve external behavior.
  includeAudit: boolean = true,
  // Cash interest credited this year on cash account balances (yield × beginning
  // balance, applied deterministically in the growth loop). Folded into the
  // tax base as ordinary income (accrual basis) AND into the NIIT investment-
  // income proxy (taxable-MMF/HYSA interest is investment income per IRC §1411).
  // Caller passes 0 when no cash accounts exist (the only case for back-compat).
  cashInterest: number = 0,
): AnnualCashFlowBreakdown {
  const { ssGross, afterTaxIncome, conversionGross, conversionGrossSelf, conversionGrossSpouse } = income;
  // Cash interest is ordinary income (accrual basis, taxed in the year credited).
  // Fold into otherTaxableGross so the entire tax pipeline (federal/state ordinary,
  // SS taxability via provisional income, IRMAA MAGI, NIIT MAGI) treats it
  // uniformly. The breakdown surfaces both the inflated otherTaxableGross AND
  // the original cashInterest separately so callers can audit the source.
  const otherTaxableGross = income.otherTaxableGross + cashInterest;
  const totalSpendingNet = spending.baseSpendingNet + spending.otherSpendingGoalsNet;
  const totalGrossIncome = ssGross + otherTaxableGross + afterTaxIncome;
  const availableCash = afterTaxIncome + ssGross + otherTaxableGross;

  const ltcgRate = userData.longTermCapGainsRate ?? 0;
  const cashBal = sumBalancesOfType(userData.accounts, balances, 'cash');
  const brokerageBal = sumBalancesOfType(userData.accounts, balances, 'brokerage');
  const tradBal = sumBalancesOfType(userData.accounts, balances, 'traditional');
  const rothBal = sumBalancesOfType(userData.accounts, balances, 'roth');
  const totalBal = cashBal + brokerageBal + tradBal + rothBal;
  const cap = Math.min(maxWithdrawal ?? Infinity, totalBal);

  // Cash bucket policy soft floor. Spending and conversion tax sourcing pull
  // Cash only down to `minMonths × monthly`; below that, both fall through to
  // the next priority (Taxable / withhold). Rationale: in reality every user
  // has unmodeled liquid cash; the floor reflects how much they're willing to
  // hold in this bucket. When no policy is configured or refillTrigger is
  // 'none', minCashFloor = 0 (full drain allowed). The cashBucketBounds helper
  // is the single source of truth shared with applyPostConvergenceBucketPolicy
  // so the spending floor here cannot drift from the refill/sweep thresholds.
  // (Plan describes monthly as baseSpendingNet/12; using totalSpendingNet here
  // makes the floor robust against scenarios that put most spending into
  // discretionary goals — same intent, marginally more conservative.)
  const policy = userData.cashBucketPolicy;
  const minCashFloor = policy && policy.refillTrigger !== 'none'
    ? cashBucketBounds(policy, totalSpendingNet).minCash
    : 0;

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
  let fromCash = 0;
  let fromBrokerage = 0;
  let fromTrad = 0;
  let fromRoth = 0;
  let rmdExcess = 0;
  let rothConversion = 0;
  let rothConversionSelf = 0;
  let rothConversionSpouse = 0;
  let rothConversionRequested = Math.max(0, conversionGross);
  let capWasBinding = false;
  let ordinaryTax = 0;
  let federalCapGainsTax = 0;
  let stateCapGainsTax = 0;
  let stateLocalitySurcharge = 0;
  let stateOrdinaryTaxOnly = 0;
  let stateResultFinal: StateTaxResult | null = null;
  let niitTax = 0;
  // Conversion tax sourcing — populated inside the loop. Cash is preferred over
  // Taxable because pulling Taxable realizes LTCG/NIIT that itself amplifies the
  // marginal tax (the phantom-tax archetype). RMD-excess + Cash + Taxable are
  // the three external funding sources; if all run dry the residual is withheld
  // from the conversion's own Trad pull (IRS Form 1099-R Box 4 mechanic).
  let convTaxFromCash = 0;
  let convTaxFromBrokerage = 0;
  let convTaxFromRmdExc = 0;
  // Conversion tax withheld from the conversion's own Trad pull when Cash + Taxable +
  // RMD-excess can't cover the marginal ordinary tax. The Roth deposit shrinks
  // by this amount; the Trad pull stays at the requested conversion gross.
  let convTaxWithheld = 0;
  // Per-owner split of the withheld portion. Each owner's Roth deposit shrinks
  // by their proportional share (IRS reality: each owner's 1099-R is independent).
  let convTaxWithheldSelf = 0;
  let convTaxWithheldSpouse = 0;

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
    // Priority 0: Cash. Drains before any tax-generating source — cash withdrawals
    // are tax-free principal, so consuming them first avoids unnecessary LTCG/
    // NIIT churn and conversion-tax amplification.
    // Phase 2: bucket policy clamps the cash pull to (cashBal - minCashFloor).
    // When cash is already at/below the floor, spending falls through to Taxable.
    const cashAvailableForSpending = Math.max(0, cashBal - minCashFloor);
    const spendingFromCash = Math.min(w, cashAvailableForSpending);
    let remaining = w - spendingFromCash;

    const rmdSpendingPull = Math.min(remaining, rmdRequired, tradBal);
    remaining -= rmdSpendingPull;

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
    const ft = Math.min(remaining, brokerageBal);
    remaining -= ft;
    const tradAboveHeadroom = Math.max(0, tradBal - rmdRequired - tradLowBracketPull);
    const spendingFromTradExtra = Math.min(remaining, tradAboveHeadroom);
    remaining -= spendingFromTradExtra;
    const fr = Math.max(0, remaining);
    const sft = rmdSpendingPull + tradLowBracketPull + spendingFromTradExtra;
    const forcedTrad = Math.min(Math.max(sft, rmdRequired), tradBal);
    const rmdExc = Math.max(0, forcedTrad - sft);
    return {
      spendingFromCash,
      spendingFromBrokerage: ft,
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
      ltcgFromBrokerage: ltcgVal,
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

    // Conversion principal capped PER OWNER by their own Trad balance after
    // their own RMD (IRS rules: (a) RMD is not eligible for conversion;
    // (b) a conversion moves money from the owner's Trad to that same owner's
    // Roth — Spouse's Trad cannot fund Self's conversion). The aggregate
    // `tradAvailForConv` is the sum of per-owner caps but is only used for
    // monitoring; the binding constraint is the per-owner cap.
    const tradAvailForConvSelf   = Math.max(0, selfTradBal   - selfRmd);
    const tradAvailForConvSpouse = Math.max(0, spouseTradBal - spouseRmd);
    const convCandidateSelf   = Math.min(conversionGrossSelf,   tradAvailForConvSelf);
    const convCandidateSpouse = Math.min(conversionGrossSpouse, tradAvailForConvSpouse);
    let convCandidate = convCandidateSelf + convCandidateSpouse;

    // Baseline ordinary tax (no conversion) at the current spending waterfall.
    const baseTax = computeOrdinaryTaxFor(sw.forcedTrad, sw.spendingFromBrokerage);

    const marginalOrdTax = (rc: number): number => {
      if (rc <= 0) return 0;
      const r = computeOrdinaryTaxFor(sw.forcedTrad + rc, sw.spendingFromBrokerage);
      return Math.max(0, r.ordinaryTax - baseTax.ordinaryTax);
    };

    // Conversion ordinary tax is funded in priority order:
    //   1. Cash balance not consumed by spending (preferred — tax-free principal,
    //      avoids LTCG/NIIT amplification on Taxable pulls)
    //   2. RMD-excess cash (already pulled from Trad as part of forcedTrad; using
    //      it for conv tax costs nothing extra)
    //   3. Taxable balance not consumed by spending (realizes LTCG/NIIT)
    //   4. Withheld from the conversion itself (IRS Form 1099-R Box 4 mechanic) —
    //      Trad pull still equals convCandidate, but the Roth deposit shrinks by
    //      the withheld amount. This is mathematically suboptimal vs. paying from
    //      Taxable (gives up some of the conversion's arbitrage) but always lets
    //      the conversion execute. The dialog surfaces a warning when withholding
    //      is non-zero.
    // Conversion tax is NEVER pulled from Trad-above-RMD or Roth — that's the
    // phantom-tax leak the prior PR fixed.
    const mt = marginalOrdTax(convCandidate);
    // Conv-tax sourcing also respects the cash bucket floor — Cash above the
    // floor is the only portion available for conversion tax. When cash is at/
    // below the floor (e.g., after a hefty spendingFromCash that drained it),
    // ctCash = 0 and the chain falls through to RMD-excess → Taxable → withheld.
    const cashRemainingForConvTax = Math.max(0, cashBal - sw.spendingFromCash - minCashFloor);
    const ctCash = Math.min(mt, cashRemainingForConvTax);
    const ctRmd = Math.min(mt - ctCash, sw.rmdExc);
    const brokerageRemainingForConvTax = Math.max(0, brokerageBal - sw.spendingFromBrokerage);
    const ctBrokerage = Math.min(mt - ctCash - ctRmd, brokerageRemainingForConvTax);
    const ctWithheld = Math.max(0, mt - ctCash - ctRmd - ctBrokerage);

    // Final per-account flows for this iteration. Trad pull is the full
    // convCandidate; the Roth deposit (applied in applyCashFlow) subtracts
    // ctWithheld from rothConversionGross.
    fromCash = sw.spendingFromCash + ctCash;
    fromBrokerage = sw.spendingFromBrokerage + ctBrokerage;
    fromTrad = sw.forcedTrad + convCandidate;
    fromRoth = sw.spendingFromRoth;
    rothConversion = convCandidate;
    rothConversionSelf   = convCandidateSelf;
    rothConversionSpouse = convCandidateSpouse;
    convTaxFromCash = ctCash;
    convTaxFromBrokerage = ctBrokerage;
    convTaxFromRmdExc = ctRmd;
    convTaxWithheld = ctWithheld;
    // Per-owner withholding splits proportionally to each owner's conv share.
    // IRS reality: each owner's 1099-R is independent; combined withholding
    // sums. When only one owner has a conversion, all withholding lands there.
    convTaxWithheldSelf   = convCandidate > 0 ? ctWithheld * (convCandidateSelf   / convCandidate) : 0;
    convTaxWithheldSpouse = ctWithheld - convTaxWithheldSelf;
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
      ltcgFromBrokerage: fromBrokerage,
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
    if (userData.useStackedLtcgBrackets) {
      // Stacked 0/15/20%: gains sit on top of ordinary taxable income. Use the
      // after-deduction ordinary taxable as the stack height (combinedTaxable is
      // the pre-deduction gross — getFederalTaxableIncome applies the same
      // deduction stack the ordinary-tax path uses).
      const ordinaryTaxable = getFederalTaxableIncome(
        combinedTaxable, userData.filingStatus, age, year, spouseAge, inflationRate,
      );
      federalCapGainsTax = computeFederalLTCGTax(
        ordinaryTaxable, fromBrokerage, userData.filingStatus, year, inflationRate,
      );
    } else {
      federalCapGainsTax = fromBrokerage * ltcgRate;
    }
    if (niitEnabled) {
      const magi = ordinaryGross + ssTaxableAmount + fromBrokerage;
      // NIIT investment-income proxy includes both taxable-account gross withdrawals
      // (federal LTCG proxy) AND cash interest (MMF/HYSA interest is investment
      // income per IRC §1411). Without `+ cashInterest`, cash-heavy retirees over
      // the NIIT threshold are under-taxed. The interest is also in `ordinaryGross`
      // (it's ordinary income for federal tax purposes), but its inclusion in the
      // NIIT *base* is separate from the ordinary-income inclusion.
      niitTax = calculateNIIT(magi, fromBrokerage + cashInterest, userData.filingStatus);
    } else {
      niitTax = 0;
    }
    totalTax = ordinaryTax + federalCapGainsTax + stateCapGainsTax + niitTax + irmaaSurcharge;

    // Spending withdrawal sized to cover spending + tax − availableCash − (conv
    // tax funded separately). `mt` (conv ordinary tax) is paid from Cash + Taxable +
    // rmdExc, so the spending pull doesn't need to cover it.
    const uncappedNewWithdrawal = Math.max(0, totalSpendingNet + totalTax - availableCash - mt);
    const newWithdrawal = Math.min(uncappedNewWithdrawal, cap);
    capWasBinding = uncappedNewWithdrawal > cap;

    // Convergence tolerance: $0.01 absolute floor, scaled up for very large
    // withdrawals by a 1e-9 relative term. On normal portfolios the floor
    // dominates (1e-9 × w < 0.01 until w > $10M), so results are bit-identical
    // to the old absolute-only check. On $10M+ withdrawals, where one fixed-point
    // step can't shrink below $0.01 due to float granularity, the relative term
    // lets the loop terminate instead of burning all iterations and warning.
    // (Deliberately NOT a pure relative epsilon, which would loosen every normal
    // scenario and force re-baselining the hand-verified expected files.)
    const convergenceTol = Math.max(0.01, Math.abs(newWithdrawal) * 1e-9);
    if (Math.abs(newWithdrawal - withdrawal) < convergenceTol) {
      withdrawal = newWithdrawal;
      break;
    }
    // E2: telemetry. Normal scenarios converge in 3–5 iterations. If we hit
    // the cap with a non-trivial delta, surface it so future regressions
    // (e.g. an oscillating fixed-point introduced by a new tax interaction)
    // don't pass silently.
    if (iter === MAX_ITERATIONS - 1) {
      const delta = Math.abs(newWithdrawal - withdrawal);
      // eslint-disable-next-line no-console
      console.warn(
        `[SimulationService] tax fixed-point did not converge in ${MAX_ITERATIONS} ` +
        `iterations (year ${year}, age ${age}, residual delta=$${delta.toFixed(2)}). ` +
        `Using last value.`,
      );
    }
    withdrawal = newWithdrawal;
  }

  // Conversion ordinary tax (mt) is funded from Cash + Taxable + RMD-excess, not
  // from the spending withdrawal. So neither the surplus calc nor the spendingShortfall
  // should attribute mt to the spending-side cash gap.
  const mtFinal = convTaxFromCash + convTaxFromBrokerage + convTaxFromRmdExc;
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

  // ---- Tax Audit intermediates ----
  // Gated by includeAudit. These five detailed* calls + the audit object literal
  // are the dominant per-iteration allocation/work in the MC hot loop. Stat-only
  // runs (4997 of 5000) skip this; representative paths are replayed with
  // includeAudit=true so the Tax Audit UI still sees full detail.
  let audit: AnnualAuditBreakdown | undefined;
  if (includeAudit) {
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
    const niitMagiFinal = ordinaryGrossFinal + ssTaxableAmount + fromBrokerage;
    const niitDetail = niitEnabled
      ? calculateNIITDetailed(niitMagiFinal, fromBrokerage + cashInterest, userData.filingStatus)
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
      rothConversionTotalSelf:   rothConversionSelf,
      rothConversionTotalSpouse: rothConversionSpouse,
      filingStatus: userData.filingStatus,
      stateEffectiveRate: stateEffectiveRateOnFederalTaxable,
      age,
      taxYear: year,
      spouseAge,
      inflationRate,
    });
    audit = {
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
  }

  // Initial capture of cash ending balance — after this year's spending pull
  // but BEFORE any bucket-policy refill/sweep. Phase 2's
  // applyPostConvergenceBucketPolicy step overwrites this value via a fresh
  // re-walk of cash account balances when a policy is active (see the post-
  // convergence block in simulateOneRun). Consumers that read this field
  // directly therefore see the post-routing balance when a policy ran, and
  // this initial value otherwise.
  const cashEndingBalance = Math.max(0, cashBal - fromCash);

  return {
    ssGross,
    otherTaxableGross,
    afterTaxIncome,
    totalGrossIncome,
    ssTaxableAmount,
    baseSpendingNet: spending.baseSpendingNet,
    otherSpendingGoalsNet: spending.otherSpendingGoalsNet,
    totalSpendingNet,
    // portfolioWithdrawal is the *taxable*-impact withdrawal (LTCG/ordinary/Roth
    // sources); cash principal is tax-free, so we keep it out of this total to
    // preserve the field's "tax-relevant withdrawal" semantics. Use cashEndingBalance
    // / withdrawalFromCash to surface cash movement separately.
    portfolioWithdrawal: fromBrokerage + fromTrad + fromRoth,
    withdrawalFromBrokerage: fromBrokerage,
    withdrawalFromTraditional: fromTrad,
    withdrawalFromRoth: fromRoth,
    withdrawalFromCash: fromCash,
    cashInterest,
    cashEndingBalance,
    // Phase 2 post-convergence fields. Initialized to 0 here; populated by
    // applyPostConvergenceBucketPolicy AFTER applyCashFlow runs. The structural
    // isolation of that step (no access to tax functions) is what makes the
    // "post-convergence step never mutates tax fields" invariant a type-level
    // guarantee — see plan §"Structural enforcement of the post-convergence
    // invariant".
    cashRefillFromSurplus: 0,
    cashSweepToBrokerage: 0,
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
    rothConversionTaxFromCash: convTaxFromCash,
    rothConversionTaxFromBrokerage: convTaxFromBrokerage,
    rothConversionTaxFromRmdExcess: convTaxFromRmdExc,
    rothConversionTaxWithheld: convTaxWithheld,
    rothConversionGrossSelf:        rothConversionSelf,
    rothConversionGrossSpouse:      rothConversionSpouse,
    rothConversionTaxWithheldSelf:  convTaxWithheldSelf,
    rothConversionTaxWithheldSpouse: convTaxWithheldSpouse,
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
  return b.otherTaxableGross + b.withdrawalFromTraditional + b.ssTaxableAmount + b.withdrawalFromBrokerage;
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
   *  the resolved spending policy is `'bracket_aware'`. Zero when no headroom
   *  (high-bracket years) or when the policy is `'brokerage_first'`. */
  bracketHeadroomForTradByYear: number[];
  /** Resolved spending-source strategy for the scenario. Computed once via
   *  `selectBestSpendingOrder` so each MC run doesn't re-scan
   *  `incomeEvents`. */
  spendingOrder: ResolvedSpendingOrder;
  /** Per-year portfolio balance from the deterministic projection (nominal $).
   *  Populated only when `cashBucketPolicy.refillTrigger === 'above_baseline'` —
   *  used by the post-convergence step's trigger check. Undefined otherwise to
   *  avoid the cost of a deterministic projection for scenarios that don't
   *  need it. */
  deterministicBaselineByYear?: number[];
}

export type ResolvedSpendingOrder = 'brokerage_first' | 'bracket_aware';

/**
 * Pick the better spending-source strategy for this scenario by running a
 * quick deterministic projection with each candidate and comparing real
 * terminal portfolio balances.
 *
 * **Why auto-select**: `bracket_aware` is not always better than
 * `brokerage_first`. It depends on the scenario:
 *  - Pre-SS retiree with low spending and a balanced Trad/Brokerage split →
 *    brokerage_first wins (LTCG sits in 0% federal bracket; Trad pulls
 *    needlessly trigger 10–12% federal).
 *  - Pre-SS retiree with high spending or a heavy Trad balance →
 *    bracket_aware wins (spending pushes LTCG into 15% bracket; filling
 *    12% Trad headroom is cheaper).
 *
 * Previously the engine gated the choice on conversion-event presence —
 * surprisingly user-hostile (adding a $1 placeholder conversion could
 * unlock hundreds of $K of benefit). Auto-selection removes that gating
 * and the implicit user-trigger requirement.
 *
 * Cost: two deterministic projections, ~10–20 ms total at sim setup
 * (and once per generator-candidate inside the Roth wizard). Run once
 * per `runSimulation` / `runDeterministicProjection` entry; the result
 * is cached in `Precomputes.spendingOrder` so the MC inner loop never
 * re-selects.
 *
 * Tiebreaker on exact score equality: `brokerage_first` (conservative —
 * preserves Traditional balance for later flexibility).
 */
export function selectBestSpendingOrder(userData: UserData): ResolvedSpendingOrder {
  // The inner projections pass `_forceSpendingOrder` so they skip
  // re-running this selector (recursion guard).
  const brokerageResult = runDeterministicProjection(userData, { _forceSpendingOrder: 'brokerage_first' });
  const bracketResult = runDeterministicProjection(userData, { _forceSpendingOrder: 'bracket_aware' });
  const brokerageScore = brokerageResult.path[brokerageResult.path.length - 1] ?? 0;
  const bracketScore = bracketResult.path[bracketResult.path.length - 1] ?? 0;
  // Prefer brokerage_first unless bracket_aware shows a MEANINGFUL improvement.
  // The tiebreaker tolerance is the larger of $100 absolute and 0.05% relative
  // (= $500 on a $1M portfolio, $5K on $10M). Three reasons for the wider
  // floor than a naive epsilon:
  //   1. Zero-spending scenarios still produce small REAL differences (~$500–
  //      $1500 of Trad pull from the bracket-aware LTCG-cascade refeed), big
  //      enough to defeat a 1e-6 tolerance on high-balance scenarios. The
  //      policies are operationally equivalent for the user's intent in
  //      those cases — we don't want to flip to bracket_aware over noise.
  //   2. For meaningful policy wins (the bracket_aware-dominant high-spending
  //      retiree case), the delta is hundreds of thousands of dollars over a
  //      30-year horizon — orders of magnitude above this floor.
  //   3. The conservative default (brokerage_first) preserves Traditional for
  //      future flexibility, which has option value the deterministic
  //      terminal score doesn't capture.
  const tieTol = Math.max(100, Math.abs(brokerageScore) * 5e-4);
  return bracketScore - brokerageScore > tieTol ? 'bracket_aware' : 'brokerage_first';
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
  blackSwanLookup: Map<number, { stockMultiplier: number; bondMultiplier: number }>,
  // false for the 4997 stat-only MC runs; true for representative paths
  // (median/downside/nominal) so the Tax Audit UI gets full per-year detail.
  includeAudit: boolean = true
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
    // The federal tax cache key includes taxYear, so cross-year hits are
    // impossible by construction. The cache only helps within a single year's
    // fixed-point loop (3–5 iterations on the same year/age key). Clearing
    // per-year keeps the cache bounded (~50 entries) instead of growing to
    // millions of dead entries across 5000 runs × 30 years.
    clearTaxCalculationCache();
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
    //    Cash accounts BYPASS the stochastic shock + black-swan overlay entirely
    //    and instead accrue a deterministic yield. Cash is non-volatile by
    //    construction in this model — see CLAUDE.md "Cash accounts" and the
    //    growth-bypass test scenarios. We capture `cashInterest` (the dollar
    //    amount credited this year, on the beginning-of-year cash balance) and
    //    thread it into calculateAnnualCashFlowCore as ordinary income.
    const base = generator.drawFactors(runIndex, i, random);
    const { stockFactor: sf, bondFactor: bf } = applyBlackSwan(base, year, blackSwanLookup);
    stockFactors.push(sf);
    bondFactors.push(bf);
    const cashYieldRate = userData.portfolioAssumptions.cashYieldRate ?? 0.04;
    let cashInterest = 0;
    for (const id in balances) {
      if (accountIndex.isCashById.get(id) === true) {
        // Cash: deterministic yield, no market factor, no black-swan.
        const interest = balances[id] * cashYieldRate;
        cashInterest += interest;
        balances[id] = balances[id] + interest;
      } else {
        const sa = accountIndex.allocationById.get(id) ?? 0.6; // fallback for synthetic accounts
        balances[id] *= sa * sf + (1 - sa) * bf;
      }
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
      spendingOrder, precomputes.bracketHeadroomForTradByYear[i], includeAudit, cashInterest,
    );
    breakdowns.push(effectiveCashFlow);

    if (effectiveCashFlow.spendingShortfall > 0) {
      if (!failed) failedYear = i;
      failed = true;
    }

    applyCashFlow(accountIndex, effectiveCashFlow, yearIncome.contributions, balances, includeAudit);
    // Clamp against float drift BEFORE the post-convergence step so its sweep
    // and refill arithmetic operate on clean non-negative balances. Without
    // this clamp here, a sub-cent negative Taxable balance from
    // subtractFromAccounts's proportional split could feed into the bucket
    // policy and produce phantom dollars in the sweep destination. The
    // bottom-of-loop clamp below is kept as a final safety net (cheap,
    // catches any drift introduced by the post-convergence step itself).
    for (const id in balances) if (balances[id] < 0) balances[id] = 0;

    // Phase 2: post-convergence cash bucket policy. Runs AFTER applyCashFlow
    // has settled all flows for the year. The function's signature deliberately
    // withholds tax fields and tax modules so it cannot mutate the converged
    // tax — see applyPostConvergenceBucketPolicy doc comment for the structural
    // invariant. Capacity check: only runs when the policy is configured.
    if (userData.cashBucketPolicy) {
      const baselineForYear = precomputes.deterministicBaselineByYear?.[i] ?? null;
      // postGrowth was captured just before calculateAnnualCashFlowCore — it's
      // the post-growth, pre-withdrawal portfolio balance, which is the right
      // input for the `above_baseline` trigger (do not include this year's
      // withdrawals in the ratio — bucket-policy decisions key off plan health
      // BEFORE we deplete for the year).
      const routing = applyPostConvergenceBucketPolicy(
        effectiveCashFlow,
        balances,
        userData.cashBucketPolicy,
        accountIndex,
        { stockFactor: sf, portfolioPostGrowth: postGrowth, deterministicBaseline: baselineForYear },
      );
      effectiveCashFlow.cashRefillFromSurplus = routing.cashRefillFromSurplus;
      effectiveCashFlow.cashSweepToBrokerage = routing.cashSweepToBrokerage;
      // cashEndingBalance was captured inside calculateAnnualCashFlowCore before
      // applyCashFlow ran (and so before refill/sweep). Recompute it now to
      // reflect the post-routing state — this is the value users see in the CSV
      // and detail rows.
      let postRoutingCashBal = 0;
      for (const a of accountIndex.byType.cash) postRoutingCashBal += balances[a.id] ?? 0;
      effectiveCashFlow.cashEndingBalance = postRoutingCashBal;
    }
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

// Re-execute a representative SimRun with audit data populated. The original
// stat-only run captured per-year stockFactors/bondFactors and cumulative
// inflation; we feed those back through simulateOneRun via a deterministic
// replay generator so the resulting path is bit-identical to the original
// but now includes AnnualAuditBreakdown per year. Cost: ~3 extra runs total
// (median, downside, nominal) — overhead vs the 4997 audit-stripped runs is
// negligible, while the savings from skipping audit on those 4997 is the
// dominant performance win.
export function replayRunWithAudit(
  saved: SimRun,
  userData: UserData,
  precomputes: Precomputes,
  accountIndex: AccountIndex,
  _blackSwanLookup: Map<number, { stockMultiplier: number; bondMultiplier: number }>,
): SimRun {
  const totalYears = saved.path.length;
  // Derive per-year inflation rates from the captured cumulative-inflation
  // series. The original loop draws inflation at year-end (after pushing the
  // year's breakdown) so the last draw is consumed but never stored; the
  // replay returns 0 for that slot — irrelevant because cumulativeInflation
  // updates after the final year's breakdown are never read.
  const yearInfRates = new Array<number>(totalYears);
  for (let i = 0; i < totalYears - 1; i++) {
    yearInfRates[i] = saved.inflation[i + 1] / saved.inflation[i] - 1;
  }
  yearInfRates[totalYears - 1] = 0;
  const replayGenerator: ReturnGenerator = {
    getNumRuns: () => 1,
    drawFactors: (_r, y) => ({
      stockFactor: saved.stockFactors[y],
      bondFactor: saved.bondFactors[y],
    }),
    drawInflation: (_r, y) => yearInfRates[y],
  };
  // Random fn is unused by replayGenerator; pass a noop. applyBlackSwan is
  // already baked into the saved factors, but simulateOneRun reapplies it —
  // pass an empty lookup so we don't double-apply. (Saved factors are the
  // post-overlay result of base × multiplier.)
  return simulateOneRun(
    userData, precomputes, accountIndex, replayGenerator, 0,
    () => 0,
    new Map(),
    true,
  );
}

export interface SimulationResult {
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
  // True for results from runFastPreview (deterministic-only synth) so the UI
  // can show a "computing…" indicator while the full MC is in flight. Absent
  // / false on real runSimulation output.
  isPreview?: boolean;
}

// Wraps `rawUserData` with the synthetic Reinvestment / Roth Conversion accounts
// that the engine requires. Exported so the SimulationClient can apply this once
// on the main thread before fanning out to workers — otherwise each worker would
// inject independently and synthetic account ids could diverge.
export function prepareUserData(rawUserData: UserData): UserData {
  // Tax-strategy resolution previously happened here (Layer 3 framework, now
  // removed). All Roth conversions are first-class income events on the
  // scenario; legacy `taxStrategy.cachedVector` is migrated to events on load.
  // Synthetic-account creation order matters: ensureCashAccount runs first so
  // that ensureReinvestmentAccount sees the cash account and the
  // synthetic-account selection rule (Cash if policy, else Reinvestment-Taxable)
  // is consistent. ensureReinvestmentAccount still runs because surplus
  // deposits land in Taxable initially even under bucket policy — the post-
  // convergence step then sweeps from Taxable into Cash up to target.
  return ensureRothConversionAccount(
    ensureReinvestmentAccount(
      ensureCashAccount(rawUserData)
    )
  );
}

// Derives the effective number of MC runs without instantiating a ReturnGenerator
// (the bootstrap generator consumes the RNG at construction). Mirrors the
// per-model logic in `createReturnGenerator` + each generator's `getNumRuns()`.
// Exported so the SimulationClient can decide inline-vs-pool dispatch.
export function getEffectiveNumRuns(userData: UserData): number {
  const pa = userData.portfolioAssumptions;
  const model = pa.returnModel ?? 'parametric';
  if (model === 'historical_single') return 1;
  if (model === 'historical_rolling') {
    const wrap = pa.historicalWrapEnabled ?? false;
    const horizon = userData.lifeExpectancy - userData.currentAge + 1;
    return wrap ? HISTORICAL_YEARS : Math.max(1, HISTORICAL_YEARS - horizon + 1);
  }
  // parametric, historical_bootstrap
  return userData.simulationSettings.numSimulations;
}

// Builds the per-year precompute table consumed by `simulateOneRun`. Pure and
// independent of RNG. Exported so the SimulationClient / Web Worker can build
// precomputes inside the worker context (where it's used to thread the same
// shared inputs into the MC loop without re-deriving per run).
export function buildPrecomputes(
  userData: UserData,
  options?: {
    /** Recursion-breaker for the inner deterministic-baseline run. When true,
     *  skips the baseline computation even if the policy would request it.
     *  Internal use only — `runDeterministicProjection` passes this so the
     *  baseline pass doesn't try to compute its own baseline. */
    skipBaselineForDeterministic?: boolean;
    /** Recursion-breaker for `selectBestSpendingOrder`. When set, the engine
     *  uses this spending policy directly instead of running auto-selection.
     *  The selector itself uses this to pin each candidate without recursing
     *  back into the selector. Unit tests use it to isolate behavior under
     *  a specific policy. Not exposed via UserData. */
    _forceSpendingOrder?: ResolvedSpendingOrder;
  }
): Precomputes {
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
  const resolvedSpendingOrder: ResolvedSpendingOrder =
    options?._forceSpendingOrder ?? selectBestSpendingOrder(userData);
  for (let i = 0; i < totalYears; i++) {
    const year = currentYear + i;
    const sn = getEffectiveStateName(userData, year);
    const resolved = getStateTaxProfile(sn, year);
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

  // Deterministic baseline precompute for the `above_baseline` refill trigger.
  // Computed only when needed. Runs a one-shot deterministic projection with the
  // skipBaselineForDeterministic option so the inner buildPrecomputes call does
  // NOT recurse on its own baseline. We also pin the resolved spending policy
  // via `_forceSpendingOrder` so the inner projection skips
  // `selectBestSpendingOrder` — without this, the selector would fire on the
  // inner call, run its own two projections, EACH of which would re-enter this
  // baseline branch and infinitely recurse.
  let deterministicBaselineByYear: number[] | undefined;
  if (
    !options?.skipBaselineForDeterministic
    && userData.cashBucketPolicy?.refillTrigger === 'above_baseline'
  ) {
    const detResult = runDeterministicProjection(userData, {
      skipBaselineForDeterministic: true,
      _forceSpendingOrder: resolvedSpendingOrder,
    });
    deterministicBaselineByYear = detResult.path;
  }

  return {
    stateResolvedKeyByYear, stateProfileByYear, ageByYear, spouseAgeByYear, incomeByYear, spendingByYear,
    bracketHeadroomForTradByYear, spendingOrder: resolvedSpendingOrder,
    deterministicBaselineByYear,
  };
}

/**
 * EXECUTED IN BOTH THE MAIN THREAD AND IN A WEB WORKER.
 * - No DOM access. No module-level mutation outside the per-year
 *   taxCalculationCache (which is already worker-local and cleared per year
 *   inside simulateOneRun).
 * - All inputs come through the parameters; userData/precomputes are
 *   treated as read-only.
 * - Future changes here must preserve this dual-context purity.
 *
 * Builds its own AccountIndex / ReturnGenerator / BlackSwanLookup from
 * userData. For inline (shardCount=1) callers, the resulting RNG-consumption
 * order matches today's `runSimulation` body bit-for-bit (the bootstrap
 * generator's index-map construction happens at the same logical point).
 *
 * Returns a `SimRun[]` of length `endRunIndex - startRunIndex`, one entry per
 * run in the slice. Runs carry no audit by default (representative runs are
 * replayed with `replayRunWithAudit` afterward).
 */
export function runShard(
  userData: UserData,
  precomputes: Precomputes,
  opts: {
    startRunIndex: number;
    endRunIndex: number;
    random?: () => number;
    /** Optional pre-built indexes. When the caller is `runSimulation` (inline
     *  path) it already builds these for the representative-replay step; pass
     *  them in to avoid rebuilding from scratch here. Workers don't pass
     *  them — they receive serialized userData and rebuild fresh. */
    accountIndex?: AccountIndex;
    blackSwanLookup?: Map<number, { stockMultiplier: number; bondMultiplier: number }>;
  }
): SimRun[] {
  const random = opts.random ?? Math.random;
  const accountIndex = opts.accountIndex ?? buildAccountIndex(userData);
  const generator = createReturnGenerator(userData, random);
  const blackSwanLookup = opts.blackSwanLookup ?? buildBlackSwanLookup(userData);
  const out: SimRun[] = new Array(opts.endRunIndex - opts.startRunIndex);
  for (let r = opts.startRunIndex; r < opts.endRunIndex; r++) {
    out[r - opts.startRunIndex] = simulateOneRun(
      userData, precomputes, accountIndex, generator, r, random, blackSwanLookup, false
    );
  }
  return out;
}

// Pick the median (50th percentile) and downside (10th percentile) representative
// runs by score: failed runs sort by earliest `failedYear`; survivors by final balance.
// The score formula (`failed ? failedYear : totalYears + finalBalance`) ensures failed
// runs always sort before any survivor.
export function pickRepresentatives(allRuns: SimRun[]): { medianRun: SimRun; downsideRun: SimRun } {
  const totalYears = allRuns[0].path.length;
  const sorted = [...allRuns].sort((a, b) => {
    const scoreA = a.failed ? a.failedYear : totalYears + a.path[totalYears - 1];
    const scoreB = b.failed ? b.failedYear : totalYears + b.path[totalYears - 1];
    return scoreA - scoreB;
  });
  const numRuns = allRuns.length;
  return {
    medianRun: sorted[Math.floor(numRuns * 0.5)],
    downsideRun: sorted[Math.floor(numRuns * 0.1)],
  };
}

// Year-by-year percentile envelope (10th/90th) + ending-balance / depletion stats.
// Returns nulls when fewer than 10 runs (e.g. historical_single's single deterministic walk).
export function computePercentileBandAndStats(
  allRuns: SimRun[],
  totalYears: number,
  currentAge: number,
): { percentileBand: PercentileBand | null; mcStats: McStats | null } {
  const numRuns = allRuns.length;
  if (numRuns < 10) return { percentileBand: null, mcStats: null };
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
  const percentileBand: PercentileBand = { p10, p90 };

  const finals = new Array<number>(numRuns);
  for (let r = 0; r < numRuns; r++) finals[r] = allRuns[r].path[totalYears - 1];
  finals.sort((a, b) => a - b);

  const depletionYears = new Array<number>(numRuns);
  for (let r = 0; r < numRuns; r++) {
    depletionYears[r] = allRuns[r].failed ? allRuns[r].failedYear : Infinity;
  }
  depletionYears.sort((a, b) => a - b);
  const medianDepYear = depletionYears[p50Idx];
  const worstDecileDepYear = depletionYears[p10Idx];

  const mcStats: McStats = {
    medianEndingBalance: finals[p50Idx],
    p10EndingBalance: finals[p10Idx],
    medianDepletionAge: Number.isFinite(medianDepYear) ? currentAge + medianDepYear : null,
    worstDecileDepletionAge: Number.isFinite(worstDecileDepYear) ? currentAge + worstDecileDepYear : null,
  };
  return { percentileBand, mcStats };
}

export function runSimulation(
  rawUserData: UserData,
  random: () => number = Math.random
): SimulationResult {
  // Tax cache key is per-(taxable, status, age, year, ...) — across a 5000-run MC
  // the cache fills with millions of pathologically-unique entries that mostly never
  // hit. Clear at the top of each simulation so cache hits come only from the
  // fixed-point loop iterating the same combinedTaxable ± delta within one year.
  clearTaxCalculationCache();
  const userData = prepareUserData(rawUserData);
  const currentYear = userData.referenceYear;
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;

  const precomputes = buildPrecomputes(userData);
  const numRuns = getEffectiveNumRuns(userData);

  // Build indexes once and pass to BOTH the MC shard and the post-MC replay.
  // (Previously runShard rebuilt them internally and we rebuilt them again here
  // for the replay — same family of "double-call in a pipeline" pattern as the
  // prepareUserData fingerprint bug. Pure functions, so no correctness issue,
  // but wasteful and inconsistent.) Workers spawn their own runShard with no
  // pre-built indexes — they receive serialized userData and rebuild fresh.
  const accountIndex = buildAccountIndex(userData);
  const blackSwanLookup = buildBlackSwanLookup(userData);

  // Inline single-shard MC. Bit-exact preservation: runShard's internal generator
  // construction (which may consume RNG for the bootstrap indexMap) happens at the
  // same logical point as today's pre-loop setup, and the per-run RNG consumption
  // order is identical.
  const allRuns = runShard(userData, precomputes, {
    startRunIndex: 0, endRunIndex: numRuns, random,
    accountIndex, blackSwanLookup,
  });

  let successCount = 0;
  for (let r = 0; r < numRuns; r++) if (!allRuns[r].failed) successCount++;
  const probability = Math.round((successCount / numRuns) * 100);

  // Replay representative runs with audit. Replay is data-replay (uses recorded
  // factors on the SimRun), not RNG-replay — so it does not advance `random`.
  const { medianRun: medianSeed, downsideRun: downsideSeed } = pickRepresentatives(allRuns);
  const medianRun = replayRunWithAudit(medianSeed, userData, precomputes, accountIndex, blackSwanLookup);
  const downsideRun = replayRunWithAudit(downsideSeed, userData, precomputes, accountIndex, blackSwanLookup);

  const { percentileBand, mcStats } = computePercentileBandAndStats(allRuns, totalYears, userData.currentAge);

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
export function runDeterministicProjection(
  rawUserData: UserData,
  options?: {
    /** Internal flag used by the cash-bucket baseline-precompute pass to break
     *  the recursion: buildPrecomputes(userData) wants the deterministic
     *  baseline → runs runDeterministicProjection(userData) which calls
     *  buildPrecomputes again. When this flag is set, the inner buildPrecomputes
     *  skips its baseline computation. Result: above_baseline triggers in the
     *  deterministic run will never fire (since baseline=undefined), which is
     *  the right semantic — the baseline run is the reference, not a follower. */
    skipBaselineForDeterministic?: boolean;
    /** Recursion-breaker for `selectBestSpendingOrder`. When set, the engine
     *  uses this spending policy directly instead of running auto-selection.
     *  See `buildPrecomputes` for the full rationale. */
    _forceSpendingOrder?: ResolvedSpendingOrder;
  }
): {
  path: number[];
  breakdowns: AnnualCashFlowBreakdown[];
  inflation: number[];
  years: number[];
} {
  clearTaxCalculationCache();
  const userData = prepareUserData(rawUserData);
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1;
  const precomputes = buildPrecomputes(userData, options);
  const accountIndex = buildAccountIndex(userData);
  const blackSwanLookup = buildBlackSwanLookup(userData);
  const nominalGenerator = createNominalGenerator(userData);
  const run = simulateOneRun(
    userData, precomputes, accountIndex, nominalGenerator, 0, Math.random, blackSwanLookup
  );
  const years = Array.from({ length: totalYears }, (_, i) => userData.referenceYear + i);
  return { path: run.path, breakdowns: run.breakdowns, inflation: run.inflation, years };
}

// Fast deterministic preview shaped like a full SimulationResult. Used by the
// UI to paint the chart's primary (Projected) line immediately while the full
// Monte Carlo runs in the background. percentileBand and mcStats are null —
// chart already null-guards both. `cachedProbability` is plumbed in from the
// caller (Scenario.lastSuccessProbability) so the engine itself stays
// independent of that sidebar-only display value.
// Median/downside fields mirror the deterministic line; the View selector
// stays functional but flips to the real MC paths once runSimulation finishes.
export function runFastPreview(rawUserData: UserData, cachedProbability?: number): SimulationResult {
  const det = runDeterministicProjection(rawUserData);
  return {
    probability: cachedProbability ?? 0,
    nominal: det.path,
    nominalBreakdowns: det.breakdowns,
    nominalInflation: det.inflation,
    median: det.path,
    medianBreakdowns: det.breakdowns,
    medianInflation: det.inflation,
    medianStockFactors: [],
    medianBondFactors: [],
    downside: det.path,
    downsideBreakdowns: det.breakdowns,
    downsideInflation: det.inflation,
    downsideStockFactors: [],
    downsideBondFactors: [],
    years: det.years,
    percentileBand: null,
    mcStats: null,
    isPreview: true,
  };
}
