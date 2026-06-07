import type { Scenario } from '../types/Scenario';
import { CURRENT_SCHEMA_VERSION } from '../types/Scenario';
import type { IncomeEvent, IncomeEventGeneratedBy } from '../types/IncomeEvent';
import { eventTypeLabels, goalTypeLabels, accountTypeShortLabels } from './defaultName';

// ============================================================================
// Scenario validation, normalization, and content migrations.
//
// Two distinct responsibilities live here, kept separate because they fail
// differently:
//
//  - `validateImportedScenario` THROWS on structural problems. Use it on the
//    IMPORT path only — you want to reject a bad/foreign file loudly. Never call
//    it on the IndexedDB load path: a slightly-off persisted record must not
//    brick the whole app.
//  - `runMigrationPipeline` is NON-throwing and idempotent. It normalizes
//    defaults, runs the inference migrations, and stamps the schema version.
//    It is the SINGLE source of truth shared by both the import path and the
//    `initDB` load loop, so the two can no longer diverge.
//
// See CLAUDE.md "IndexedDB schema migrations" for the surrounding design.
// ============================================================================

// One-shot migration: scenarios saved before the Roth Conversion generator
// rework carried an opaque `taxStrategy.cachedVector` that the engine consulted
// at sim time. The engine no longer reads it; this materializes the cached
// per-year decisions as visible `roth_conversion` events (tagged with the
// generator that produced them) and strips the dead field. Scenarios without a
// cached vector lose `taxStrategy` silently — the engine ignored everything
// but the cache anyway.
type LegacyTaxStrategy = {
  name?: string;
  cachedVector?: { perYearDecisions?: Array<{ year: number; conversionAmount: number }> };
};

/**
 * Content-level migration: account.type === 'taxable' → 'brokerage'.
 *
 * The AccountType enum was renamed so the Sankey's tax-treatment labels
 * would stop colliding with the account type. Scenarios persisted before
 * the rename still carry the old literals; this helper rewrites them on
 * load. Idempotent — running twice on the same scenario is a no-op.
 */
export function migrateTaxableAccountTypeToBrokerage(scenario: Scenario): {
  scenario: Scenario;
  changed: boolean;
} {
  let changed = false;
  const accounts = (scenario.accounts ?? []).map((a) => {
    if ((a.type as string) === 'taxable') {
      changed = true;
      return { ...a, type: 'brokerage' as const };
    }
    return a;
  });
  if (!changed) return { scenario, changed: false };
  return {
    scenario: { ...scenario, accounts },
    changed: true,
  };
}

/**
 * Content-level migration: strip the deprecated `spendingWithdrawalOrder`
 * field. Added in Revision 2 when the field was removed from `UserData` —
 * the engine now auto-selects the spending policy per scenario via
 * `selectBestSpendingOrder`, so this user-facing knob no longer exists.
 *
 * Idempotent — running twice on the same scenario is a no-op.
 */
export function stripDeprecatedSpendingWithdrawalOrder(scenario: Scenario): {
  scenario: Scenario;
  changed: boolean;
} {
  const scenarioWithLegacy = scenario as Scenario & { spendingWithdrawalOrder?: string };
  if (scenarioWithLegacy.spendingWithdrawalOrder === undefined) {
    return { scenario, changed: false };
  }
  // Destructure to drop the field; rest spread carries every other key.
  const { spendingWithdrawalOrder: _, ...rest } = scenarioWithLegacy;
  return { scenario: rest as Scenario, changed: true };
}

/**
 * Content-level migration: cash bucket policy thresholds expressed as MONTHS of
 * spending (`minMonths`/`targetMonths`/`maxMonths`) → fixed dollar AMOUNTS
 * (`minAmount`/`targetAmount`/`maxAmount`).
 *
 * The old engine converted months to dollars each sim year via
 * `monthly = totalSpendingNet / 12`. To preserve behavior as closely as
 * possible we convert against an estimate of the scenario's year-0 annual
 * living expenses (the same `living_expenses`-goal annualization used in
 * conversionImpact). When that estimate is non-positive we fall back to
 * sensible default dollar amounts (mirrors CashBucketDialog DEFAULTS).
 *
 * Idempotent — a policy already in the new shape (no `minMonths`) is a no-op.
 * Non-throwing — a slightly-off record must not brick the load path.
 */
const CASH_BUCKET_DEFAULTS = { minAmount: 20000, targetAmount: 60000, maxAmount: 120000 };

export function migrateCashBucketMonthsToAmounts(scenario: Scenario): {
  scenario: Scenario;
  changed: boolean;
} {
  const policy = scenario.cashBucketPolicy as
    | (Partial<{ minMonths: number; targetMonths: number; maxMonths: number }> &
        Partial<{ minAmount: number; targetAmount: number; maxAmount: number }> & {
          refillTrigger: 'always' | 'gains_only' | 'above_baseline' | 'none';
        })
    | undefined;
  // Only act on the old month-denominated shape.
  if (!policy || typeof policy.minMonths !== 'number') {
    return { scenario, changed: false };
  }

  // Estimate year-0 annual living expenses active at currentAge (annualizing
  // monthly-period goals). Matches conversionImpact's living-expenses sum.
  const age = scenario.currentAge;
  let annual = 0;
  for (const goal of scenario.spendingGoals ?? []) {
    if (goal.type !== 'living_expenses') continue;
    const active = goal.isOneTime
      ? age === goal.startAge
      : age >= goal.startAge && (goal.endAge === undefined || age <= goal.endAge);
    if (!active) continue;
    annual += (goal.amountPeriod === 'monthly' ? goal.amount * 12 : goal.amount);
  }

  let minAmount: number;
  let targetAmount: number;
  let maxAmount: number;
  if (annual > 0) {
    const monthly = annual / 12;
    minAmount = Math.round((policy.minMonths ?? 0) * monthly);
    targetAmount = Math.round((policy.targetMonths ?? 0) * monthly);
    maxAmount = Math.round((policy.maxMonths ?? 0) * monthly);
  } else {
    minAmount = CASH_BUCKET_DEFAULTS.minAmount;
    targetAmount = CASH_BUCKET_DEFAULTS.targetAmount;
    maxAmount = CASH_BUCKET_DEFAULTS.maxAmount;
  }

  return {
    scenario: {
      ...scenario,
      cashBucketPolicy: { minAmount, targetAmount, maxAmount, refillTrigger: policy.refillTrigger },
    },
    changed: true,
  };
}

export function migrateLegacyTaxStrategy(scenario: Scenario): { scenario: Scenario; addedConversions: number } {
  // The taxStrategy field is no longer part of the Scenario type, but legacy
  // scenarios in IndexedDB / imported JSON still carry it. Read via an
  // unknown-cast so the rest of the code stays type-clean.
  const ts = (scenario as unknown as { taxStrategy?: LegacyTaxStrategy }).taxStrategy;
  if (!ts) return { scenario, addedConversions: 0 };
  const decisions = ts.cachedVector?.perYearDecisions ?? [];
  // Drop decisions for years before referenceYear: they'd map to startAge <
  // currentAge, and eventActiveInYear() in SimulationService checks `year ===
  // startYear` for one-time events — so a past-year migrated event would never
  // fire. Past-year cache entries are conversions that already happened (the
  // user has presumably moved on); silently dropping them is correct.
  const nonZero = decisions.filter(
    (d) => d.conversionAmount > 0 && d.year >= scenario.referenceYear
  );
  const generatedBy: IncomeEventGeneratedBy =
    ts.name === 'optimize' ? 'optimize'
    : ts.name === 'auto_bracket' ? 'auto_bracket'
    : ts.name === 'fill_to_bracket' ? 'fill_to_bracket'
    : 'user';
  const generatedAt = new Date().toISOString().slice(0, 10);
  const generatorRunId = crypto.randomUUID();
  const migrated: IncomeEvent[] = nonZero.map((d) => {
    const startAge = scenario.currentAge + (d.year - scenario.referenceYear);
    return {
      id: `migrated-conv-${d.year}-${generatorRunId.slice(0, 8)}`,
      type: 'roth_conversion',
      name: `Roth conversion ${d.year}`,
      amount: d.conversionAmount,
      startAge,
      endAge: startAge,
      isOneTime: true,
      taxStatus: 'before_tax',
      colaType: 'fixed',
      meta: { generatedBy, generatedAt, generatorRunId },
    };
  });
  // Strip taxStrategy; the engine no longer reads it.
  const { taxStrategy: _drop, ...rest } = scenario as unknown as Scenario & { taxStrategy?: unknown };
  void _drop;
  // Idempotency: if the user re-imports the original legacy JSON, drop any
  // prior batch of migrated- events to avoid stacking duplicates per year.
  // The id prefix is the safest signal — provenance metadata alone could
  // be matched by future generator runs that share the same name.
  const survivors = scenario.incomeEvents.filter((e) => !e.id.startsWith('migrated-conv-'));
  return {
    scenario: { ...(rest as Scenario), incomeEvents: [...survivors, ...migrated] },
    addedConversions: migrated.length,
  };
}

// ----------------------------------------------------------------------------
// Ordered content-schema migrators (registry skeleton).
//
// Keyed by the version they upgrade FROM (`migrators[v]` turns a v→v+1 record).
// Currently EMPTY: the shape-inference migrations above (legacy taxStrategy,
// taxable→brokerage, spendingWithdrawalOrder strip) plus `normalizeScenario`
// still do all v0→v1 work. This is the home for the next content change —
// when CURRENT_SCHEMA_VERSION is next bumped, add `MIGRATORS[1] = (s) => ...`
// and the loop below chains them. See CLAUDE.md "Release-readiness roadmap".
// ----------------------------------------------------------------------------
export const MIGRATORS: Record<number, (scenario: Scenario) => Scenario> = {};

function applyVersionedMigrators(scenario: Scenario): Scenario {
  let v = scenario.schemaVersion ?? 0;
  let working = scenario;
  while (v < CURRENT_SCHEMA_VERSION && MIGRATORS[v]) {
    working = MIGRATORS[v](working);
    v += 1;
  }
  return working;
}

/**
 * Fill in missing/invalid defaults on a Scenario. Pure, idempotent, and
 * non-throwing — a fully-valid current scenario passes through unchanged
 * (`changed: false`), so the load loop never triggers a spurious re-persist.
 *
 * This is the formerly import-only normalization block; sharing it via
 * `runMigrationPipeline` is what keeps the load and import paths from
 * diverging. Required fields with no sensible default (e.g. `stockReturn`)
 * are NOT defaulted here — they are rejected at import by
 * `validateImportedScenario`.
 */
export function normalizeScenario(scenario: Scenario): { scenario: Scenario; changed: boolean } {
  let changed = false;
  let next = scenario;

  // Backfill per-account allocation for accounts created before that feature.
  if (Array.isArray(next.accounts)) {
    let accountsChanged = false;
    const accounts = next.accounts.map((account) => {
      let acct = account;
      if (typeof acct.stockAllocation !== 'number') {
        acct = { ...acct, stockAllocation: 0.6 };
        accountsChanged = true;
      }
      if (!acct.portfolioBalance) {
        acct = { ...acct, portfolioBalance: '60_40' };
        accountsChanged = true;
      }
      return acct;
    });
    if (accountsChanged) {
      next = { ...next, accounts };
      changed = true;
    }
  }

  if (typeof next.longTermCapGainsRate !== 'number') {
    next = { ...next, longTermCapGainsRate: 0.15 };
    changed = true;
  }
  if (typeof next.inflationStdDev !== 'number') {
    next = { ...next, inflationStdDev: 0 };
    changed = true;
  }

  // portfolioAssumptions defaulting/clamping. We only build a new `pa` object
  // when a field actually changes, so valid scenarios stay referentially stable.
  const pa = next.portfolioAssumptions;
  if (pa) {
    const candidate = { ...pa };
    let paChanged = false;
    const set = <K extends keyof typeof candidate>(key: K, value: (typeof candidate)[K]) => {
      if (candidate[key] !== value) {
        candidate[key] = value;
        paChanged = true;
      }
    };

    if (typeof candidate.stockBondCorrelationEnabled !== 'boolean') {
      set('stockBondCorrelationEnabled', false);
    }
    if (typeof candidate.stockBondCorrelation !== 'number') {
      set('stockBondCorrelation', -0.2);
    }
    if (typeof candidate.stockBondCorrelation === 'number') {
      set('stockBondCorrelation', Math.max(-1, Math.min(1, candidate.stockBondCorrelation)));
    }
    if (candidate.returnDistribution !== 'student_t') {
      set('returnDistribution', 'lognormal');
    }
    if (typeof candidate.degreesOfFreedom !== 'number') {
      set('degreesOfFreedom', 4);
    }
    if (typeof candidate.degreesOfFreedom === 'number') {
      set('degreesOfFreedom', Math.max(3, Math.min(12, Math.round(candidate.degreesOfFreedom))));
    }
    if (
      candidate.returnModel !== 'historical_single' &&
      candidate.returnModel !== 'historical_rolling' &&
      candidate.returnModel !== 'historical_bootstrap'
    ) {
      set('returnModel', 'parametric');
    }
    if (candidate.historicalWrapEnabled !== undefined && typeof candidate.historicalWrapEnabled !== 'boolean') {
      set('historicalWrapEnabled', false);
    }
    if (candidate.blackSwanEvents !== undefined && !Array.isArray(candidate.blackSwanEvents)) {
      set('blackSwanEvents', []);
    }

    if (paChanged) {
      next = { ...next, portfolioAssumptions: candidate };
      changed = true;
    }
  }

  return { scenario: next, changed };
}

export interface MigrationResult {
  scenario: Scenario;
  /** Roth conversion events materialized from a legacy taxStrategy cache. Toast-worthy. */
  addedConversions: number;
  /** A `taxable` account type was renamed to `brokerage`. Toast-worthy. */
  brokerageRenamed: boolean;
  /** The deprecated `spendingWithdrawalOrder` field was stripped. Toast-worthy. */
  spendingStripped: boolean;
  /** Cash bucket policy thresholds converted months → dollar amounts. Persist
   *  silently — forced one-way conversion with no user action, no toast. */
  cashBucketConverted: boolean;
  /** A default was backfilled (normalization). Persist silently — no toast. */
  normalized: boolean;
  /** The schemaVersion stamp was set/updated. Persist silently — no toast. */
  stamped: boolean;
}

/**
 * The single migration/normalization pipeline shared by import and load.
 * Order: normalize defaults → versioned migrators (registry) → inference
 * migrations → schemaVersion stamp. Non-throwing and idempotent: running it
 * twice on its own output reports no changes.
 */
export function runMigrationPipeline(scenario: Scenario): MigrationResult {
  let working = scenario;

  const { scenario: normalized, changed: didNormalize } = normalizeScenario(working);
  working = normalized;

  working = applyVersionedMigrators(working);

  const { scenario: afterTaxStrategy, addedConversions } = migrateLegacyTaxStrategy(working);
  working = afterTaxStrategy;

  const { scenario: afterBrokerage, changed: brokerageRenamed } =
    migrateTaxableAccountTypeToBrokerage(working);
  working = afterBrokerage;

  const { scenario: afterSpending, changed: spendingStripped } =
    stripDeprecatedSpendingWithdrawalOrder(working);
  working = afterSpending;

  const { scenario: afterCashBucket, changed: cashBucketConverted } =
    migrateCashBucketMonthsToAmounts(working);
  working = afterCashBucket;

  let stamped = false;
  if (working.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    working = { ...working, schemaVersion: CURRENT_SCHEMA_VERSION };
    stamped = true;
  }

  return {
    scenario: working,
    addedConversions,
    brokerageRenamed,
    spendingStripped,
    cashBucketConverted,
    normalized: didNormalize,
    stamped,
  };
}

// Legacy account-type alias accepted on import so a pre-rename file passes
// validation; `migrateTaxableAccountTypeToBrokerage` rewrites it afterward.
const VALID_ACCOUNT_TYPES = new Set<string>([...Object.keys(accountTypeShortLabels), 'taxable']);
const VALID_INCOME_TYPES = new Set<string>(Object.keys(eventTypeLabels));
const VALID_GOAL_TYPES = new Set<string>(Object.keys(goalTypeLabels));
const VALID_TAX_STATUS = new Set<string>(['before_tax', 'after_tax']);
const VALID_COLA_TYPES = new Set<string>(['fixed', 'inflation_adjusted']);

/**
 * Validate a parsed scenario before import. THROWS a human-readable Error on
 * the first structural problem found. Import-path only — do not call on load.
 */
export function validateImportedScenario(data: Scenario): void {
  // A file that parses to null / a primitive / an array isn't a scenario at
  // all — reject it cleanly instead of throwing a raw "cannot read property"
  // TypeError on the first field access below.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid scenario: file does not contain a scenario object.');
  }

  // Forward-compat guard next, so a file from a newer build gets the right
  // message instead of a confusing field error.
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This file was created by a newer version of YARP (schema v${data.schemaVersion}). ` +
      `Update the app to open it.`
    );
  }

  if (!data.name || typeof data.currentAge !== 'number') {
    throw new Error('Invalid scenario: Missing name or currentAge.');
  }
  if (typeof data.lifeExpectancy !== 'number' || data.lifeExpectancy < data.currentAge) {
    throw new Error('Invalid scenario: lifeExpectancy must be a number ≥ currentAge.');
  }
  if (typeof data.referenceYear !== 'number') {
    throw new Error('Invalid scenario: referenceYear must be a number.');
  }
  if (typeof data.inflationRate !== 'number') {
    throw new Error('Invalid scenario: inflationRate must be a number.');
  }
  const validFilings = new Set(['single', 'mfs', 'mfj', 'hoh']);
  if (!validFilings.has(data.filingStatus)) {
    throw new Error(`Invalid scenario: filingStatus must be one of single/mfs/mfj/hoh (got "${data.filingStatus}").`);
  }
  if (!Array.isArray(data.incomeEvents)) {
    throw new Error('Invalid scenario: incomeEvents must be an array.');
  }
  if (!Array.isArray(data.spendingGoals)) {
    throw new Error('Invalid scenario: spendingGoals must be an array.');
  }
  if (!Array.isArray(data.stateTimeline) || data.stateTimeline.length === 0) {
    throw new Error('Invalid scenario: stateTimeline must be a non-empty array.');
  }
  for (const entry of data.stateTimeline) {
    if (!entry || typeof entry.state !== 'string' || entry.state.length === 0) {
      throw new Error('Invalid scenario: every stateTimeline entry must have a non-empty state name.');
    }
  }
  if (!data.simulationSettings || typeof data.simulationSettings.numSimulations !== 'number') {
    throw new Error('Invalid scenario: simulationSettings.numSimulations must be a number.');
  }
  // A zero or negative numSimulations would crash runSimulation (division by
  // zero in probability, undefined deref in pickRepresentatives). Reject loudly
  // at import rather than blowing up on the first MC tick.
  if (!Number.isFinite(data.simulationSettings.numSimulations) || data.simulationSettings.numSimulations < 1) {
    throw new Error('Invalid scenario: simulationSettings.numSimulations must be at least 1.');
  }
  if (!Array.isArray(data.accounts)) {
    throw new Error('Invalid scenario: Missing accounts array.');
  }

  // Deep element validation — catch the fields whose absence/wrong type would
  // NaN or crash the engine, so the user gets a clear error here instead of at
  // the first simulation tick.
  data.accounts.forEach((account, i) => {
    if (!account || typeof account !== 'object') {
      throw new Error(`Invalid scenario: accounts[${i}] is not an object.`);
    }
    if (typeof account.name !== 'string' || account.name.length === 0) {
      throw new Error(`Invalid scenario: accounts[${i}] is missing a name.`);
    }
    if (!VALID_ACCOUNT_TYPES.has(account.type as string)) {
      throw new Error(`Invalid scenario: accounts[${i}] has an invalid type "${account.type}".`);
    }
    if (!Number.isFinite(account.balance)) {
      throw new Error(`Invalid scenario: accounts[${i}] ("${account.name}") balance must be a number.`);
    }
  });

  data.incomeEvents.forEach((event, i) => {
    if (!event || typeof event !== 'object') {
      throw new Error(`Invalid scenario: incomeEvents[${i}] is not an object.`);
    }
    if (typeof event.name !== 'string' || event.name.length === 0) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] is missing a name.`);
    }
    if (!VALID_INCOME_TYPES.has(event.type as string)) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] has an invalid type "${event.type}".`);
    }
    if (!Number.isFinite(event.amount)) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] ("${event.name}") amount must be a number.`);
    }
    if (!Number.isFinite(event.startAge)) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] ("${event.name}") startAge must be a number.`);
    }
    if (!VALID_TAX_STATUS.has(event.taxStatus as string)) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] ("${event.name}") has an invalid taxStatus.`);
    }
    if (!VALID_COLA_TYPES.has(event.colaType as string)) {
      throw new Error(`Invalid scenario: incomeEvents[${i}] ("${event.name}") has an invalid colaType.`);
    }
  });

  data.spendingGoals.forEach((goal, i) => {
    if (!goal || typeof goal !== 'object') {
      throw new Error(`Invalid scenario: spendingGoals[${i}] is not an object.`);
    }
    if (typeof goal.name !== 'string' || goal.name.length === 0) {
      throw new Error(`Invalid scenario: spendingGoals[${i}] is missing a name.`);
    }
    if (!VALID_GOAL_TYPES.has(goal.type as string)) {
      throw new Error(`Invalid scenario: spendingGoals[${i}] has an invalid type "${goal.type}".`);
    }
    if (!Number.isFinite(goal.amount)) {
      throw new Error(`Invalid scenario: spendingGoals[${i}] ("${goal.name}") amount must be a number.`);
    }
    if (!Number.isFinite(goal.startAge)) {
      throw new Error(`Invalid scenario: spendingGoals[${i}] ("${goal.name}") startAge must be a number.`);
    }
    if (typeof goal.inflationAdjusted !== 'boolean') {
      throw new Error(`Invalid scenario: spendingGoals[${i}] ("${goal.name}") inflationAdjusted must be a boolean.`);
    }
  });

  // portfolioAssumptions: required numeric fields with no sensible default, plus
  // mode-specific requirements. Everything else is defaulted by normalizeScenario.
  const pa = data.portfolioAssumptions;
  if (!pa || typeof pa.stockReturn !== 'number' || typeof pa.bondReturn !== 'number') {
    throw new Error('Invalid scenario: Missing or invalid portfolioAssumptions fields.');
  }
  if (!Number.isFinite(pa.stockStdDev) || !Number.isFinite(pa.bondStdDev)) {
    throw new Error('Invalid scenario: portfolioAssumptions stockStdDev and bondStdDev must be numbers.');
  }
  if (pa.returnModel === 'historical_single' && typeof pa.historicalStartYear !== 'number') {
    throw new Error('Invalid scenario: historicalStartYear is required for the Historical: Single Sequence model.');
  }
  if (pa.returnModel === 'historical_bootstrap' && typeof pa.historicalBlockSize !== 'number') {
    throw new Error('Invalid scenario: historicalBlockSize is required for the Historical: Block Bootstrap model.');
  }
}
