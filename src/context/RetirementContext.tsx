import { createContext, useState, useEffect, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import { openDB } from 'idb';
import ExportScenarioDialog from '../dialogs/ExportScenarioDialog';

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

export const RetirementContext = createContext<{
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  loading: boolean;
  addScenario: (data: Scenario) => Promise<void>;
  updateScenario: (data: Scenario) => Promise<void>;
  deleteScenario: (id: string) => Promise<void>;
  exportScenario: (id: string) => void;
  setActiveScenario: (id: string) => Promise<void>;
} | null>(null);

const migrateScenario = (scenario: any): Scenario => {
  // Add default tax fields if missing
  if (!scenario.filingStatus) {
    scenario.filingStatus = 'single';
  }
  if (scenario.spouseAge === undefined) {
    scenario.spouseAge = null;
  }
  if (!scenario.state) {
    scenario.state = 'California'; // Default state
  }
  return scenario as Scenario;
};

export const RetirementProvider = ({ children }: { children: ReactNode }) => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenarioState] = useState<Scenario | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const [exportDialogVisible, setExportDialogVisible] = useState(false);
  const [selectedExportScenario, setSelectedExportScenario] =
    useState<Scenario | null>(null);

  useEffect(() => {
    const initDB = async () => {
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      const savedScenarios = await db.getAll(storeName);
      if (savedScenarios.length > 0) {
        // Migrate scenarios to ensure they have tax fields
        const migratedScenarios = savedScenarios.map(migrateScenario);
        // Save migrated scenarios back to DB
        for (const scenario of migratedScenarios) {
          await db.put(storeName, scenario, scenario.id);
        }
        setScenarios(migratedScenarios);
        setActiveScenarioState(migratedScenarios[0]); // Set first scenario as active
      }
      // If no scenarios exist, leave scenarios empty and activeScenario null
      setLoading(false);
    };
    initDB();
  }, []);

  const addScenario = async (data: Scenario) => {
    const db = await openDB(dbName, 1);
    await db.put(storeName, data, data.id);
    setScenarios([...scenarios, data]);
    setActiveScenarioState(data);
  };

  const updateScenario = async (data: Scenario) => {
    const db = await openDB(dbName, 1);
    await db.put(storeName, data, data.id);
    setScenarios(
      scenarios.map((scenario) => (scenario.id === data.id ? data : scenario))
    );
    if (activeScenario?.id === data.id) {
      setActiveScenarioState(data);
    }
  };

  const deleteScenario = async (id: string) => {
    const db = await openDB(dbName, 1);
    await db.delete(storeName, id);
    const updatedScenarios = scenarios.filter((scenario) => scenario.id !== id);
    setScenarios(updatedScenarios);
    if (activeScenario?.id === id) {
      setActiveScenarioState(
        updatedScenarios.length > 0 ? updatedScenarios[0] : null
      );
    }
  };

  const exportScenario = (id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) {
      setSelectedExportScenario(scenario);
      setExportDialogVisible(true);
    }
  };

  const confirmExport = async (filename: string) => {
    const scenario = selectedExportScenario;
    if (scenario) {
      try {
        const dataStr = JSON.stringify(scenario, null, 2);
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: 'JSON files',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(dataStr);
        await writable.close();
      } catch (err) {
        // User cancelled or other error, do nothing
        console.error('Export failed:', err);
      }
    }
    setExportDialogVisible(false);
    setSelectedExportScenario(null);
  };

  const setActiveScenario = async (id: string) => {
    const db = await openDB(dbName, 1);
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
        exportScenario,
        setActiveScenario,
      }}
    >
      {children}
      <ExportScenarioDialog
        visible={exportDialogVisible}
        onHide={() => {
          setExportDialogVisible(false);
          setSelectedExportScenario(null);
        }}
        scenario={selectedExportScenario}
        onConfirm={confirmExport}
      />
    </RetirementContext.Provider>
  );
};
