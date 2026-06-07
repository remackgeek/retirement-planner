import { createContext, useState, useEffect, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import { CURRENT_SCHEMA_VERSION } from '../types/Scenario';
import { openDB } from 'idb';
import { confirmDialog } from 'primereact/confirmdialog';
import { Button } from 'primereact/button';
import {
  runMigrationPipeline,
  validateImportedScenario,
} from '../utils/scenarioMigration';

/**
 * Single-button acknowledgement dialog. PrimeReact's `confirmDialog` always
 * renders both an accept and a reject button; `reject: undefined` only drops the
 * callback, leaving a stray "No" button. A custom `footer` template replaces the
 * default two-button footer with one OK button.
 */
function infoDialog(message: string, header: string, icon: string) {
  confirmDialog({
    message,
    header,
    icon,
    footer: (options) => <Button label="OK" onClick={options.accept} autoFocus />,
  });
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
// renamed field) do NOT require a version bump — handle those in-band via the
// shared `runMigrationPipeline` in `../utils/scenarioMigration`. See CLAUDE.md
// "IndexedDB schema migrations" for the full pattern.
const DB_VERSION = 1;

// Shown in the AppContent banner when IndexedDB can't be opened or written —
// e.g. private/incognito mode, storage blocked by policy, or quota exhausted.
// The app stays usable for the session; the user just can't persist between visits.
export const PERSISTENCE_ERROR_MESSAGE =
  "Your browser is blocking local storage (this can happen in private/incognito mode). " +
  "You can still use YARP, but your scenarios won't be saved between visits.";

export const RetirementContext = createContext<{
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  loading: boolean;
  persistenceError: string | null;
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
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Run a DB operation, swallowing any open/read/write failure. On failure it
  // flips `persistenceError` (surfaced as a banner) and returns false instead of
  // throwing an unhandled rejection, so callers can still update in-memory state
  // and keep the session usable. Used by every write path below.
  const withDB = async (
    fn: (db: Awaited<ReturnType<typeof openDB>>) => Promise<void>
  ): Promise<boolean> => {
    try {
      const db = await openDB(dbName, DB_VERSION);
      await fn(db);
      return true;
    } catch (err) {
      console.error('Persistence error:', err);
      setPersistenceError(PERSISTENCE_ERROR_MESSAGE);
      return false;
    }
  };

  useEffect(() => {
    const initDB = async () => {
     try {
      const db = await openDB(dbName, DB_VERSION, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      const savedScenarios = (await db.getAll(storeName)) as Scenario[];
      let migratedCount = 0;
      let totalConversionsAdded = 0;
      let brokerageRenamedCount = 0;
      const finalScenarios: Scenario[] = [];
      for (const s of savedScenarios) {
        // Forward-compat guard: a record stamped with a newer schema version
        // than this build understands (e.g. after an app downgrade) is loaded
        // as-is and never re-persisted, so the older build can't corrupt it by
        // applying stale defaults. Skip the pipeline entirely for it.
        if (typeof s.schemaVersion === 'number' && s.schemaVersion > CURRENT_SCHEMA_VERSION) {
          console.warn(
            `Scenario "${s.name}" has schema v${s.schemaVersion}, newer than this app ` +
            `(v${CURRENT_SCHEMA_VERSION}). Loading without migration; not re-saving.`
          );
          finalScenarios.push(s);
          continue;
        }

        // Single shared pipeline (same as import): normalize defaults → run
        // content migrations → stamp schemaVersion. `migratedThisScenario`
        // gates the user-facing "Scenarios updated" toast — only content
        // migrations count. Normalization fixes and the schemaVersion stamp
        // persist silently (covered by `needsPersist`, never the toast).
        const result = runMigrationPipeline(s);
        const working = result.scenario;
        const migratedThisScenario =
          result.addedConversions > 0 || result.brokerageRenamed || result.spendingStripped;
        const needsPersist =
          migratedThisScenario || result.cashBucketConverted || result.normalized || result.stamped;

        if (result.addedConversions > 0) totalConversionsAdded += result.addedConversions;
        if (result.brokerageRenamed) brokerageRenamedCount += 1;

        if (needsPersist) {
          await db.put(storeName, working, working.id);
        }
        if (migratedThisScenario) {
          migratedCount += 1;
        }
        finalScenarios.push(working);
      }
      if (finalScenarios.length > 0) {
        setScenarios(finalScenarios);
        setActiveScenarioState(finalScenarios[0]); // Set first scenario as active
      }
      // If no scenarios exist, leave scenarios empty and activeScenario null

      if (migratedCount > 0) {
        const noun = migratedCount === 1 ? 'scenario' : 'scenarios';
        const parts: string[] = [];
        if (totalConversionsAdded > 0) {
          parts.push(
            `Migrated ${migratedCount} ${noun} from the old tax-strategy feature to first-class Roth Conversion events. ` +
            `${totalConversionsAdded} Roth conversion event${totalConversionsAdded === 1 ? '' : 's'} added — ` +
            `find them in the Income panel; chart badges will appear at conversion years.`
          );
        } else if (brokerageRenamedCount === 0) {
          parts.push(
            `Cleared the legacy tax-strategy field from ${migratedCount} ${noun}. ` +
            `No cached schedule was stored, so no Roth conversion events were created. ` +
            `Use the Roth Conversion dialog to plan a multi-year schedule.`
          );
        }
        if (brokerageRenamedCount > 0) {
          const brokNoun = brokerageRenamedCount === 1 ? 'scenario' : 'scenarios';
          parts.push(
            `Renamed "Taxable" accounts to "Brokerage" in ${brokerageRenamedCount} ${brokNoun}. ` +
            `No data was lost — only the type label changed.`
          );
        }
        infoDialog(parts.join(' '), 'Scenarios updated', 'pi pi-info-circle');
      }
     } catch (err) {
       // IndexedDB unavailable (private/incognito, blocked, quota). Render the
       // app anyway (empty/in-memory) and surface the banner; write paths use
       // `withDB` so later saves fail soft too.
       console.error('Failed to initialize local storage:', err);
       setPersistenceError(PERSISTENCE_ERROR_MESSAGE);
     } finally {
       setLoading(false);
     }
    };
    initDB();
  }, []);

  const addScenario = async (data: Scenario) => {
    const stamped: Scenario = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
    await withDB((db) => db.put(storeName, stamped, stamped.id).then(() => undefined));
    setScenarios([...scenarios, stamped]);
    setActiveScenarioState(stamped);
  };

  const updateScenario = async (data: Scenario) => {
    const stamped: Scenario = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
    await withDB((db) => db.put(storeName, stamped, stamped.id).then(() => undefined));
    setScenarios(
      scenarios.map((scenario) => (scenario.id === stamped.id ? stamped : scenario))
    );
    if (activeScenario?.id === stamped.id) {
      setActiveScenarioState(stamped);
    }
  };

  const deleteScenario = async (id: string) => {
    await withDB((db) => db.delete(storeName, id));
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
    const dataStr = JSON.stringify(
      { ...scenario, schemaVersion: CURRENT_SCHEMA_VERSION },
      null,
      2
    );
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

        // Structural validation (throws on the first problem found). Includes
        // the forward-compat guard, required portfolioAssumptions numbers, and
        // deep array-element checks — see scenarioMigration.ts.
        validateImportedScenario(importedData);

        // Clamp inflation to a sane range to defend Math.pow(1 + r, n) from
        // producing NaN with negative bases (caught by H3 review item).
        if (importedData.inflationRate <= -0.99) {
          importedData.inflationRate = -0.99;
        }
        if (!importedData.id) {
          importedData.id = crypto.randomUUID();
        }

        // Same shared pipeline as initDB load: normalize defaults, run content
        // migrations (legacy taxStrategy → events, taxable→brokerage, strip
        // spendingWithdrawalOrder), and stamp schemaVersion.
        const { scenario: migratedScenario, addedConversions } = runMigrationPipeline(importedData);
        importedData = migratedScenario;
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
              infoDialog(`Scenario imported successfully!${migrationNote}`, 'Success', 'pi pi-check');
            },
            reject: async () => {
              const copy = { ...importedData, id: crypto.randomUUID() };
              await addScenario(copy);
              setActiveScenarioState(copy);
              infoDialog(`Scenario imported as a new copy.${migrationNote}`, 'Success', 'pi pi-check');
            },
          });
        } else {
          await addScenario(importedData);
          setActiveScenarioState(importedData);
          infoDialog(`Scenario imported successfully!${migrationNote}`, 'Success', 'pi pi-check');
        }
      } catch (error: unknown) {
        console.error('Import failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Invalid file.';
        infoDialog(`Import failed: ${errorMessage}`, 'Error', 'pi pi-exclamation-triangle');
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
    const ok = await withDB(async (db) => {
      const scenario = await db.get(storeName, id);
      if (scenario) {
        setActiveScenarioState(scenario);
      }
    });
    // If persistence is unavailable, fall back to the in-memory copy so the
    // session can still switch scenarios.
    if (!ok) {
      const local = scenarios.find((s) => s.id === id);
      if (local) setActiveScenarioState(local);
    }
  };

  return (
    <RetirementContext.Provider
      value={{
        scenarios,
        activeScenario,
        loading,
        persistenceError,
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
