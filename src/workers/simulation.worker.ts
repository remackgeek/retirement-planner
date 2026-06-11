// Web Worker entry for the Monte Carlo engine. Runs in a module-worker context
// (Vite's `new Worker(new URL(...), { type: 'module' })` form).
//
// Protocol: shard-based. Each worker handles a slice of the total MC runs
// determined by (shardIndex, shardCount, effectiveNumRuns). Pass 1 ('runShard')
// returns lightweight summary arrays via Transferable buffers; pass 2 ('replay')
// returns the two representative runs' full audit data. The worker caches its
// SimRun[] between passes and discards it after replay completes (or on cancel).
import {
  runShard,
  buildPrecomputes,
  replayRunWithAudit,
  getEffectiveNumRuns,
  buildAccountIndex,
  type AnnualCashFlowBreakdown,
} from '../services/SimulationService';
import { buildBlackSwanLookup } from '../services/ReturnGenerator';
import type { UserData } from '../types/UserData';

// We need the internal `SimRun` type but it isn't exported. Recreate the shape
// here as a type-only assertion — the cache holds whatever runShard returns.
// (If runShard's return type changes, this file's call sites will fail to compile.)
type SimRun = ReturnType<typeof runShard>[number];

export type WorkerInbound =
  | { type: 'runShard'; requestId: number; shardIndex: number; shardCount: number; userData: UserData }
  | { type: 'replay'; requestId: number; localRunIndices: number[] }
  | { type: 'cancel'; requestId: number };

export type ReplayedRun = {
  localRunIndex: number;
  path: number[];
  breakdowns: AnnualCashFlowBreakdown[];
  stockFactors: number[];
  bondFactors: number[];
  inflation: number[];
};

export type WorkerOutbound =
  | {
      type: 'shardSummary';
      requestId: number;
      shardIndex: number;
      scores: Float64Array;          // length = runsInShard; failed→failedYear, survivor→totalYears+finalBalance
      failedFlags: Uint8Array;       // 0/1
      failedYears: Int16Array;       // -1 if survived
      pathColumns: Float64Array;     // year-major: idx = y * runsInShard + localIdx
      totalYears: number;
      runsInShard: number;
    }
  | { type: 'replayResult'; requestId: number; shardIndex: number; runs: ReplayedRun[] }
  | { type: 'error'; requestId: number; message: string };

// Typed wrapper for the worker-global postMessage: the DedicatedWorkerGlobalScope
// type isn't in the default lib set, hence the one contained cast here.
const post = (msg: WorkerOutbound, transfer?: Transferable[]) =>
  transfer
    ? (self as unknown as Worker).postMessage(msg, transfer)
    : (self as unknown as Worker).postMessage(msg);

// Per-shard cache of the most recent run. Holds SimRun[] + the userData/precomputes
// needed by replayRunWithAudit. Discarded on the next 'runShard' or on 'cancel'.
let cache: {
  requestId: number;
  shardIndex: number;
  runs: SimRun[];
  userData: UserData;
  precomputes: ReturnType<typeof buildPrecomputes>;
  accountIndex: ReturnType<typeof buildAccountIndex>;
  blackSwanLookup: ReturnType<typeof buildBlackSwanLookup>;
} | null = null;

function computeShardRange(total: number, shardIndex: number, shardCount: number): { start: number; end: number } {
  const base = Math.floor(total / shardCount);
  const extra = total % shardCount;
  const start = shardIndex * base + Math.min(shardIndex, extra);
  const runsInShard = base + (shardIndex < extra ? 1 : 0);
  return { start, end: start + runsInShard };
}

function handleRunShard(msg: Extract<WorkerInbound, { type: 'runShard' }>) {
  const { requestId, shardIndex, shardCount, userData } = msg;
  try {
    const total = getEffectiveNumRuns(userData);
    const { start, end } = computeShardRange(total, shardIndex, shardCount);
    const precomputes = buildPrecomputes(userData);
    // runShard internally builds accountIndex/generator/blackSwanLookup, but for
    // replay we need our own accountIndex/blackSwanLookup references — build them here.
    const accountIndex = buildAccountIndex(userData);
    const blackSwanLookup = buildBlackSwanLookup(userData);
    const runs = runShard(userData, precomputes, { startRunIndex: start, endRunIndex: end });

    const runsInShard = runs.length;
    const totalYears = runs.length > 0 ? runs[0].path.length : 0;

    // Pack summary arrays for zero-copy transfer.
    const scores = new Float64Array(runsInShard);
    const failedFlags = new Uint8Array(runsInShard);
    const failedYears = new Int16Array(runsInShard);
    const pathColumns = new Float64Array(totalYears * runsInShard);
    for (let i = 0; i < runsInShard; i++) {
      const run = runs[i];
      const finalBalance = run.path[totalYears - 1];
      scores[i] = run.failed ? run.failedYear : totalYears + finalBalance;
      failedFlags[i] = run.failed ? 1 : 0;
      failedYears[i] = run.failed ? run.failedYear : -1;
      // Year-major: contiguous slice per year for the merge-and-sort step.
      for (let y = 0; y < totalYears; y++) {
        pathColumns[y * runsInShard + i] = run.path[y];
      }
    }

    cache = { requestId, shardIndex, runs, userData, precomputes, accountIndex, blackSwanLookup };

    post({
      type: 'shardSummary', requestId, shardIndex,
      scores, failedFlags, failedYears, pathColumns,
      totalYears, runsInShard,
    }, [scores.buffer, failedFlags.buffer, failedYears.buffer, pathColumns.buffer]);
  } catch (err) {
    // Log full stack inside the worker console before forwarding a bare message,
    // since structured-clone strips Error stack traces.
    console.error('[simulation.worker] runShard failed:', err);
    post({
      type: 'error', requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleReplay(msg: Extract<WorkerInbound, { type: 'replay' }>) {
  if (!cache || cache.requestId !== msg.requestId) {
    post({ type: 'error', requestId: msg.requestId, message: 'replay: cache miss or stale requestId' });
    return;
  }
  const c = cache;
  try {
    const runs: ReplayedRun[] = msg.localRunIndices.map((localIdx) => {
      const replayed = replayRunWithAudit(c.runs[localIdx], c.userData, c.precomputes, c.accountIndex, c.blackSwanLookup);
      return {
        localRunIndex: localIdx,
        path: replayed.path,
        breakdowns: replayed.breakdowns,
        stockFactors: replayed.stockFactors,
        bondFactors: replayed.bondFactors,
        inflation: replayed.inflation,
      };
    });
    // Drop the cache after replay — chart only needs the 2 reps; further replay
    // would be a bug. Keeps memory low between sims.
    cache = null;
    post({ type: 'replayResult', requestId: msg.requestId, shardIndex: c.shardIndex, runs });
  } catch (err) {
    console.error('[simulation.worker] replay failed:', err);
    post({
      type: 'error', requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  if (msg.type === 'runShard') handleRunShard(msg);
  else if (msg.type === 'replay') handleReplay(msg);
  else if (msg.type === 'cancel') {
    if (cache && cache.requestId === msg.requestId) cache = null;
  }
};

