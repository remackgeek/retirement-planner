import { createContext, useState, useEffect, type ReactNode } from 'react';
import type { Scenario } from '../types/Scenario';
import { openDB } from 'idb';

const dbName = 'RetirementPlanner';
const storeName = 'scenarios';

export const RetirementContext = createContext<{
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  addScenario: (data: Scenario) => Promise<void>;
  setActiveScenario: (id: string) => Promise<void>;
} | null>(null);

export const RetirementProvider = ({ children }: { children: ReactNode }) => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenarioState] = useState<Scenario | null>(null);

  useEffect(() => {
    const initDB = async () => {
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      const savedScenarios = await db.getAll(storeName);
      if (savedScenarios.length > 0) {
        setScenarios(savedScenarios);
        setActiveScenarioState(savedScenarios[0]); // Set first scenario as active
      } else {
        const defaultScenario: Scenario = {
          id: crypto.randomUUID(),
          name: 'Default Scenario',
          currentAge: 40,
          retirementAge: 65,
          lifeExpectancy: 92,
          currentSavings: 100000,
          annualSavings: 20000,
          monthlyRetirementSpending: 5000,
          ssAmount: 30000,
          riskLevel: 'moderate',
        };
        await db.put(storeName, defaultScenario, defaultScenario.id);
        setScenarios([defaultScenario]);
        setActiveScenarioState(defaultScenario);
      }
    };
    initDB();
  }, []);

  const addScenario = async (data: Scenario) => {
    const db = await openDB(dbName, 1);
    await db.put(storeName, data, data.id);
    setScenarios([...scenarios, data]);
    setActiveScenarioState(data);
  };

  const setActiveScenario = async (id: string) => {
    const db = await openDB(dbName, 1);
    const scenario = await db.get(storeName, id);
    if (scenario) {
      setActiveScenarioState(scenario);
    }
  };

  return (
    <RetirementContext.Provider value={{ scenarios, activeScenario, addScenario, setActiveScenario }}>
      {children}
    </RetirementContext.Provider>
  );
};