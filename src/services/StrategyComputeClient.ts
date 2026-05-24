// Promise-based client for the Roth Conversion generator's compute backends.
//
// Architecture: single Web Worker, lazy-spawned. One request in flight at a
// time. Cancellation = terminate + respawn on next call (mirrors
// `SimulationClient`). Optimize takes 3–7s on a 30-year scenario; running it
// on the main thread freezes the UI, so the wizard dispatches through here.
//
// Inline fallback: when `Worker` is unavailable (older test environments,
// older browsers) the client falls back to running the compute backend
// synchronously on the calling thread — wrong for UX, correct for tests.

import type { UserData } from '../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision } from './strategies/types';
import { computeFillToBracketSchedule } from './strategies/FillToBracketStrategy';
import { computeAutoBracketSchedule, type AutoBracketResult } from './strategies/AutoBracketStrategy';
import { runOptimization, type OptimizeResult } from './strategies/OptimizeStrategy';
import type { StrategyWorkerInbound, StrategyWorkerOutbound } from '../workers/strategy.worker';

export class StrategyCancelledError extends Error {
  constructor() {
    super('Strategy compute cancelled');
    this.name = 'StrategyCancelledError';
  }
}

type Pending = {
  requestId: number;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

class StrategyComputeClient {
  private worker: Worker | null = null;
  private workerSupported: boolean | null = null;
  private nextRequestId = 1;
  private current: Pending | null = null;

  private spawnWorker(): Worker | null {
    if (this.workerSupported === false) return null;
    if (typeof Worker === 'undefined') {
      this.workerSupported = false;
      return null;
    }
    try {
      const w = new Worker(
        new URL('../workers/strategy.worker.ts', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = (ev: MessageEvent<StrategyWorkerOutbound>) => this.handleMessage(ev.data);
      w.onerror = (ev) => {
        const detail = ev.message || 'worker error';
        const pending = this.current;
        this.current = null;
        this.terminate();
        if (pending) pending.reject(new Error(detail));
      };
      this.workerSupported = true;
      return w;
    } catch {
      this.workerSupported = false;
      return null;
    }
  }

  private terminate() {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
  }

  private handleMessage(msg: StrategyWorkerOutbound) {
    const pending = this.current;
    if (!pending || msg.requestId !== pending.requestId) return; // superseded
    this.current = null;
    if (msg.type === 'error') {
      pending.reject(new Error(msg.message));
      return;
    }
    // result types: fill / auto / optimize — each carries `result`.
    pending.resolve(msg.result);
  }

  /** Pre-spawn the worker so the first user-initiated Compute click pays no
   *  cold-start cost (worker module bytecode is cached by the browser
   *  afterward). Mirrors `simulationClient.warmUp()`. Safe to call multiple
   *  times — only the first call actually spawns. */
  warmUp(): void {
    if (!this.worker) this.worker = this.spawnWorker();
  }

  /** Cancel any in-flight compute. Rejects the pending promise with
   *  `StrategyCancelledError` and terminates the worker. Next compute call
   *  will spawn a fresh worker. */
  cancel(): void {
    const pending = this.current;
    this.current = null;
    this.terminate();
    if (pending) pending.reject(new StrategyCancelledError());
  }

  private async dispatch<T>(kind: StrategyWorkerInbound['kind'], userData: UserData, taxStrategy: TaxStrategy, inlineRun: () => T): Promise<T> {
    // Cancel any in-flight request before starting a new one.
    if (this.current) this.cancel();

    // Lazy-spawn. If the worker isn't supported, fall back to inline.
    if (!this.worker) {
      this.worker = this.spawnWorker();
    }
    if (!this.worker) {
      // Inline path — synchronous on the calling thread. Used by tests and
      // by environments without Worker support.
      return inlineRun();
    }

    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.current = {
        requestId,
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      // Strip `meta` provenance from incomeEvents — compute backends never
      // read it, and structured-cloning meta objects across the worker
      // boundary is wasteful (R7). Original userData in React state is
      // unchanged.
      const leanUserData: UserData = {
        ...userData,
        incomeEvents: userData.incomeEvents.map((e) =>
          e.meta === undefined ? e : { ...e, meta: undefined }
        ),
      };
      const msg: StrategyWorkerInbound = { type: 'compute', requestId, kind, userData: leanUserData, taxStrategy };
      this.worker!.postMessage(msg);
    });
  }

  computeFill(userData: UserData, taxStrategy: TaxStrategy): Promise<PerYearStrategyDecision[]> {
    return this.dispatch('fill_to_bracket', userData, taxStrategy, () =>
      computeFillToBracketSchedule(userData, taxStrategy)
    );
  }

  computeAuto(userData: UserData, taxStrategy: TaxStrategy): Promise<AutoBracketResult> {
    return this.dispatch('auto_bracket', userData, taxStrategy, () =>
      computeAutoBracketSchedule(userData, taxStrategy)
    );
  }

  optimize(userData: UserData, taxStrategy: TaxStrategy): Promise<OptimizeResult> {
    return this.dispatch('optimize', userData, taxStrategy, () =>
      runOptimization(userData, taxStrategy)
    );
  }
}

export const strategyComputeClient = new StrategyComputeClient();
