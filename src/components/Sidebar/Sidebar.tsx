import { useState, useContext } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { ConfirmDialog } from 'primereact/confirmdialog';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize } from '../../styles/theme';

interface SidebarContainerProps {
  $isCollapsed: boolean;
}

const SidebarContainer = styled.aside<SidebarContainerProps>`
  width: ${(props) => (props.$isCollapsed ? '50px' : '300px')};
  background-color: ${colors.bgMedium};
  border-right: ${border.standard};
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ToggleButton = styled.button`
  padding: ${spacing.md};
  background-color: ${colors.primary};
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${colors.primaryHover};
  }
`;

const SidebarContent = styled.div<SidebarContainerProps>`
  padding: ${(props) => (props.$isCollapsed ? '0' : spacing.lg)};
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
  padding: 0.3rem ${spacing.sm};
  cursor: pointer;
  background-color: ${(props) => (props.$isActive ? colors.activeRow : 'transparent')};
  &:hover {
    background-color: ${colors.hoverRow};
  }
`;

const ScenarioRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ScenarioName = styled.span`
  flex: 1;
`;

const ScenarioActions = styled.div`
  display: flex;
  gap: 0;
`;

const ChipsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.xs};
  padding: 0.15rem 0 0;
`;

const Chip = styled.span`
  font-size: ${fontSize.xs};
  padding: 0.1rem 0.4rem;
  border-radius: ${border.radiusRound};
  background: ${colors.chipBg};
  color: ${colors.chipText};
  white-space: nowrap;
  line-height: 1.4;
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
    importScenario,
  } = context;

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleSave = (scenario: Scenario) => {
    if (editingScenario) {
      updateScenario(scenario);
    } else {
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
  };

  return (
    <SidebarContainer $isCollapsed={isCollapsed}>
      <ToggleButton onClick={toggleSidebar}>
        {isCollapsed ? '▶' : '◀'}
      </ToggleButton>
      <SidebarContent $isCollapsed={isCollapsed}>
        <h3 style={{ margin: `0 0 ${spacing.sm}` }}>Scenarios</h3>
        <ScenarioList>
          {scenarios.map((scenario) => {
            const isActive = activeScenario?.id === scenario.id;
            return (
              <ScenarioItem
                key={scenario.id}
                $isActive={isActive}
              >
                <ScenarioRow>
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
                </ScenarioRow>
                {isActive && activeScenario && (
                  <ChipsRow>
                    <Chip>Age {activeScenario.currentAge}</Chip>
                    <Chip>{activeScenario.incomeEvents.length} income</Chip>
                    <Chip>{activeScenario.spendingGoals.length} goals</Chip>
                  </ChipsRow>
                )}
              </ScenarioItem>
            );
          })}
        </ScenarioList>
        <div style={{ marginTop: 'auto', paddingTop: spacing.lg }}>
          <Button
            label='New Scenario'
            onClick={() => setDialogVisible(true)}
            style={{ width: '100%' }}
          />
          <Button
            label='Import Scenario'
            icon='pi pi-upload'
            onClick={() => importScenario()}
            style={{ width: '100%', marginTop: spacing.sm }}
          />
        </div>
        <ScenarioDialog
          visible={dialogVisible || (scenarios.length === 0 && !loading)}
          onHide={handleDialogHide}
          onSave={handleSave}
          scenario={editingScenario || undefined}
          isFirstScenario={scenarios.length === 0}
        />
        <ConfirmDialog />
      </SidebarContent>
    </SidebarContainer>
  );
};

export default Sidebar;
