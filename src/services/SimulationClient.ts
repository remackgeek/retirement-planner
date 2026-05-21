// Promise-based client for the Monte Carlo Web Worker pool.
//
// Architecture: a pool of N workers (N = clamp(hardwareConcurrency - 1, 2, 8)).
// Each `run()` shards the MC runs across the pool, awaits all shard summaries,
// merges them into a global percentile band + mcStats, identifies the median
// and downside representative runs by global score sort, requests replay of
// those two runs from their owning shards, computes the deterministic nominal
// projection on the main thread, and assembles the final SimulationResult.
//
// Cancellation: supersession-via-terminate-and-respawn. When a new run arrives
// while one is in flight, every worker is terminated and respawned, and the
// pending Promise rejects with SupersededError. The 250ms debounce upstream
// absorbs most rapid edits before they reach the client.
//
// Inline fast path: scenarios with effectiveNumRuns < INLINE_THRESHOLD (200)
// or historical_single (1 run) run inline on the main thread — pool overhead
// dominates for tiny sims.
import {
  runSimulation,
  runDeterministicProjection,
  prepareUserData,
  getEffectiveNumRuns,
  type SimulationResult,
} from './SimulationService';
import type { UserData } from '../types/UserData';
import type { WorkerInbound, WorkerOutbound, ReplayedRun } from '../workers/simulation.worker';

export class SupersededError extends Error {
  constructor() {
    super('Simulation request superseded by a newer call');
    this.name = 'SupersededError';
  }
}

export class WorkerCrashedError extends Error {
  constructor(detail: string) {
    super(`Simulation worker crashed: ${detail}`);
    this.name = 'WorkerCrashedError';
  }
}

export interface RunOptions {
  forceInline?: boolean;       // bypass pool (used by tests)
  poolSize?: number;           // override pool size
}

const INLINE_THRESHOLD = 200;

type Pending = {
  requestId: number;
  resolve: (r: SimulationResult) => void;
  reject: (e: Error) => void;
  shardSummaries: (ShardSummary | null)[];
  userData: UserData;
};

interface ShardSummary {
  shardIndex: number;
  scores: Float64Array;
  failedFlags: Uint8Array;
  failedYears: Int16Array;
  pathColumns: Float64Array;
  totalYears: number;
  runsInShard: number;
}

class SimulationClient {
  private pool: Worker[] = [];
  private workerSupported: boolean | null = null;
  private nextRequestId = 1;
  private current: Pending | null = null;

  private resolvedPoolSize(override?: number): number {
    if (override && override > 0) return override;
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(2, Math.min(8, hc - 1));
  }

  private spawnWorker(): Worker | null {
    if (this.workerSupported === false) return null;
    if (typeof Worker === 'undefined') { this.workerSupported = false; return null; }
    try {
      const w = new Worker(
        new URL('../workers/simulation.worker.ts', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = (ev: MessageEvent<WorkerOutbound>) => this.handleWorkerMessage(ev.data);
      w.onerror = () => this.handlePoolCrash('worker onerror');
      this.workerSupported = true;
      return w;
    } catch {
      this.workerSupported = false;
      return null;
    }
  }

  private ensurePool(size: number): Worker[] | null {
    if (this.workerSupported === false) return null;
    while (this.pool.length < size) {
      const w = this.spawnWorker();
      if (!w) return null;
      this.pool.push(w);
    }
    // If pool is larger than needed (e.g., previous run used more shards), keep extras — cheap.
    return this.pool;
  }

  private terminatePool() {
    for (const w of this.pool) {
      try { w.terminate(); } catch { /* ignore */ }
    }
    this.pool = [];
  }

  private handlePoolCrash(detail: string) {
    const current = this.current;
    this.current = null;
    this.rejectAllReplays(new WorkerCrashedError(detail));
    this.terminatePool();
    if (current) current.reject(new WorkerCrashedError(detail));
  }

  private handleWorkerMessage(msg: WorkerOutbound) {
    const pending = this.current;
    if (!pending || msg.requestId !== pending.requestId) return; // superseded or stale

    if (msg.type === 'error') {
      this.current = null;
      pending.reject(new Error(msg.message));
      return;
    }

    if (msg.type === 'shardSummary') {
      pending.shardSummaries[msg.shardIndex] = {
        shardIndex: msg.shardIndex,
        scores: msg.scores,
        failedFlags: msg.failedFlags,
        failedYears: msg.failedYears,
        pathColumns: msg.pathColumns,
        totalYears: msg.totalYears,
        runsInShard: msg.runsInShard,
      };
      if (pending.shardSummaries.every((s) => s !== null)) {
        this.continueAfterShardSummaries(pending).catch((err) => {
          if (this.current === pending) this.current = null;
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
      return;
    }

    if (msg.type === 'replayResult') {
      // Handled inline in continueAfterShardSummaries via per-shard awaiters.
      // Stored on a side-channel resolver map.
      const entry = this.pendingReplays.get(msg.shardIndex);
      if (entry) {
        this.pendingReplays.delete(msg.shardIndex);
        entry.resolve(msg.runs);
      }
    }
  }

  private pendingReplays = new Map<number, { resolve: (runs: ReplayedRun[]) => void; reject: (e: Error) => void }>();

  private requestReplay(shardIndex: number, localRunIndices: number[]): Promise<ReplayedRun[]> {
    return new Promise<ReplayedRun[]>((resolve, reject) => {
      this.pendingReplays.set(shardIndex, { resolve, reject });
      const msg: WorkerInbound = {
        type: 'replay',
        requestId: this.current!.requestId,
        localRunIndices,
      };
      this.pool[shardIndex].postMessage(msg);
    });
  }

  private rejectAllReplays(err: Error) {
    for (const entry of this.pendingReplays.values()) entry.reject(err);
    this.pendingReplays.clear();
  }

  private async continueAfterShardSummaries(pending: Pending) {
    const summaries = pending.shardSummaries as ShardSummary[];
    const totalYears = summaries[0].totalYears;
    const totalRuns = summaries.reduce((sum, s) => sum + s.runsInShard, 0);

    // Concatenate scores + failed info across shards in canonical (shardIndex) order.
    const scores = new Float64Array(totalRuns);
    const failedFlags = new Uint8Array(totalRuns);
    const failedYears = new Int16Array(totalRuns);
    let writeIdx = 0;
    for (const s of summaries) {
      scores.set(s.scores, writeIdx);
      failedFlags.set(s.failedFlags, writeIdx);
      failedYears.set(s.failedYears, writeIdx);
      writeIdx += s.runsInShard;
    }

    // Success probability
    let successCount = 0;
    for (let i = 0; i < totalRuns; i++) if (!failedFlags[i]) successCount++;
    const probability = Math.round((successCount / totalRuns) * 100);

    // Sort global indices by score to find p50 / p10 reps.
    const order = new Int32Array(totalRuns);
    for (let i = 0; i < totalRuns; i++) order[i] = i;
    // JavaScript Array sort is stable since 2019. Convert for sort comparator.
    const orderArr = Array.from(order);
    orderArr.sort((a, b) => scores[a] - scores[b]);
    const medianGlobalIdx = orderArr[Math.floor(totalRuns * 0.5)];
    const downsideGlobalIdx = orderArr[Math.floor(totalRuns * 0.1)];

    // Map global indices back to (shardIndex, localRunIndex).
    const locate = (globalIdx: number): { shardIndex: number; localRunIndex: number } => {
      let acc = 0;
      for (let i = 0; i < summaries.length; i++) {
        const s = summaries[i];
        if (globalIdx < acc + s.runsInShard) {
          return { shardIndex: s.shardIndex, localRunIndex: globalIdx - acc };
        }
        acc += s.runsInShard;
      }
      throw new Error(`globalIdx ${globalIdx} out of range`);
    };
    const medianLoc = locate(medianGlobalIdx);
    const downsideLoc = locate(downsideGlobalIdx);

    // Percentile band: per year, concatenate the year-slice across shards and sort.
    let percentileBand: SimulationResult['percentileBand'] = null;
    let mcStats: SimulationResult['mcStats'] = null;
    if (totalRuns >= 10) {
      const p10Idx = Math.floor(totalRuns * 0.1);
      const p90Idx = Math.floor(totalRuns * 0.9);
      const p50Idx = Math.floor(totalRuns * 0.5);
      const p10 = new Array<number>(totalYears);
      const p90 = new Array<number>(totalYears);
      const colBuf = new Float64Array(totalRuns);
      for (let y = 0; y < totalYears; y++) {
        let off = 0;
        for (const s of summaries) {
          // pathColumns is year-major: slice [y * runsInShard, (y+1) * runsInShard)
          const startSlice = y * s.runsInShard;
          colBuf.set(s.pathColumns.subarray(startSlice, startSlice + s.runsInShard), off);
          off += s.runsInShard;
        }
        // In-place sort of Float64Array
        colBuf.sort();
        p10[y] = colBuf[p10Idx];
        p90[y] = colBuf[p90Idx];
      }
      percentileBand = { p10, p90 };

      // Ending balances + depletion ages
      const finals = new Float64Array(totalRuns);
      let off = 0;
      for (const s of summaries) {
        // last year of each run lives at pathColumns[(totalYears-1)*runsInShard + i]
        const baseEnd = (totalYears - 1) * s.runsInShard;
        for (let i = 0; i < s.runsInShard; i++) finals[off + i] = s.pathColumns[baseEnd + i];
        off += s.runsInShard;
      }
      finals.sort();

      const depletion = new Float64Array(totalRuns);
      for (let i = 0; i < totalRuns; i++) depletion[i] = failedFlags[i] ? failedYears[i] : Infinity;
      depletion.sort();
      const medianDepY = depletion[p50Idx];
      const worstDepY = depletion[p10Idx];

      mcStats = {
        medianEndingBalance: finals[p50Idx],
        p10EndingBalance: finals[p10Idx],
        medianDepletionAge: Number.isFinite(medianDepY) ? pending.userData.currentAge + medianDepY : null,
        worstDecileDepletionAge: Number.isFinite(worstDepY) ? pending.userData.currentAge + worstDepY : null,
      };
    }

    // Pass 2: request replay from the owning shards. Batch if both reps in same shard.
    const replayRequests = new Map<number, number[]>();
    const addReq = (loc: { shardIndex: number; localRunIndex: number }) => {
      const list = replayRequests.get(loc.shardIndex) ?? [];
      if (!list.includes(loc.localRunIndex)) list.push(loc.localRunIndex);
      replayRequests.set(loc.shardIndex, list);
    };
    addReq(medianLoc);
    addReq(downsideLoc);

    const replayResults = await Promise.all(
      Array.from(replayRequests.entries()).map(async ([shardIndex, indices]) => {
        const runs = await this.requestReplay(shardIndex, indices);
        return { shardIndex, runs };
      })
    );
    // Abort assembly if a newer run() superseded us during the replay await.
    if (this.current !== pending) return;

    const findReplayed = (shardIndex: number, localIdx: number): ReplayedRun => {
      const bucket = replayResults.find((r) => r.shardIndex === shardIndex);
      if (!bucket) throw new Error(`replay missing for shard ${shardIndex}`);
      const r = bucket.runs.find((rr) => rr.localRunIndex === localIdx);
      if (!r) throw new Error(`replay missing run ${localIdx} in shard ${shardIndex}`);
      return r;
    };
    const medianRun = findReplayed(medianLoc.shardIndex, medianLoc.localRunIndex);
    const downsideRun = findReplayed(downsideLoc.shardIndex, downsideLoc.localRunIndex);

    // Deterministic nominal on main thread.
    const det = runDeterministicProjection(pending.userData);
    const years = Array.from({ length: totalYears }, (_, i) => pending.userData.referenceYear + i);

    const result: SimulationResult = {
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
      nominal: det.path,
      nominalBreakdowns: det.breakdowns,
      nominalInflation: det.inflation,
      years,
      percentileBand,
      mcStats,
    };

    this.current = null;
    pending.resolve(result);
  }

  warmUp(): void {
    this.ensurePool(this.resolvedPoolSize());
  }

  terminate(): void {
    const current = this.current;
    this.current = null;
    this.rejectAllReplays(new SupersededError());
    this.terminatePool();
    if (current) current.reject(new SupersededError());
  }

  run(userData: UserData, options?: RunOptions): Promise<SimulationResult> {
    // Inline fallback for tests / environments without Worker.
    if (options?.forceInline) {
      try { return Promise.resolve(runSimulation(userData)); }
      catch (err) { return Promise.reject(err instanceof Error ? err : new Error(String(err))); }
    }

    const prepared = prepareUserData(userData);
    const effectiveRuns = getEffectiveNumRuns(prepared);
    const poolSize = this.resolvedPoolSize(options?.poolSize);

    // Inline fast path for tiny sims (historical_single = 1 run; historical_rolling
    // typically < 100 runs; or user-configured very low numSimulations).
    if (effectiveRuns < INLINE_THRESHOLD) {
      try { return Promise.resolve(runSimulation(userData)); }
      catch (err) { return Promise.reject(err instanceof Error ? err : new Error(String(err))); }
    }

    const pool = this.ensurePool(Math.min(poolSize, effectiveRuns));
    if (!pool) {
      // No worker support — fall back to inline.
      try { return Promise.resolve(runSimulation(userData)); }
      catch (err) { return Promise.reject(err instanceof Error ? err : new Error(String(err))); }
    }

    // Supersession: terminate prior run's pending Promise + kill the pool.
    // Respawn fresh workers so the new request starts cleanly. Worker module
    // bytecode is cached in the browser so respawn is ~5ms.
    if (this.current) {
      const prior = this.current;
      this.current = null;
      this.rejectAllReplays(new SupersededError());
      this.terminatePool();
      prior.reject(new SupersededError());
    }
    const freshPool = this.ensurePool(Math.min(poolSize, effectiveRuns));
    if (!freshPool) {
      try { return Promise.resolve(runSimulation(userData)); }
      catch (err) { return Promise.reject(err instanceof Error ? err : new Error(String(err))); }
    }

    const shardCount = Math.min(poolSize, effectiveRuns);
    const requestId = this.nextRequestId++;
    return new Promise<SimulationResult>((resolve, reject) => {
      const pending: Pending = {
        requestId, resolve, reject,
        shardSummaries: new Array(shardCount).fill(null),
        userData: prepared,
      };
      this.current = pending;
      for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
        const msg: WorkerInbound = { type: 'runShard', requestId, shardIndex, shardCount, userData: prepared };
        freshPool[shardIndex].postMessage(msg);
      }
    });
  }
}

export const simulationClient = new SimulationClient();

if (import.meta.hot) {
  import.meta.hot.dispose(() => simulationClient.terminate());
}
