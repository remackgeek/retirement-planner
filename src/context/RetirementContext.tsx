/* eslint-disable react-refresh/only-export-components --
   Context object + provider in one file is idiomatic React; splitting them
   across files for HMR-only benefit isn't worth the importer churn. */
import { createContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import { CURRENT_SCHEMA_VERSION } from '../types/Scenario';
import { openDB } from 'idb';
import { confirmDialog } from 'primereact/confirmdialog';
import { Button } from 'primereact/button';
import {
  isFromNewerSchema,
  runMigrationPipeline,
  validateImportedScenario,
} from '../utils/scenarioMigration';
import { currentCalendarYear, rollScenarioToYear } from '../utils/rollScenarioYear';

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

/**
 * Drop the fields that are per-session DISPLAY CACHE rather than scenario data.
 * Today that's `lastSuccessProbability` (the sidebar's stable-% cache — see
 * CLAUDE.md). Every path that mints a *new* scenario identity (clone, export,
 * example load) must strip it, or a stale % rides along to a scenario whose
 * inputs it was never computed from. One helper so a future display-only field
 * only has to be added here.
 */
const stripDisplayCache = <T extends Scenario>(scenario: T): T => {
  const { lastSuccessProbability: _displayCache, ...rest } = scenario;
  return rest as T;
};

/**
 * Mint a NEW scenario identity from an existing one: deep copy, fresh id, given
 * name, display cache stripped. The single recipe behind Clone and the
 * "Clone & update" plan-year flow. structuredClone (not a JSON round-trip)
 * preserves `undefined`-valued optional fields — see the What If snapshot note
 * in AppContent for why the JSON pattern is a footgun.
 */
const newScenarioFrom = (source: Scenario, name: string): Scenario =>
  stripDisplayCache({
    ...structuredClone(source),
    id: crypto.randomUUID(),
    name,
  });

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
  /**
   * Explicit "Update to current year" (see `utils/rollScenarioYear`). The ONLY
   * path that changes a scenario's `referenceYear`; nothing rolls implicitly.
   * `'in_place'` rewrites the scenario; `'clone'` leaves it untouched as a
   * checkpoint and adds an updated copy (which becomes active). No-op when the
   * scenario is not behind the calendar. `toYear` is the year the confirm
   * previewed (defaults to the calendar year) so what was shown is what is
   * applied.
   */
  updateScenarioToCurrentYear: (id: string, mode: 'in_place' | 'clone', toYear?: number) => Promise<void>;
} | null>(null);

export const RetirementProvider = ({ children }: { children: ReactNode }) => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenarioState] = useState<Scenario | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Synchronous mirror of `scenarios`. The setters below are async and often
  // called sequentially from a single closure (`await cloneScenario(); await
  // updateScenario();`) or from long-lived closures (the import file-picker's
  // onchange, the MC probability write-back). Deriving the next state from the
  // render-time `scenarios` snapshot in those paths loses writes — so every
  // write goes through `commitScenarios` (which updates the ref first, then
  // mirrors to React state) and every read inside a setter uses
  // `scenariosRef.current`.
  const scenariosRef = useRef<Scenario[]>([]);
  const commitScenarios = (
    updater: (prev: Scenario[]) => Scenario[]
  ): Scenario[] => {
    scenariosRef.current = updater(scenariosRef.current);
    setScenarios(scenariosRef.current);
    return scenariosRef.current;
  };

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
      let cashBucketRepairedCount = 0;
      // Keyed by object identity, not id: a record malformed enough to throw
      // may also be missing its `id`, and `Set<undefined>` would then wrongly
      // tar every other id-less record. `finalScenarios` holds exactly these
      // object references, so identity is precise.
      const unmigrated = new Set<Scenario>();
      const finalScenarios: Scenario[] = [];
      for (const s of savedScenarios) {
        // Forward-compat guard: a record stamped with a newer schema version
        // than this build understands (e.g. after an app downgrade) is loaded
        // as-is and never re-persisted, so the older build can't corrupt it by
        // applying stale defaults. Skip the pipeline entirely for it.
        if (isFromNewerSchema(s)) {
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
        //
        // Per-record guard: a malformed record whose migration throws must not
        // brick the whole load (it would drop every scenario for the session).
        // Load it raw instead — no re-persist — and keep going.
        let result: ReturnType<typeof runMigrationPipeline>;
        try {
          result = runMigrationPipeline(s);
        } catch (err) {
          // Load it raw so the user can still see/delete it, but remember that
          // it never got normalized: it may be missing fields the engine and
          // chart dereference. Auto-ACTIVATING such a record would run the
          // synchronous fast preview against it and throw straight into the
          // app-wide ErrorBoundary — a full-screen crash on every load, with no
          // way to reach the sidebar and remove it.
          console.error(
            `Failed to migrate scenario "${s?.name ?? s?.id}"; loading it unmigrated:`,
            err
          );
          unmigrated.add(s);
          finalScenarios.push(s);
          continue;
        }
        const working = result.scenario;
        const migratedThisScenario =
          result.addedConversions > 0 ||
          result.brokerageRenamed ||
          result.spendingStripped ||
          result.cashBucketRepaired;
        const needsPersist =
          migratedThisScenario || result.cashBucketConverted || result.normalized || result.stamped;

        if (result.addedConversions > 0) totalConversionsAdded += result.addedConversions;
        if (result.brokerageRenamed) brokerageRenamedCount += 1;
        if (result.cashBucketRepaired) cashBucketRepairedCount += 1;

        if (needsPersist) {
          await db.put(storeName, working, working.id);
        }
        if (migratedThisScenario) {
          migratedCount += 1;
        }
        finalScenarios.push(working);
      }
      if (finalScenarios.length > 0) {
        scenariosRef.current = finalScenarios; // keep the sync mirror consistent
        setScenarios(finalScenarios);
        // Activate the first scenario that survived migration. A record that
        // threw is listed but never auto-selected (see the catch above); if
        // EVERY record failed, stay on the empty state rather than crashing —
        // the user can still delete them from the sidebar.
        const firstHealthy = finalScenarios.find((sc) => !unmigrated.has(sc));
        setActiveScenarioState(firstHealthy ?? null);
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
        } else if (brokerageRenamedCount === 0 && cashBucketRepairedCount === 0) {
          parts.push(
            `Cleared the legacy tax-strategy field from ${migratedCount} ${noun}. ` +
            `No cached schedule was stored, so no Roth conversion events were created. ` +
            `Use the Roth Conversion dialog to plan a multi-year schedule.`
          );
        }
        if (cashBucketRepairedCount > 0) {
          const cashNoun = cashBucketRepairedCount === 1 ? 'scenario' : 'scenarios';
          parts.push(
            `Corrected the cash-bucket minimum / target / maximum in ${cashBucketRepairedCount} ${cashNoun}. ` +
            `An earlier version converted those thresholds from months to dollars against a spending ` +
            `figure that was 12× too large, so the amounts were far higher than intended. ` +
            `Please review them under Settings → Cash Bucket.`
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

  // Forward-compat write guard: a scenario stamped with a newer schema version
  // than this build understands must never be re-stamped/persisted — that would
  // downgrade its schemaVersion and corrupt it (e.g. the automatic MC
  // probability write-back after merely activating it). Returns true when the
  // write must be skipped.
  //
  // Refusing SILENTLY is not acceptable: the user can open the scenario dialog,
  // edit, and hit Save with the dialog closing normally while every change is
  // dropped (and "Clone" appears to do nothing, since cloneScenario routes
  // through addScenario). So the first refusal per scenario raises a dialog.
  // Only the first — the automatic ~1s probability write-back retries
  // constantly while such a scenario is active, and a dialog per tick would be
  // unusable.
  const warnedNewerSchemaIds = useRef(new Set<string>());
  const isFromNewerBuild = (data: Scenario): boolean => {
    if (!isFromNewerSchema(data)) return false;
    console.warn(
      `Ignoring write to scenario "${data.name}": its schema v${data.schemaVersion} ` +
      `is newer than this app (v${CURRENT_SCHEMA_VERSION}). Update the app to edit it.`
    );
    if (!warnedNewerSchemaIds.current.has(data.id)) {
      warnedNewerSchemaIds.current.add(data.id);
      infoDialog(
        `"${data.name}" was created by a newer version of YARP (schema v${data.schemaVersion}; ` +
        `this app understands v${CURRENT_SCHEMA_VERSION}). It is read-only here — changes to it, ` +
        `including copies, will not be saved. Update the app to edit it.`,
        'Scenario is read-only',
        'pi pi-exclamation-triangle'
      );
    }
    return true;
  };

  const addScenario = async (data: Scenario) => {
    if (isFromNewerBuild(data)) return;
    const stamped: Scenario = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
    await withDB((db) => db.put(storeName, stamped, stamped.id).then(() => undefined));
    commitScenarios((prev) => [...prev, stamped]);
    setActiveScenarioState(stamped);
  };

  const updateScenario = async (data: Scenario) => {
    if (isFromNewerBuild(data)) return;
    const stamped: Scenario = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
    await withDB((db) => db.put(storeName, stamped, stamped.id).then(() => undefined));
    commitScenarios((prev) =>
      prev.map((scenario) => (scenario.id === stamped.id ? stamped : scenario))
    );
    setActiveScenarioState((prev) => (prev?.id === stamped.id ? stamped : prev));
  };

  const deleteScenario = async (id: string) => {
    await withDB((db) => db.delete(storeName, id));
    const updatedScenarios = commitScenarios((prev) =>
      prev.filter((scenario) => scenario.id !== id)
    );
    setActiveScenarioState((prev) =>
      prev?.id === id
        ? updatedScenarios.length > 0
          ? updatedScenarios[0]
          : null
        : prev
    );
  };

  const exportScenario = async (id: string) => {
    const scenario = scenariosRef.current.find((s) => s.id === id);
    if (!scenario) return;
    // Keep a newer-build schemaVersion intact (never downgrade the stamp on
    // export); the display cache never belongs in the file.
    const dataStr = JSON.stringify(
      {
        ...stripDisplayCache(scenario),
        schemaVersion: Math.max(scenario.schemaVersion ?? 0, CURRENT_SCHEMA_VERSION),
      },
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

        // Read through the sync mirror — this onchange closure was created at
        // render time and may be firing long after `scenarios` went stale.
        const existingIndex = scenariosRef.current.findIndex((s) => s.id === importedData.id);

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
    const source = scenariosRef.current.find((s) => s.id === id);
    if (!source) return;
    await addScenario(newScenarioFrom(source, name));
  };

  const updateScenarioToCurrentYear = async (
    id: string,
    mode: 'in_place' | 'clone',
    toYear: number = currentCalendarYear(),
  ) => {
    const source = scenariosRef.current.find((s) => s.id === id);
    if (!source) return;
    const { scenario: rolled, changes } = rollScenarioToYear(source, toYear);
    if (!changes) return;
    if (mode === 'in_place') {
      // The sim inputs changed, so the cached sidebar % no longer describes
      // this configuration — strip it (the row shows '—' until the next MC).
      // updateScenario carries the newer-schema read-only guard.
      await updateScenario(stripDisplayCache(rolled));
      return;
    }
    // Checkpoint flow: the original stays exactly as saved; the rolled copy is a
    // new scenario identity (addScenario makes it active).
    await addScenario(newScenarioFrom(rolled, `${source.name} (${changes.toYear})`));
  };

  const loadExampleScenario = async (template: Omit<Scenario, 'id'>) => {
    const scenario: Scenario = stripDisplayCache({
      ...structuredClone(template) as Omit<Scenario, 'id'>,
      id: crypto.randomUUID(),
      // Templates are module-level constants; stamp the plan year at LOAD time
      // so an example opened after a New Year isn't born stale.
      referenceYear: currentCalendarYear(),
    } as Scenario);
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
    // session can still switch scenarios (read through the sync mirror — the
    // render-time `scenarios` snapshot may be stale by the time this runs).
    if (!ok) {
      const local = scenariosRef.current.find((s) => s.id === id);
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
        updateScenarioToCurrentYear,
      }}
    >
      {children}
    </RetirementContext.Provider>
  );
};
