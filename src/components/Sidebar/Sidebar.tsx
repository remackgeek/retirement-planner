import { useState, useContext } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { ConfirmDialog } from 'primereact/confirmdialog';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';

interface SidebarContainerProps {
  $isCollapsed: boolean;
}

const SidebarContainer = styled.aside<SidebarContainerProps>`
  width: ${(props) => (props.$isCollapsed ? '50px' : '300px')};
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
  padding: ${(props) => (props.$isCollapsed ? '0' : '1rem')};
  opacity: ${(props) => (props.$isCollapsed ? '0' : '1')};
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
  background-color: ${(props) => (props.$isActive ? '#e0e0e0' : 'transparent')};
  display: flex;
  justify-content: space-between;
  align-items: center;
  &:hover {
    background-color: #d0d0d0;
  }
`;

const ScenarioName = styled.span`
  flex: 1;
`;

const ScenarioActions = styled.div`
  display: flex;
  gap: 0;
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
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const context = useContext(RetirementContext);
  if (!context) return null;
  const {
    scenarios,
    activeScenario,
    loading,
    setActiveScenario,
    addScenario,
    updateScenario,
    deleteScenario,
    exportScenario,
  } = context;

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleSave = (scenario: Scenario) => {
    if (editingScenario) {
      // Editing existing scenario
      updateScenario(scenario);
    } else {
      // Creating new scenario
      addScenario(scenario);
    }
    setDialogVisible(false);
    setEditingScenario(null);
  };

  const handleDialogHide = () => {
    if (scenarios.length > 0) {
      setDialogVisible(false);
      setEditingScenario(null);
    }
    // If no scenarios exist, don't allow hiding the dialog
  };

  return (
    <SidebarContainer $isCollapsed={isCollapsed}>
      <ToggleButton onClick={toggleSidebar}>
        {isCollapsed ? '▶' : '◀'}
      </ToggleButton>
      <SidebarContent $isCollapsed={isCollapsed}>
        <h3>Scenarios</h3>
        <ScenarioList>
          {scenarios.map((scenario) => (
            <ScenarioItem
              key={scenario.id}
              $isActive={activeScenario?.id === scenario.id}
            >
              <ScenarioName onClick={() => setActiveScenario(scenario.id)}>
                {scenario.name}
              </ScenarioName>
              <ScenarioActions>
                <Button
                  icon='pi pi-trash'
                  className='p-button-text p-button-danger'
                  style={{
                    padding: '0.1rem 0.15rem',
                    fontSize: '0.6rem',
                    width: '1.6rem',
                    minWidth: '1.6rem',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (scenarios.length === 1) {
                      confirmDialog({
                        message:
                          'Cannot delete the last scenario. Please create a new scenario first.',
                        header: 'Cannot Delete',
                        icon: 'pi pi-exclamation-triangle',
                        acceptLabel: 'OK',
                        rejectClassName: 'p-button-text',
                        reject: undefined,
                      });
                    } else {
                      confirmDialog({
                        message: `Are you sure you want to delete "${scenario.name}"?`,
                        header: 'Delete Scenario',
                        icon: 'pi pi-exclamation-triangle',
                        accept: () => deleteScenario(scenario.id),
                      });
                    }
                  }}
                  tooltip='Delete'
                  tooltipOptions={{ position: 'top' }}
                />
                <Button
                  icon='pi pi-download'
                  className='p-button-text'
                  style={{
                    padding: '0.1rem 0.15rem',
                    fontSize: '0.6rem',
                    width: '1.6rem',
                    minWidth: '1.6rem',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportScenario(scenario.id);
                  }}
                  tooltip='Export'
                  tooltipOptions={{ position: 'top' }}
                />
                <Button
                  icon='pi pi-pencil'
                  className='p-button-text'
                  style={{
                    padding: '0.1rem 0.15rem',
                    fontSize: '0.6rem',
                    width: '1.6rem',
                    minWidth: '1.6rem',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingScenario(scenario);
                    setDialogVisible(true);
                  }}
                  tooltip='Edit'
                  tooltipOptions={{ position: 'top' }}
                />
              </ScenarioActions>
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
              <dd>
                $
                {(
                  activeScenario.retirementSpending?.monthlyAmount || 0
                ).toLocaleString()}
              </dd>
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
          <Button
            label='New Scenario'
            onClick={() => setDialogVisible(true)}
            style={{ width: '100%' }}
          />
        </div>
        <ScenarioDialog
          visible={dialogVisible || (scenarios.length === 0 && !loading)}
          onHide={handleDialogHide}
          onSave={handleSave}
          scenario={editingScenario || undefined}
        />
        <ConfirmDialog />
      </SidebarContent>
    </SidebarContainer>
  );
};

export default Sidebar;
