import type { UserData } from "./UserData";

/**
 * Content-schema version stamped onto every persisted/exported Scenario.
 * Distinct from `DB_VERSION` in RetirementContext (the IndexedDB *structural*
 * version — object stores/indexes). Bump this when the Scenario/UserData
 * *content* shape changes in a way that needs an ordered migration, and add the
 * matching `MIGRATORS[<old version>]` entry in `utils/scenarioMigration.ts`.
 *
 * - v1 — the shape produced by the inference migrations + `normalizeScenario`.
 * - v2 — repairs the 12×-inflated `cashBucketPolicy` band written by the
 *   released months→dollars migration (`MIGRATORS[1]`).
 */
export const CURRENT_SCHEMA_VERSION = 2;

export interface Scenario extends UserData {
  id: string;
  name: string;
  /**
   * Content-schema version (see {@link CURRENT_SCHEMA_VERSION}). Optional:
   * `undefined` on records/exports created before versioning was introduced
   * ("legacy"). Stamped to the current version on every write and on load.
   */
  schemaVersion?: number;
  /**
   * Last computed Monte Carlo success probability (0-100). **Sidebar display
   * only** — do NOT read this anywhere else. Simulation, chart, CSV export,
   * scenario JSON export, and tests must never depend on or consume this value.
   * It exists purely to avoid re-running 5000-sim Monte Carlo for every
   * scenario in the sidebar list. Undefined = never computed.
   */
  lastSuccessProbability?: number;
}
