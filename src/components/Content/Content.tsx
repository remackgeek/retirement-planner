import { useContext, useState, useEffect } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { runSimulation } from '../../services/SimulationService';
import Projections from '../Chart/Chart';
import { SpendingGoalsManager } from '../SpendingGoalsManager';
import { IncomeEventsManager } from '../IncomeEventsManager';
import type { SpendingGoal } from '../../types/SpendingGoal';
import type { IncomeEvent } from '../../types/IncomeEvent';

const ContentContainer = styled.main`
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
`;

const ManagersContainer = styled.div`
  display: flex;
  gap: 2rem;
  margin-bottom: 2rem;
`;

const ManagerSection = styled.div`
  flex: 1;
`;

const Content: React.FC = () => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario, updateScenario } = context;
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    if (activeScenario) {
      setResults(runSimulation(activeScenario));
    } else {
      setResults(null);
    }
  }, [activeScenario]);

  const handleAddSpendingGoal = (goal: Omit<SpendingGoal, 'id'>) => {
    if (!activeScenario) return;
    const newGoal: SpendingGoal = { ...goal, id: crypto.randomUUID() };
    const updatedScenario = {
      ...activeScenario,
      spendingGoals: [...activeScenario.spendingGoals, newGoal],
    };
    updateScenario(updatedScenario);
  };

  const handleUpdateSpendingGoal = (
    id: string,
    updates: Partial<SpendingGoal>
  ) => {
    if (!activeScenario) return;
    const updatedGoals = activeScenario.spendingGoals.map((goal) =>
      goal.id === id ? { ...goal, ...updates } : goal
    );
    const updatedScenario = { ...activeScenario, spendingGoals: updatedGoals };
    updateScenario(updatedScenario);
  };

  const handleDeleteSpendingGoal = (id: string) => {
    if (!activeScenario) return;
    const updatedGoals = activeScenario.spendingGoals.filter(
      (goal) => goal.id !== id
    );
    const updatedScenario = { ...activeScenario, spendingGoals: updatedGoals };
    updateScenario(updatedScenario);
  };

  const handleAddIncomeEvent = (event: Omit<IncomeEvent, 'id'>) => {
    if (!activeScenario) return;
    const newEvent: IncomeEvent = { ...event, id: crypto.randomUUID() };
    const updatedScenario = {
      ...activeScenario,
      incomeEvents: [...activeScenario.incomeEvents, newEvent],
    };
    updateScenario(updatedScenario);
  };

  const handleUpdateIncomeEvent = (
    id: string,
    updates: Partial<IncomeEvent>
  ) => {
    if (!activeScenario) return;
    const updatedEvents = activeScenario.incomeEvents.map((event) =>
      event.id === id ? { ...event, ...updates } : event
    );
    const updatedScenario = { ...activeScenario, incomeEvents: updatedEvents };
    updateScenario(updatedScenario);
  };

  const handleDeleteIncomeEvent = (id: string) => {
    if (!activeScenario) return;
    const updatedEvents = activeScenario.incomeEvents.filter(
      (event) => event.id !== id
    );
    const updatedScenario = { ...activeScenario, incomeEvents: updatedEvents };
    updateScenario(updatedScenario);
  };

  return (
    <ContentContainer>
      {results && <Projections results={results} userData={activeScenario} />}
      {activeScenario && (
        <ManagersContainer>
          <ManagerSection>
            <SpendingGoalsManager
              goals={activeScenario.spendingGoals}
              onAdd={handleAddSpendingGoal}
              onUpdate={handleUpdateSpendingGoal}
              onDelete={handleDeleteSpendingGoal}
            />
          </ManagerSection>
          <ManagerSection>
            <IncomeEventsManager
              events={activeScenario.incomeEvents}
              userData={activeScenario}
              onAdd={handleAddIncomeEvent}
              onUpdate={handleUpdateIncomeEvent}
              onDelete={handleDeleteIncomeEvent}
            />
          </ManagerSection>
        </ManagersContainer>
      )}
    </ContentContainer>
  );
};

export default Content;
