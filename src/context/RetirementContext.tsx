import { createContext, useState, useEffect, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import type { IncomeEvent, IncomeEventGeneratedBy } from '../types/IncomeEvent';
import { openDB } from 'idb';
import { confirmDialog } from 'primereact/confirmdialog';

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

declare global {
  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream {
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }

  interface Window {
    showSaveFilePicker(
      options?: SaveFilePickerOptions
    ): Promise<FileSystemFileHandle>;
  }
}

const dbName = 'RetirementPlanner';
const storeName = 'scenarios';
// IndexedDB schema version. Bump this AND add a branch to the `upgrade`
// callback when making a *structural* change (new object store, new index,
// renamed key). Content-level changes inside a stored Scenario (new field,
// renamed field) do NOT require a version bump — handle those in-band on
// load, e.g. `migrateLegacyTaxStrategy` below. See CLAUDE.md
// "IndexedDB schema migrations" for the full pattern.
const DB_VERSION = 1;

export const RetirementContext = createContext<{
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  loading: boolean;
  addScenario: (data: Scenario) => Promise<void>;
  updateScenario: (data: Scenario) => Promise<void>;
  deleteScenario: (id: string) => Promise<void>;
  cloneScenario: (id: string, name: string) => Promise<void>;
  exportScenario: (id: string) => Promise<void>;
  importScenario: () => void;
  loadExampleScenario: (template: Omit<Scenario, 'id'>) => Promise<void>;
  setActiveScenario: (id: string) => Promise<void>;
} | null>(null);

export const RetirementProvider = ({ children }: { children: ReactNode }) => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenarioState] = useState<Scenario | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initDB = async () => {
      const db = await openDB(dbName, DB_VERSION, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      const savedScenarios = (await db.getAll(storeName)) as Scenario[];
      let migratedCount = 0;
      let totalConversionsAdded = 0;
      const finalScenarios: Scenario[] = [];
      for (const s of savedScenarios) {
        // Legacy taxStrategy field probe — type cast to handle scenarios saved
        // before the field was removed from the Scenario type.
        if ((s as unknown as { taxStrategy?: unknown }).taxStrategy) {
          const { scenario: migrated, addedConversions } = migrateLegacyTaxStrategy(s);
          await db.put(storeName, migrated, migrated.id);
          finalScenarios.push(migrated);
          migratedCount += 1;
          totalConversionsAdded += addedConversions;
        } else {
          finalScenarios.push(s);
        }
      }
      if (finalScenarios.length > 0) {
        setScenarios(finalScenarios);
        setActiveScenarioState(finalScenarios[0]); // Set first scenario as active
      }
      // If no scenarios exist, leave scenarios empty and activeScenario null
      setLoading(false);

      if (migratedCount > 0) {
        const noun = migratedCount === 1 ? 'scenario' : 'scenarios';
        const message = totalConversionsAdded > 0
          ? `Migrated ${migratedCount} ${noun} from the old tax-strategy feature to first-class Roth Conversion events. ` +
            `${totalConversionsAdded} Roth conversion event${totalConversionsAdded === 1 ? '' : 's'} added — ` +
            `find them in the Income panel; chart badges will appear at conversion years.`
          : `Cleared the legacy tax-strategy field from ${migratedCount} ${noun}. ` +
            `No cached schedule was stored, so no Roth conversion events were created. ` +
            `Use the Roth Conversion dialog to plan a multi-year schedule.`;
        confirmDialog({
          message,
          header: 'Scenarios updated',
          icon: 'pi pi-info-circle',
          acceptLabel: 'OK',
          reject: undefined,
        });
      }
    };
    initDB();
  }, []);

  const addScenario = async (data: Scenario) => {
    const db = await openDB(dbName, DB_VERSION);
    await db.put(storeName, data, data.id);
    setScenarios([...scenarios, data]);
    setActiveScenarioState(data);
  };

  const updateScenario = async (data: Scenario) => {
    const db = await openDB(dbName, DB_VERSION);
    await db.put(storeName, data, data.id);
    setScenarios(
      scenarios.map((scenario) => (scenario.id === data.id ? data : scenario))
    );
    if (activeScenario?.id === data.id) {
      setActiveScenarioState(data);
    }
  };

  const deleteScenario = async (id: string) => {
    const db = await openDB(dbName, DB_VERSION);
    await db.delete(storeName, id);
    const updatedScenarios = scenarios.filter((scenario) => scenario.id !== id);
    setScenarios(updatedScenarios);
    if (activeScenario?.id === id) {
      setActiveScenarioState(
        updatedScenarios.length > 0 ? updatedScenarios[0] : null
      );
    }
  };

  const exportScenario = async (id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) return;
    const dataStr = JSON.stringify(scenario, null, 2);
    const suggestedName = `${scenario.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(dataStr);
        await writable.close();
      } catch (err: unknown) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error('Export failed:', err);
        }
      }
    } else {
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const importScenario = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let importedData = JSON.parse(text) as Scenario;

        if (!importedData.name || typeof importedData.currentAge !== 'number') {
          throw new Error('Invalid scenario: Missing name or currentAge.');
        }
        if (typeof importedData.lifeExpectancy !== 'number' || importedData.lifeExpectancy < importedData.currentAge) {
          throw new Error('Invalid scenario: lifeExpectancy must be a number ≥ currentAge.');
        }
        if (typeof importedData.referenceYear !== 'number') {
          throw new Error('Invalid scenario: referenceYear must be a number.');
        }
        if (typeof importedData.inflationRate !== 'number') {
          throw new Error('Invalid scenario: inflationRate must be a number.');
        }
        // Clamp inflation to a sane range to defend Math.pow(1 + r, n) from
        // producing NaN with negative bases (caught by H3 review item).
        if (importedData.inflationRate <= -0.99) {
          importedData.inflationRate = -0.99;
        }
        const validFilings = new Set(['single', 'mfs', 'mfj', 'hoh']);
        if (!validFilings.has(importedData.filingStatus)) {
          throw new Error(`Invalid scenario: filingStatus must be one of single/mfs/mfj/hoh (got "${importedData.filingStatus}").`);
        }
        if (!Array.isArray(importedData.incomeEvents)) {
          throw new Error('Invalid scenario: incomeEvents must be an array.');
        }
        if (!Array.isArray(importedData.spendingGoals)) {
          throw new Error('Invalid scenario: spendingGoals must be an array.');
        }
        if (!Array.isArray(importedData.stateTimeline) || importedData.stateTimeline.length === 0) {
          throw new Error('Invalid scenario: stateTimeline must be a non-empty array.');
        }
        for (const entry of importedData.stateTimeline) {
          if (!entry || typeof entry.state !== 'string' || entry.state.length === 0) {
            throw new Error('Invalid scenario: every stateTimeline entry must have a non-empty state name.');
          }
        }
        if (!importedData.simulationSettings || typeof importedData.simulationSettings.numSimulations !== 'number') {
          throw new Error('Invalid scenario: simulationSettings.numSimulations must be a number.');
        }
        // E1: a zero or negative numSimulations would crash runSimulation
        // (division by zero in probability, undefined deref in pickRepresentatives).
        // Reject loudly at import rather than blowing up on the first MC tick.
        if (!Number.isFinite(importedData.simulationSettings.numSimulations) || importedData.simulationSettings.numSimulations < 1) {
          throw new Error('Invalid scenario: simulationSettings.numSimulations must be at least 1.');
        }
        if (!Array.isArray(importedData.accounts)) {
          throw new Error('Invalid scenario: Missing accounts array.');
        }
        // Backfill per-account allocation for scenarios created before this feature.
        for (const account of importedData.accounts) {
          if (typeof account.stockAllocation !== 'number') account.stockAllocation = 0.6;
          if (!account.portfolioBalance) account.portfolioBalance = '60_40';
        }
        if (typeof importedData.longTermCapGainsRate !== 'number') {
          importedData.longTermCapGainsRate = 0.15;
        }
        const pa = importedData.portfolioAssumptions;
        if (!pa || typeof pa.stockReturn !== 'number' || typeof pa.bondReturn !== 'number') {
          throw new Error('Invalid scenario: Missing or invalid portfolioAssumptions fields.');
        }
        if (typeof pa.stockBondCorrelationEnabled !== 'boolean') {
          pa.stockBondCorrelationEnabled = false;
        }
        if (typeof pa.stockBondCorrelation !== 'number') {
          pa.stockBondCorrelation = -0.2;
        }
        pa.stockBondCorrelation = Math.max(-1, Math.min(1, pa.stockBondCorrelation));
        if (pa.returnDistribution !== 'student_t') {
          pa.returnDistribution = 'lognormal';
        }
        if (typeof pa.degreesOfFreedom !== 'number') {
          pa.degreesOfFreedom = 4;
        }
        pa.degreesOfFreedom = Math.max(3, Math.min(12, Math.round(pa.degreesOfFreedom)));
        if (pa.returnModel !== 'historical_single' && pa.returnModel !== 'historical_rolling') {
          pa.returnModel = 'parametric';
        }
        if (pa.historicalWrapEnabled !== undefined && typeof pa.historicalWrapEnabled !== 'boolean') {
          pa.historicalWrapEnabled = false;
        }
        if (pa.blackSwanEvents !== undefined && !Array.isArray(pa.blackSwanEvents)) {
          pa.blackSwanEvents = [];
        }
        if (typeof importedData.inflationStdDev !== 'number') {
          importedData.inflationStdDev = 0;
        }

        if (!importedData.id) {
          importedData.id = crypto.randomUUID();
        }

        // Same one-shot migration as initDB: convert legacy taxStrategy.cachedVector
        // into visible roth_conversion events before persisting.
        const { scenario: migratedImport, addedConversions } = migrateLegacyTaxStrategy(importedData);
        importedData = migratedImport;
        const migrationNote = addedConversions > 0
          ? ` This scenario used the old tax-strategy feature; ${addedConversions} Roth conversion event${addedConversions === 1 ? '' : 's'} ${addedConversions === 1 ? 'was' : 'were'} migrated into the Income panel.`
          : '';

        const existingIndex = scenarios.findIndex((s) => s.id === importedData.id);

        if (existingIndex !== -1) {
          confirmDialog({
            message: `"${importedData.name}" already exists. Overwrite it or import as a separate copy?`,
            header: 'Scenario Already Exists',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Overwrite',
            rejectLabel: 'Import as Copy',
            accept: async () => {
              await updateScenario(importedData);
              setActiveScenarioState(importedData);
              confirmDialog({
                message: `Scenario imported successfully!${migrationNote}`,
                header: 'Success',
                icon: 'pi pi-check',
                acceptLabel: 'OK',
                reject: undefined,
              });
            },
            reject: async () => {
              const copy = { ...importedData, id: crypto.randomUUID() };
              await addScenario(copy);
              setActiveScenarioState(copy);
              confirmDialog({
                message: `Scenario imported as a new copy.${migrationNote}`,
                header: 'Success',
                icon: 'pi pi-check',
                acceptLabel: 'OK',
                reject: undefined,
              });
            },
          });
        } else {
          await addScenario(importedData);
          setActiveScenarioState(importedData);
          confirmDialog({
            message: `Scenario imported successfully!${migrationNote}`,
            header: 'Success',
            icon: 'pi pi-check',
            acceptLabel: 'OK',
            reject: undefined,
          });
        }
      } catch (error: unknown) {
        console.error('Import failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Invalid file.';
        confirmDialog({
          message: `Import failed: ${errorMessage}`,
          header: 'Error',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'OK',
          reject: undefined,
        });
      }
    };
    input.click();
  };

  const cloneScenario = async (id: string, name: string) => {
    const source = scenarios.find((s) => s.id === id);
    if (!source) return;
    const clone: Scenario = {
      ...(JSON.parse(JSON.stringify(source)) as Scenario),
      id: crypto.randomUUID(),
      name,
      lastSuccessProbability: undefined,
    };
    await addScenario(clone);
  };

  const loadExampleScenario = async (template: Omit<Scenario, 'id'>) => {
    const scenario: Scenario = {
      ...structuredClone(template) as Omit<Scenario, 'id'>,
      id: crypto.randomUUID(),
      lastSuccessProbability: undefined,
    };
    await addScenario(scenario);
  };

  const setActiveScenario = async (id: string) => {
    const db = await openDB(dbName, DB_VERSION);
    const scenario = await db.get(storeName, id);
    if (scenario) {
      setActiveScenarioState(scenario);
    }
  };

  return (
    <RetirementContext.Provider
      value={{
        scenarios,
        activeScenario,
        loading,
        addScenario,
        updateScenario,
        deleteScenario,
        cloneScenario,
        exportScenario,
        importScenario,
        loadExampleScenario,
        setActiveScenario,
      }}
    >
      {children}
    </RetirementContext.Provider>
  );
};
