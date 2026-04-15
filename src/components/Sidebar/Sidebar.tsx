import { useState, useContext } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { ConfirmDialog } from 'primereact/confirmdialog';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize, mediaQuery, layout } from '../../styles/theme';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const SidebarContainer = styled.aside<{ $isOpen: boolean }>`
  width: ${props => (props.$isOpen ? layout.sidebarExpanded : layout.sidebarCollapsed)};
  background-color: ${colors.bgMedium};
  border-right: ${border.standard};
  transition: width 0.3s ease;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  ${mediaQuery.mobile} {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: ${layout.sidebarExpanded};
    z-index: 100;
    transform: translateX(${props => (props.$isOpen ? '0' : '-100%')});
    transition: transform 0.3s ease;
  }
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

  ${mediaQuery.mobile} {
    display: none;
  }
`;

const CloseMobileButton = styled.button`
  display: none;
  ${mediaQuery.mobile} {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: ${spacing.sm} ${spacing.md};
    background-color: ${colors.primary};
    color: white;
    border: none;
    cursor: pointer;
    font-size: ${fontSize.xl};
    width: 100%;
  }
`;

const SidebarContent = styled.div<{ $isOpen: boolean }>`
  padding: ${props => (props.$isOpen ? spacing.lg : '0')};
  opacity: ${props => (props.$isOpen ? '1' : '0')};
  transition: opacity 0.3s ease;
  overflow-y: auto;

  ${mediaQuery.mobile} {
    padding: ${spacing.lg};
    opacity: 1;
  }
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

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const context = useContext(RetirementContext);
  if (!context) return null;
  const {
    scenarios,
    activeScenario,
    setActiveScenario,
    addScenario,
    updateScenario,
    deleteScenario,
    exportScenario,
    importScenario,
  } = context;

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
    <SidebarContainer $isOpen={isOpen}>
      <ToggleButton onClick={onToggle}>
        {isOpen ? '◀' : '▶'}
      </ToggleButton>
      <CloseMobileButton onClick={onToggle}>
        <i className="pi pi-times" />
      </CloseMobileButton>
      <SidebarContent $isOpen={isOpen}>
        <h3 style={{ margin: `0 0 ${spacing.sm}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Scenarios
          <i className="pi pi-chart-bar" style={{ fontSize: fontSize.base, color: colors.primary }} />
        </h3>
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
                        confirmDialog({
                          message: `Are you sure you want to delete "${scenario.name}"?`,
                          header: 'Delete Scenario',
                          icon: 'pi pi-exclamation-triangle',
                          accept: () => deleteScenario(scenario.id),
                        });
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
          visible={dialogVisible}
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
