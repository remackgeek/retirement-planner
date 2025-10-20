import { useState, useContext } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';

interface SidebarContainerProps {
  $isCollapsed: boolean;
}

const SidebarContainer = styled.aside<SidebarContainerProps>`
  width: ${props => props.$isCollapsed ? '50px' : '300px'};
  background-color: #f5f5f5;
  border-right: 1px solid #ddd;
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ToggleButton = styled.button`
  padding: 0.75rem;
  background-color: #007bff;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: #0056b3;
  }
`;

const SidebarContent = styled.div<SidebarContainerProps>`
  padding: ${props => props.$isCollapsed ? '0' : '1rem'};
  opacity: ${props => props.$isCollapsed ? '0' : '1'};
  transition: opacity 0.3s ease;
  overflow-y: auto;
`;

const ScenarioList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const ScenarioItem = styled.li<{ $isActive: boolean }>`
  padding: 0.5rem;
  cursor: pointer;
  background-color: ${props => props.$isActive ? '#e0e0e0' : 'transparent'};
  &:hover {
    background-color: #d0d0d0;
  }
`;

const ScenarioSummary = styled.dl`
  dt {
    font-weight: bold;
  }
  dd {
    margin-bottom: 1rem;
  }
`;

const Sidebar: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { scenarios, activeScenario, setActiveScenario, addScenario } = context;

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleSave = (scenario: Scenario) => {
    addScenario(scenario);
    setDialogVisible(false);
  };

  return (
    <SidebarContainer $isCollapsed={isCollapsed}>
      <ToggleButton onClick={toggleSidebar}>
        {isCollapsed ? '▶' : '◀'}
      </ToggleButton>
      <SidebarContent $isCollapsed={isCollapsed}>
        <h3>Scenarios</h3>
        <ScenarioList>
          {scenarios.map(scenario => (
            <ScenarioItem
              key={scenario.id}
              $isActive={activeScenario?.id === scenario.id}
              onClick={() => setActiveScenario(scenario.id)}
            >
              {scenario.name}
            </ScenarioItem>
          ))}
        </ScenarioList>
        {activeScenario && (
          <>
            <h3>Active Scenario: {activeScenario.name}</h3>
            <ScenarioSummary>
              <dt>Current Age:</dt>
              <dd>{activeScenario.currentAge}</dd>
              <dt>Retirement Age:</dt>
              <dd>{activeScenario.retirementAge}</dd>
              <dt>Life Expectancy:</dt>
              <dd>{activeScenario.lifeExpectancy}</dd>
              <dt>Current Savings:</dt>
              <dd>${activeScenario.currentSavings.toLocaleString()}</dd>
              <dt>Annual Savings:</dt>
              <dd>${activeScenario.annualSavings.toLocaleString()}</dd>
              <dt>Monthly Retirement Spending:</dt>
              <dd>${activeScenario.retirementSpending.monthlyAmount.toLocaleString()}</dd>
              <dt>Spending Goals:</dt>
              <dd>{activeScenario.spendingGoals.length}</dd>
              <dt>Income Events:</dt>
              <dd>{activeScenario.incomeEvents.length}</dd>
              <dt>Risk Level:</dt>
              <dd>{activeScenario.portfolioAssumptions.riskLevel}</dd>
            </ScenarioSummary>
          </>
        )}
        <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
          <Button label="New Scenario" onClick={() => setDialogVisible(true)} style={{ width: '100%' }} />
        </div>
        <ScenarioDialog
          visible={dialogVisible}
          onHide={() => setDialogVisible(false)}
          onSave={handleSave}
        />
      </SidebarContent>
    </SidebarContainer>
  );
};

export default Sidebar;
