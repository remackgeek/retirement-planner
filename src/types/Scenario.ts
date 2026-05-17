import type { UserData } from "./UserData";

export interface Scenario extends UserData {
  id: string;
  name: string;
  /**
   * Last computed Monte Carlo success probability (0-100). **Sidebar display
   * only** — do NOT read this anywhere else. Simulation, chart, CSV export,
   * scenario JSON export, and tests must never depend on or consume this value.
   * It exists purely to avoid re-running 5000-sim Monte Carlo for every
   * scenario in the sidebar list. Undefined = never computed.
   */
  lastSuccessProbability?: number;
}
