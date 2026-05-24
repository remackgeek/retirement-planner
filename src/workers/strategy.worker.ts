// Strategy compute Web Worker.
//
// Runs the wizard's compute backends off the main thread so the UI stays
// responsive during Optimize's ~3–7 s coordinate descent. Single-request
// protocol (no sharding, no replay phase): caller posts one message, worker
// posts one result. Cancellation is termination-and-respawn, managed by the
// `StrategyComputeClient` on the main thread.
//
// Engine modules (`SimulationService`, `TaxCalculator`, …) have no DOM
// dependencies, so they import cleanly here — same property the MC pool
// relies on.

import type { UserData } from '../types/UserData';
import type { TaxStrategy, PerYearStrategyDecision } from '../services/strategies/types';
import { computeFillToBracketSchedule } from '../services/strategies/FillToBracketStrategy';
import { computeAutoBracketSchedule, type AutoBracketResult } from '../services/strategies/AutoBracketStrategy';
import { runOptimization, type OptimizeResult } from '../services/strategies/OptimizeStrategy';

export type StrategyWorkerInbound = {
  type: 'compute';
  requestId: number;
  kind: 'fill_to_bracket' | 'auto_bracket' | 'optimize';
  userData: UserData;
  taxStrategy: TaxStrategy;
};

export type StrategyWorkerOutbound =
  | { type: 'fillResult'; requestId: number; result: PerYearStrategyDecision[] }
  | { type: 'autoResult'; requestId: number; result: AutoBracketResult }
  | { type: 'optimizeResult'; requestId: number; result: OptimizeResult }
  | { type: 'error'; requestId: number; message: string };

self.onmessage = (ev: MessageEvent<StrategyWorkerInbound>) => {
  const msg = ev.data;
  if (msg.type !== 'compute') return;
  try {
    if (msg.kind === 'fill_to_bracket') {
      const result = computeFillToBracketSchedule(msg.userData, msg.taxStrategy);
      const out: StrategyWorkerOutbound = { type: 'fillResult', requestId: msg.requestId, result };
      (self as unknown as Worker).postMessage(out);
    } else if (msg.kind === 'auto_bracket') {
      const result = computeAutoBracketSchedule(msg.userData, msg.taxStrategy);
      const out: StrategyWorkerOutbound = { type: 'autoResult', requestId: msg.requestId, result };
      (self as unknown as Worker).postMessage(out);
    } else if (msg.kind === 'optimize') {
      const result = runOptimization(msg.userData, msg.taxStrategy);
      const out: StrategyWorkerOutbound = { type: 'optimizeResult', requestId: msg.requestId, result };
      (self as unknown as Worker).postMessage(out);
    }
  } catch (err) {
    const out: StrategyWorkerOutbound = {
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(out);
  }
};
