import { createContext, useState, useEffect, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import { openDB } from 'idb';
import { confirmDialog } from 'primereact/confirmdialog';

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
  exportScenario: (id: string) => Promise<void>;
  importScenario: () => void;
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
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      const savedScenarios = (await db.getAll(storeName)) as Scenario[];
      if (savedScenarios.length > 0) {
        setScenarios(savedScenarios);
        setActiveScenarioState(savedScenarios[0]); // Set first scenario as active
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
        const importedData = JSON.parse(text) as Scenario;

        if (!importedData.name || typeof importedData.currentAge !== 'number') {
          throw new Error('Invalid scenario: Missing name or currentAge.');
        }
        if (!Array.isArray(importedData.accounts)) {
          throw new Error('Invalid scenario: Missing accounts array.');
        }
        if (typeof importedData.longTermCapGainsRate !== 'number') {
          importedData.longTermCapGainsRate = 0.15;
        }
        const pa = importedData.portfolioAssumptions;
        if (!pa || typeof pa.stockAllocation !== 'number' || typeof pa.stockReturn !== 'number' ||
            typeof pa.bondReturn !== 'number') {
          throw new Error('Invalid scenario: Missing or invalid portfolioAssumptions fields.');
        }
        if (typeof pa.stockBondCorrelationEnabled !== 'boolean') {
          pa.stockBondCorrelationEnabled = false;
        }
        if (typeof pa.stockBondCorrelation !== 'number') {
          pa.stockBondCorrelation = -0.2;
        }
        pa.stockBondCorrelation = Math.max(-1, Math.min(1, pa.stockBondCorrelation));
        if (typeof importedData.inflationStdDev !== 'number') {
          importedData.inflationStdDev = 0;
        }

        if (!importedData.id) {
          importedData.id = crypto.randomUUID();
        }

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
                message: 'Scenario imported successfully!',
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
                message: 'Scenario imported as a new copy.',
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
            message: 'Scenario imported successfully!',
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
        importScenario,
        setActiveScenario,
      }}
    >
      {children}
    </RetirementContext.Provider>
  );
};
