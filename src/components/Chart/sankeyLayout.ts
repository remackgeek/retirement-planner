import type {
  AccountFlowRow,
  AnnualCashFlowBreakdown,
  IncomeEventTaxAttribution,
} from '../../services/SimulationService';
import type { IncomeEventType } from '../../types/IncomeEvent';
import { toDisplay, type DisplayCurrency } from '../../utils/displayCurrency';

/**
 * Per-year cash-flow Sankey model (v3 — column-0 detail + tax-treatment buckets).
 *
 * Topology: up to 5 columns.
 *   Column 0 — Detailed sources (NEW). Per-income-event and per-account nodes
 *              upstream of aggregator nodes. Emitted from
 *              `audit.incomeEventTaxBreakdown` (per-event for wage/other,
 *              SS, conversion) and `audit.accountFlows` (per-account for
 *              brokerage / cash / Roth withdrawals).
 *   Column 1 — Aggregator sources. Multi-detail aggregators (Wage & Other,
 *              SS Taxable/Free, Roth Conversion gross, Brokerage/Cash/Roth
 *              Withdrawal). Sources without detail (Cash Interest, RMD,
 *              Traditional, Employer Match, After-Tax Income) keep their
 *              v2 single-node behavior and live at the same visual depth as
 *              column 0 (no detail upstream).
 *   Column 2 — Tax buckets: Ordinary Income, Capital Gains, Tax-Exempt.
 *   Column 3 — After-Tax Cash. Aggregates the residual from each bucket.
 *   Column 4 — Uses. Tax outflows, spending, deposits, surplus.
 *
 * Conservation invariants (each enforced within $1 in dev mode):
 *   - Global: Σ source amounts = Σ use amounts
 *   - Per bucket: bucket_in = bucket_out
 *   - After-Tax Cash: Σ residuals_in = Σ uses_from_ATC
 *   - Per aggregator (when detail children exist): Σ detail edges = aggregator
 *     outflow to its bucket
 *
 * Cash refill/sweep are pure inter-account moves and live OUTSIDE the bucket
 * graph as off-axis transfer links.
 */

export type SankeyNodeKind =
  | 'detail'         // column-0 detail (per-event income, per-account withdrawal)
  | 'income'         // wage/other aggregator, SS aggregators, cash interest, after-tax income
  | 'employer'       // employer match
  | 'withdrawal'     // account-pull aggregators (Trad, RMD, Brokerage, Cash, Roth, conversion-gross)
  | 'bucket_ord'     // Ordinary Income aggregator
  | 'bucket_capgains'// Capital Gains aggregator
  | 'bucket_exempt'  // Tax-Exempt aggregator
  | 'cashpool'       // After-Tax Cash node
  | 'spending'       // living expenses, other goals
  | 'tax'            // federal/state ordinary, LTCG, NIIT, IRMAA
  | 'deposit'        // contributions, RMD-excess, surplus, employer-match deposit, Roth deposit
  | 'transfer';      // cash refill / sweep (off-axis, no bucket involvement)

export interface SankeyNode {
  id: string;
  label: string;
  kind: SankeyNodeKind;
  /** Total flow through this node in display dollars. */
  total: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  kind: 'main' | 'transfer';
}

export interface BucketAudit {
  id: string;
  label: string;
  inflow: number;
  outflow: number;
  diff: number;
}

export interface AggregatorAudit {
  id: string;
  label: string;
  detailSum: number;
  expected: number;
  diff: number;
}

export interface SankeyModel {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Sum of source-side amounts (column 1 outflows to column 2). */
  inflowTotal: number;
  /** Sum of use-side amounts (column 4 inbound). */
  outflowTotal: number;
  /** inflowTotal - outflowTotal. |diff| should be < 1 in display dollars. */
  conservationDiff: number;
  /** Per-bucket conservation audit (for tests + dev-mode warnings). */
  bucketAudits: BucketAudit[];
  /** Per-aggregator conservation audit (only aggregators that have detail children). */
  aggregatorAudits: AggregatorAudit[];
  /** Unmet spending in display dollars (= breakdown.spendingShortfall ∙ d). */
  shortfall: number;
}

// Node IDs reserved for the middle columns.
const BUCKET_ORD = 'bucket_ord';
const BUCKET_CG = 'bucket_capgains';
const BUCKET_EXEMPT = 'bucket_exempt';
const CASHPOOL = 'cashpool';

// Aggregator IDs (column 1). Detail nodes (column 0) point at these.
const AGG_WAGE = 'src_wage';
const AGG_SS_TAXABLE = 'src_ss_taxable';
const AGG_SS_FREE = 'src_ss_free';
const AGG_CONV = 'src_conv';
const AGG_RMD = 'src_rmd';
const AGG_BROKERAGE = 'src_brokerage';
const AGG_CASH = 'src_cash';
const AGG_ROTH = 'src_roth';

interface RawSource {
  id: string;
  label: string;
  kind: SankeyNodeKind;
  amount: number;
  bucket: typeof BUCKET_ORD | typeof BUCKET_CG | typeof BUCKET_EXEMPT;
}

interface RawUse {
  id: string;
  label: string;
  kind: SankeyNodeKind;
  amount: number;
  source: typeof BUCKET_ORD | typeof BUCKET_CG | typeof CASHPOOL;
}

// Income-event types that classify as ordinary income (wage_income + before-tax
// pensions/rentals/annuities/etc.). Used to feed the Wage & Other aggregator.
// The synthetic 'traditional_withdrawal' row is excluded (it's the discretionary
// Trad spending pull — already captured by its own aggregator at column 1).
//
// The array literal is type-checked against IncomeEventType via `satisfies`,
// so a typo (e.g. 'pension' instead of 'pension_income') is a compile error.
// The Set itself is widened to Set<string> so `.has(ev.eventType)` accepts
// the string-typed eventType field on IncomeEventTaxAttribution at the call
// site. The original v3 shipped with 'pension' and 'sale' (and missing
// 'inheritance') because both production and test fixtures agreed on the
// wrong literals — `satisfies` catches that class of bug now.
const ORDINARY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'wage_income',
  'pension_income',
  'rental_income',
  'annuity_income',
  'inheritance',
  'sale_of_property',
  'work_during_retirement',
  'other_income',
] satisfies readonly IncomeEventType[]);

// Per-goal spending sink nodes (column 4). When the audit carries
// spendingGoalBreakdown and the non-living per-goal sum reconciles with
// otherSpendingGoalsNet (within $1 nominal), emit one node per goal
// (`dst_goal_<goalId>`) scaled by the same shortfall factor as the
// aggregates. Otherwise fall back to the single legacy `dst_goals` node so
// old fixtures / audit-less breakdowns keep their v2 shape.
function buildGoalUses(
  breakdown: AnnualCashFlowBreakdown,
  otherActual: number,
  spendScale: number,
): RawUse[] {
  const perGoal = (breakdown.audit?.spendingGoalBreakdown ?? []).filter(
    (g) => g.goalType !== 'living_expenses',
  );
  const perGoalSum = perGoal.reduce((s, g) => s + g.amountNet, 0);
  if (perGoal.length === 0 || Math.abs(perGoalSum - breakdown.otherSpendingGoalsNet) > 1) {
    return [{ id: 'dst_goals', label: 'Other Spending Goals', kind: 'spending', amount: otherActual, source: CASHPOOL }];
  }
  return perGoal.map((g): RawUse => ({
    id: `dst_goal_${g.goalId}`,
    label: g.goalName,
    kind: 'spending',
    amount: g.amountNet * spendScale,
    source: CASHPOOL,
  }));
}

export function buildSankeyModel(
  breakdown: AnnualCashFlowBreakdown,
  pathFactor: number,
  displayCurrency: DisplayCurrency,
): SankeyModel {
  const d = (v: number) => toDisplay(v, pathFactor, displayCurrency);

  // ---- Source classification ----
  const wageGross =
    breakdown.otherTaxableGross + breakdown.preTaxContributions - breakdown.cashInterest;

  const ssTaxable = breakdown.ssTaxableAmount;
  const ssTaxFree = Math.max(0, breakdown.ssGross - breakdown.ssTaxableAmount);

  const trad = breakdown.withdrawalFromTraditional;
  const rmd = breakdown.rmdRequired;
  const convGross = breakdown.rothConversionGross;
  const tradDiscretionary = Math.max(0, trad - rmd - convGross);

  const sources: RawSource[] = [
    { id: AGG_SS_TAXABLE,  label: 'Social Security (Taxable)',  kind: 'income',     amount: ssTaxable,                        bucket: BUCKET_ORD },
    { id: AGG_SS_FREE,     label: 'Social Security (Tax-Free)', kind: 'income',     amount: ssTaxFree,                        bucket: BUCKET_EXEMPT },
    { id: AGG_WAGE,        label: 'Wage & Other Income',        kind: 'income',     amount: wageGross,                        bucket: BUCKET_ORD },
    { id: 'src_aftertax',  label: 'After-Tax Income',           kind: 'income',     amount: breakdown.afterTaxIncome,         bucket: BUCKET_EXEMPT },
    { id: 'src_cashint',   label: 'Cash Interest',              kind: 'income',     amount: breakdown.cashInterest,           bucket: BUCKET_ORD },
    { id: 'src_match',     label: 'Employer Match',             kind: 'employer',   amount: breakdown.employerMatch,          bucket: BUCKET_EXEMPT },
    { id: AGG_RMD,         label: 'RMD',                        kind: 'withdrawal', amount: rmd,                              bucket: BUCKET_ORD },
    { id: 'src_trad',      label: 'Traditional Withdrawal',     kind: 'withdrawal', amount: tradDiscretionary,                bucket: BUCKET_ORD },
    { id: AGG_CONV,        label: 'Roth Conversion (gross)',    kind: 'withdrawal', amount: convGross,                        bucket: BUCKET_ORD },
    { id: AGG_BROKERAGE,   label: 'Brokerage Withdrawal',       kind: 'withdrawal', amount: breakdown.withdrawalFromBrokerage, bucket: BUCKET_CG },
    { id: AGG_CASH,        label: 'Cash Withdrawal',            kind: 'withdrawal', amount: breakdown.withdrawalFromCash,     bucket: BUCKET_EXEMPT },
    { id: AGG_ROTH,        label: 'Roth Withdrawal',            kind: 'withdrawal', amount: breakdown.withdrawalFromRoth,     bucket: BUCKET_EXEMPT },
  ];

  // ---- Use definitions ----
  const totalSpending = breakdown.totalSpendingNet;
  const shortfall = breakdown.spendingShortfall;
  const fundedSpending = Math.max(0, totalSpending - shortfall);
  const spendScale = totalSpending > 0 ? fundedSpending / totalSpending : 0;
  const livingActual = breakdown.baseSpendingNet * spendScale;
  const otherActual = breakdown.otherSpendingGoalsNet * spendScale;

  const audit = breakdown.audit;
  const stateOrd = audit?.stateOrdinaryTax ?? 0;
  const locality = breakdown.stateLocalitySurcharge;
  const fedOrd = audit
    ? audit.federalOrdinaryTax
    : Math.max(0, breakdown.ordinaryTax - stateOrd - locality);
  const stateOrdCombined = stateOrd + locality;

  const rothConvDeposit = Math.max(0, convGross - breakdown.rothConversionTaxWithheld);

  const uses: RawUse[] = [
    { id: 'dst_fedord',      label: 'Federal Ordinary Tax',      kind: 'tax',      amount: fedOrd,                          source: BUCKET_ORD },
    { id: 'dst_stateord',    label: 'State Ordinary Tax',        kind: 'tax',      amount: stateOrdCombined,                source: BUCKET_ORD },
    { id: 'dst_irmaa',       label: 'IRMAA',                     kind: 'tax',      amount: breakdown.irmaaSurcharge,        source: BUCKET_ORD },
    { id: 'dst_rothdep',     label: 'Roth Deposit (conversion)', kind: 'deposit',  amount: rothConvDeposit,                 source: BUCKET_ORD },
    { id: 'dst_fedltcg',     label: 'Federal LTCG Tax',          kind: 'tax',      amount: breakdown.federalCapGainsTax,    source: BUCKET_CG },
    { id: 'dst_stateltcg',   label: 'State LTCG Tax',            kind: 'tax',      amount: breakdown.stateCapGainsTax,      source: BUCKET_CG },
    { id: 'dst_niit',        label: 'NIIT',                      kind: 'tax',      amount: breakdown.niitTax,               source: BUCKET_CG },
    { id: 'dst_living',      label: 'Living Expenses',           kind: 'spending', amount: livingActual,                    source: CASHPOOL },
    // Per-goal sink nodes replace the single "Other Spending Goals" aggregate
    // when the audit's spendingGoalBreakdown is present and reconciles with
    // the aggregate; the residual dst_goals node stays as a defensive
    // fallback (audit absent, or a >$1 reconciliation gap).
    ...buildGoalUses(breakdown, otherActual, spendScale),
    { id: 'dst_pretax',      label: 'Pre-Tax → Traditional',     kind: 'deposit',  amount: breakdown.preTaxContributions,   source: CASHPOOL },
    { id: 'dst_rothcontrib', label: 'Roth Contribution',         kind: 'deposit',  amount: breakdown.rothContributions,     source: CASHPOOL },
    { id: 'dst_aftercontrib',label: 'After-Tax → Brokerage',     kind: 'deposit',  amount: breakdown.afterTaxContributions, source: CASHPOOL },
    { id: 'dst_match',       label: 'Employer Match Deposit',    kind: 'deposit',  amount: breakdown.employerMatch,         source: CASHPOOL },
    { id: 'dst_rmdexcess',   label: 'RMD Excess → Brokerage',    kind: 'deposit',  amount: breakdown.rmdExcess,             source: CASHPOOL },
    { id: 'dst_surplus',     label: 'Surplus → Brokerage',       kind: 'deposit',  amount: breakdown.surplusContribution,   source: CASHPOOL },
    // Cash interest is credited INTO the cash account balance by the engine
    // (`balances[id] += interest`), so it is NOT a fresh spendable inflow — the
    // year's spendable cash from the cash account is `withdrawalFromCash`, which
    // already contains any withdrawn interest. The engine mirrors this by
    // subtracting cashInterest back out of spendable cash
    // (`availableCash = ... - cashInterest` in SimulationService). We keep
    // `src_cashint` in the Ordinary bucket so the interest still drives the
    // ordinary-tax base, then route an equal amount straight back out to the
    // cash balance here. The pair nets to zero in the flow totals, so the
    // interest contributes its tax (paid from the bucket residual) but no
    // phantom spendable dollars — preventing the global "engine drift" the
    // double-count otherwise produced (worst-bucket/aggregator stay $0 because
    // the After-Tax Cash node is reconciled only globally).
    { id: 'dst_cashint',     label: 'Cash Interest → Cash',      kind: 'deposit',  amount: breakdown.cashInterest,          source: BUCKET_ORD },
  ];

  const EPS = 0.005;

  // ---- Source-side filtering + display deflation ----
  const activeSources = sources.filter(s => s.amount > EPS).map(s => ({ ...s, displayAmount: d(s.amount) }));
  const activeUses = uses.filter(u => u.amount > EPS).map(u => ({ ...u, displayAmount: d(u.amount) }));

  // ---- Bucket totals (display dollars) ----
  const bucketInflows: Record<string, number> = {
    [BUCKET_ORD]: 0,
    [BUCKET_CG]: 0,
    [BUCKET_EXEMPT]: 0,
  };
  for (const s of activeSources) bucketInflows[s.bucket] += s.displayAmount;

  // Direct (non-residual) outflows from each tax bucket.
  const bucketDirectOutflows: Record<string, number> = {
    [BUCKET_ORD]: 0,
    [BUCKET_CG]: 0,
    [BUCKET_EXEMPT]: 0,
  };
  for (const u of activeUses) {
    if (u.source === BUCKET_ORD || u.source === BUCKET_CG) {
      bucketDirectOutflows[u.source] += u.displayAmount;
    }
  }

  const bucketResiduals: Record<string, number> = {
    [BUCKET_ORD]:    Math.max(0, bucketInflows[BUCKET_ORD]    - bucketDirectOutflows[BUCKET_ORD]),
    [BUCKET_CG]:     Math.max(0, bucketInflows[BUCKET_CG]     - bucketDirectOutflows[BUCKET_CG]),
    [BUCKET_EXEMPT]: bucketInflows[BUCKET_EXEMPT],
  };

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // ---- Column 0: detail nodes for aggregators that have per-event / per-account children ----
  // Set of aggregator IDs that received any detail inflow this year. For these,
  // the column-0 detail nodes carry the source-side weight; we do NOT emit a
  // direct edge from the aggregator into the bucket without first letting the
  // detail edges accumulate at the aggregator.
  const aggregatorsWithDetail = new Set<string>();
  // Tracks per-aggregator detail inflow in display dollars for the conservation audit.
  const aggregatorDetailSum: Record<string, number> = {};
  const aggregatorAudits: AggregatorAudit[] = [];

  // Helper: emit one detail node + its edge to an aggregator. Caller passes
  // amounts in NOMINAL dollars; this function deflates via `d`.
  const emitDetail = (
    id: string,
    label: string,
    amountNominal: number,
    aggregatorId: string,
  ) => {
    const value = d(amountNominal);
    if (value <= EPS) return;
    nodes.push({ id, label, kind: 'detail', total: value });
    links.push({ source: id, target: aggregatorId, value, kind: 'main' });
    aggregatorsWithDetail.add(aggregatorId);
    aggregatorDetailSum[aggregatorId] = (aggregatorDetailSum[aggregatorId] ?? 0) + value;
  };

  // ---- Detail: per income event (Wage & Other, SS, Roth conversion) ----
  const events: IncomeEventTaxAttribution[] = audit?.incomeEventTaxBreakdown ?? [];
  // Pre-compute the SS taxable share once per year (provisional-income is an
  // aggregate property, not per-event).
  const ssShareTaxable = breakdown.ssGross > EPS ? breakdown.ssTaxableAmount / breakdown.ssGross : 0;
  const ssShareFree = 1 - ssShareTaxable;

  // Tracks the per-event SS contribution in display dollars so we can add a
  // residual if rounding diverges.
  let ssDetailTaxableSum = 0;
  let ssDetailFreeSum = 0;

  for (const ev of events) {
    if (ev.gross <= EPS) continue;
    const detailId = `detail_${ev.eventId}`;
    if (ORDINARY_EVENT_TYPES.has(ev.eventType)) {
      emitDetail(detailId, ev.eventName, ev.gross, AGG_WAGE);
    } else if (ev.eventType === 'social_security') {
      // Each SS event emits two outgoing edges — one into the taxable
      // aggregator, one into the tax-free aggregator. The detail node total
      // equals the event gross (both edges originate from this single node).
      const taxablePart = ev.gross * ssShareTaxable;
      const freePart = ev.gross * ssShareFree;
      const valueTaxable = d(taxablePart);
      const valueFree = d(freePart);
      const total = valueTaxable + valueFree;
      if (total <= EPS) continue;
      nodes.push({ id: detailId, label: ev.eventName, kind: 'detail', total });
      if (valueTaxable > EPS) {
        links.push({ source: detailId, target: AGG_SS_TAXABLE, value: valueTaxable, kind: 'main' });
        aggregatorsWithDetail.add(AGG_SS_TAXABLE);
        aggregatorDetailSum[AGG_SS_TAXABLE] = (aggregatorDetailSum[AGG_SS_TAXABLE] ?? 0) + valueTaxable;
        ssDetailTaxableSum += valueTaxable;
      }
      if (valueFree > EPS) {
        links.push({ source: detailId, target: AGG_SS_FREE, value: valueFree, kind: 'main' });
        aggregatorsWithDetail.add(AGG_SS_FREE);
        aggregatorDetailSum[AGG_SS_FREE] = (aggregatorDetailSum[AGG_SS_FREE] ?? 0) + valueFree;
        ssDetailFreeSum += valueFree;
      }
    } else if (ev.eventType === 'roth_conversion') {
      emitDetail(detailId, ev.eventName, ev.gross, AGG_CONV);
    }
    // Other classifications (pre_tax_contribution, after_tax, roth_contribution,
    // after_tax_contribution, synthetic traditional_withdrawal) are not surfaced
    // as column-0 sources — they're either deposits, negative reductions, or
    // already represented by their own column-1 aggregators.
  }

  // ---- Detail: per account withdrawal (Brokerage, Cash, Roth) ----
  const accountFlows: AccountFlowRow[] = audit?.accountFlows ?? [];
  for (const a of accountFlows) {
    if (a.withdrawal <= EPS) continue;
    const detailId = `detail_acct_${a.accountId}`;
    if (a.accountType === 'brokerage') {
      emitDetail(detailId, a.accountName, a.withdrawal, AGG_BROKERAGE);
    } else if (a.accountType === 'cash') {
      emitDetail(detailId, a.accountName, a.withdrawal, AGG_CASH);
    } else if (a.accountType === 'roth') {
      emitDetail(detailId, a.accountName, a.withdrawal, AGG_ROTH);
    }
    // Traditional accounts: full per-account decomposition would need engine
    // support to split each account's slice across RMD vs discretionary vs
    // conversion sub-buckets. The RMD portion is surfaced separately below via
    // audit.rmdByAccount (engine populates it with the precise per-owner-aware
    // share). Discretionary-Trad and conversion-source per-account detail are
    // deferred.
  }

  // ---- Detail: per-Traditional-account RMD attribution ----
  // The engine populates audit.rmdByAccount with per-owner-aware shares (Self's
  // RMD pulls only from Self-owned Trad; Spouse's only from Spouse-owned). The
  // sum equals breakdown.rmdRequired within $1.
  const rmdRows: AccountFlowRow[] = audit?.rmdByAccount ?? [];
  for (const row of rmdRows) {
    if (row.withdrawal <= EPS) continue;
    // Distinct id prefix (detail_rmd_acct_*) avoids collision with any future
    // discretionary-Trad detail (detail_acct_*) that might reference the same
    // accountId in the same year.
    emitDetail(`detail_rmd_acct_${row.accountId}`, row.accountName, row.withdrawal, AGG_RMD);
  }

  // ---- Residual detail for aggregators where detail-sum < aggregator amount ----
  // This keeps per-aggregator conservation tight when, for example,
  // incomeEventTaxBreakdown is missing an event but the breakdown field is set.
  const ensureAggregatorBalanced = (
    aggId: string,
    aggLabel: string,
    expectedDisplay: number,
    residualLabel: string,
  ) => {
    if (!aggregatorsWithDetail.has(aggId)) return; // no detail emitted; skip
    const currentSum = aggregatorDetailSum[aggId] ?? 0;
    const residual = expectedDisplay - currentSum;
    if (residual > EPS) {
      const resId = `detail_residual_${aggId}`;
      nodes.push({ id: resId, label: residualLabel, kind: 'detail', total: residual });
      links.push({ source: resId, target: aggId, value: residual, kind: 'main' });
      aggregatorDetailSum[aggId] = currentSum + residual;
    }
    aggregatorAudits.push({
      id: aggId,
      label: aggLabel,
      detailSum: aggregatorDetailSum[aggId] ?? 0,
      expected: expectedDisplay,
      diff: expectedDisplay - (aggregatorDetailSum[aggId] ?? 0),
    });
  };

  ensureAggregatorBalanced(AGG_WAGE,      'Wage & Other Income',     d(wageGross),                          'Other ordinary');
  ensureAggregatorBalanced(AGG_CONV,      'Roth Conversion (gross)', d(convGross),                          'Other conversion');
  ensureAggregatorBalanced(AGG_RMD,       'RMD',                     d(rmd),                                'Other RMD');
  ensureAggregatorBalanced(AGG_BROKERAGE, 'Brokerage Withdrawal',    d(breakdown.withdrawalFromBrokerage),  'Other brokerage');
  ensureAggregatorBalanced(AGG_CASH,      'Cash Withdrawal',         d(breakdown.withdrawalFromCash),       'Other cash');
  ensureAggregatorBalanced(AGG_ROTH,      'Roth Withdrawal',         d(breakdown.withdrawalFromRoth),       'Other Roth');
  // SS aggregators share one residual budget split between taxable and tax-free
  // parts. The per-event split already used the year-aggregate ratio, so any
  // residual would be tiny rounding only.
  if (aggregatorsWithDetail.has(AGG_SS_TAXABLE) || aggregatorsWithDetail.has(AGG_SS_FREE)) {
    const expectedTaxable = d(ssTaxable);
    const expectedFree = d(ssTaxFree);
    const residualTaxable = expectedTaxable - ssDetailTaxableSum;
    const residualFree = expectedFree - ssDetailFreeSum;
    if (residualTaxable > EPS) {
      const resId = `detail_residual_${AGG_SS_TAXABLE}`;
      nodes.push({ id: resId, label: 'Other SS (taxable)', kind: 'detail', total: residualTaxable });
      links.push({ source: resId, target: AGG_SS_TAXABLE, value: residualTaxable, kind: 'main' });
      aggregatorDetailSum[AGG_SS_TAXABLE] = (aggregatorDetailSum[AGG_SS_TAXABLE] ?? 0) + residualTaxable;
    }
    if (residualFree > EPS) {
      const resId = `detail_residual_${AGG_SS_FREE}`;
      nodes.push({ id: resId, label: 'Other SS (tax-free)', kind: 'detail', total: residualFree });
      links.push({ source: resId, target: AGG_SS_FREE, value: residualFree, kind: 'main' });
      aggregatorDetailSum[AGG_SS_FREE] = (aggregatorDetailSum[AGG_SS_FREE] ?? 0) + residualFree;
    }
    aggregatorAudits.push({
      id: AGG_SS_TAXABLE,
      label: 'Social Security (Taxable)',
      detailSum: aggregatorDetailSum[AGG_SS_TAXABLE] ?? 0,
      expected: expectedTaxable,
      diff: expectedTaxable - (aggregatorDetailSum[AGG_SS_TAXABLE] ?? 0),
    });
    aggregatorAudits.push({
      id: AGG_SS_FREE,
      label: 'Social Security (Tax-Free)',
      detailSum: aggregatorDetailSum[AGG_SS_FREE] ?? 0,
      expected: expectedFree,
      diff: expectedFree - (aggregatorDetailSum[AGG_SS_FREE] ?? 0),
    });
  }

  // ---- Column 1: aggregator / source nodes + their links into the buckets ----
  // For sources WITH detail children, we've already emitted the detail edges;
  // here we add the aggregator node and its outflow to the bucket.
  // For sources WITHOUT detail, we emit a single node and its bucket edge as in v2.
  for (const s of activeSources) {
    nodes.push({ id: s.id, label: s.label, kind: s.kind, total: s.displayAmount });
    links.push({ source: s.id, target: s.bucket, value: s.displayAmount, kind: 'main' });
  }

  // ---- Bucket nodes ----
  const bucketDefs = [
    { id: BUCKET_ORD,    label: 'Ordinary Income', kind: 'bucket_ord'      as SankeyNodeKind },
    { id: BUCKET_CG,     label: 'Capital Gains',   kind: 'bucket_capgains' as SankeyNodeKind },
    { id: BUCKET_EXEMPT, label: 'Tax-Exempt',      kind: 'bucket_exempt'   as SankeyNodeKind },
  ];
  const bucketAudits: BucketAudit[] = [];
  for (const b of bucketDefs) {
    const inflow = bucketInflows[b.id];
    if (inflow <= EPS) continue;
    nodes.push({ id: b.id, label: b.label, kind: b.kind, total: inflow });
    const outflow = bucketDirectOutflows[b.id] + bucketResiduals[b.id];
    bucketAudits.push({ id: b.id, label: b.label, inflow, outflow, diff: inflow - outflow });
  }

  // Bucket → tax outflow links.
  for (const u of activeUses) {
    if (u.source !== BUCKET_ORD && u.source !== BUCKET_CG) continue;
    if (bucketInflows[u.source] <= EPS) continue;
    links.push({ source: u.source, target: u.id, value: u.displayAmount, kind: 'main' });
    nodes.push({ id: u.id, label: u.label, kind: u.kind, total: u.displayAmount });
  }

  // ---- Detail: per-Roth-account conversion deposit (downstream of dst_rothdep) ----
  // The engine populates audit.rothConvDepositByAccount with per-owner-aware
  // shares: Self conversion deposits to Self-owned Roth only; Spouse to
  // Spouse-owned Roth only. Within each owner's set the deposit is pro-rata by
  // balance. Sum equals rothConvDeposit (gross − withheld) within $1. The
  // detail nodes sit downstream of dst_rothdep — d3-sankey will place them
  // to the right of the column-4 deposit use-node.
  const rothConvDepositRows: AccountFlowRow[] = audit?.rothConvDepositByAccount ?? [];
  const rothdepHasDetail = rothConvDepositRows.some(r => r.deposit > 0) && rothConvDeposit > EPS;
  let rothdepDetailSum = 0;
  if (rothdepHasDetail) {
    for (const row of rothConvDepositRows) {
      if (row.deposit <= EPS) continue;
      const value = d(row.deposit);
      if (value <= EPS) continue;
      // Distinct id prefix avoids collision with future deposit-side detail
      // for other Roth deposits (e.g., Roth contributions, if ever surfaced).
      const detailId = `detail_rothdep_acct_${row.accountId}`;
      nodes.push({ id: detailId, label: row.accountName, kind: 'detail', total: value });
      links.push({ source: 'dst_rothdep', target: detailId, value, kind: 'main' });
      rothdepDetailSum += value;
    }
    // Per-aggregator audit for dst_rothdep when it has downstream detail.
    // Drift here would mean rothConvDepositByAccount doesn't sum to the
    // displayed deposit — surfaces the dev-mode warning if the engine and
    // layout disagree.
    const expectedDeposit = d(rothConvDeposit);
    aggregatorAudits.push({
      id: 'dst_rothdep',
      label: 'Roth Deposit (conversion)',
      detailSum: rothdepDetailSum,
      expected: expectedDeposit,
      diff: expectedDeposit - rothdepDetailSum,
    });
  }

  // ---- After-Tax Cash node + bucket residuals + use links ----
  const cashpoolUses = activeUses.filter(u => u.source === CASHPOOL);
  const cashpoolInflow =
    bucketResiduals[BUCKET_ORD] + bucketResiduals[BUCKET_CG] + bucketResiduals[BUCKET_EXEMPT];

  if (cashpoolInflow > EPS || cashpoolUses.length > 0) {
    nodes.push({ id: CASHPOOL, label: 'After-Tax Cash', kind: 'cashpool', total: cashpoolInflow });

    if (bucketResiduals[BUCKET_ORD] > EPS && bucketInflows[BUCKET_ORD] > EPS) {
      links.push({ source: BUCKET_ORD, target: CASHPOOL, value: bucketResiduals[BUCKET_ORD], kind: 'main' });
    }
    if (bucketResiduals[BUCKET_CG] > EPS && bucketInflows[BUCKET_CG] > EPS) {
      links.push({ source: BUCKET_CG, target: CASHPOOL, value: bucketResiduals[BUCKET_CG], kind: 'main' });
    }
    if (bucketResiduals[BUCKET_EXEMPT] > EPS && bucketInflows[BUCKET_EXEMPT] > EPS) {
      links.push({ source: BUCKET_EXEMPT, target: CASHPOOL, value: bucketResiduals[BUCKET_EXEMPT], kind: 'main' });
    }

    for (const u of cashpoolUses) {
      links.push({ source: CASHPOOL, target: u.id, value: u.displayAmount, kind: 'main' });
      nodes.push({ id: u.id, label: u.label, kind: u.kind, total: u.displayAmount });
    }
  }

  // ---- Totals ----
  const inflowTotal = activeSources.reduce((acc, s) => acc + s.displayAmount, 0);
  const outflowTotal = activeUses.reduce((acc, u) => acc + u.displayAmount, 0);

  // ---- Inter-account transfers (off-axis) ----
  const refill = d(breakdown.cashRefillFromSurplus);
  const sweep = d(breakdown.cashSweepToBrokerage);
  if (refill > EPS) {
    nodes.push({ id: 'xfer_brokerage_src', label: 'Brokerage (refill source)', kind: 'transfer', total: refill });
    nodes.push({ id: 'xfer_cash_dst',      label: 'Cash (refill target)',      kind: 'transfer', total: refill });
    links.push({ source: 'xfer_brokerage_src', target: 'xfer_cash_dst', value: refill, kind: 'transfer' });
  }
  if (sweep > EPS) {
    nodes.push({ id: 'xfer_cash_src',      label: 'Cash (sweep source)',      kind: 'transfer', total: sweep });
    nodes.push({ id: 'xfer_brokerage_dst', label: 'Brokerage (sweep target)', kind: 'transfer', total: sweep });
    links.push({ source: 'xfer_cash_src', target: 'xfer_brokerage_dst', value: sweep, kind: 'transfer' });
  }

  return {
    nodes,
    links,
    inflowTotal,
    outflowTotal,
    conservationDiff: inflowTotal - outflowTotal,
    bucketAudits,
    aggregatorAudits,
    shortfall: d(shortfall),
  };
}
