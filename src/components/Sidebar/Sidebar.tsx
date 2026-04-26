import { useState, useContext } from 'react';
import styled, { css } from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { ConfirmDialog } from 'primereact/confirmdialog';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize, mediaQuery, layout } from '../../styles/theme';
import { formatCurrencyShort } from '../../utils/formatCurrencyShort';

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
  ${props => !props.$isOpen && css`cursor: pointer;`}

  ${mediaQuery.mobile} {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: ${layout.sidebarExpanded};
    z-index: 100;
    transform: translateX(${props => (props.$isOpen ? '0' : '-100%')});
    transition: transform 0.3s ease;
    cursor: auto;
  }
`;

const CollapsedStrip = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${colors.textSecondary};
  font-size: ${fontSize.lg};

  ${mediaQuery.mobile} {
    display: none;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${spacing.md} ${spacing.lg} ${spacing.sm};
  flex-shrink: 0;
`;

const HeaderTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.md};
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
`;

const GhostIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: ${border.radius};
  color: ${colors.textSecondary};
  cursor: pointer;
  font-size: ${fontSize.sm};
  transition: background-color 0.15s, color 0.15s;

  &:hover {
    background-color: ${colors.hoverRow};
    color: ${colors.textPrimary};
  }
`;

const CloseMobileButton = styled(GhostIconButton)`
  display: none;
  ${mediaQuery.mobile} {
    display: inline-flex;
  }
`;

const DesktopToggle = styled(GhostIconButton)`
  ${mediaQuery.mobile} {
    display: none;
  }
`;

const ScenarioList = styled.ul`
  list-style: none;
  padding: 0 ${spacing.sm};
  margin: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
`;

const ScenarioActions = styled.div`
  display: flex;
  gap: 0;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
`;

const ScenarioItem = styled.li<{ $isActive: boolean }>`
  padding: ${spacing.xs} ${spacing.sm};
  border-radius: ${border.radius};
  cursor: pointer;
  background-color: ${(props) => (props.$isActive ? colors.activeRow : 'transparent')};
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.base};

  &:hover {
    background-color: ${(props) => (props.$isActive ? colors.activeRow : colors.hoverRow)};
  }

  &:hover ${ScenarioActions} {
    opacity: 1;
  }

  ${(props) =>
    props.$isActive &&
    css`
      ${ScenarioActions} {
        opacity: 1;
      }
    `}
`;

const ScenarioName = styled.span<{ $isActive: boolean }>`
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: ${(props) => (props.$isActive ? 600 : 400)};
`;

const Metrics = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: ${spacing.sm};
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const Total = styled.span`
  color: ${colors.textSecondary};
  font-size: ${fontSize.xs};
`;

const Probability = styled.span<{ $defined: boolean }>`
  color: ${(props) => (props.$defined ? colors.textPrimary : colors.textMuted)};
  font-size: ${fontSize.sm};
  min-width: 2.6rem;
  text-align: right;
`;

const Footer = styled.div`
  display: flex;
  gap: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  background-color: ${colors.bgMedium};
  border-top: ${border.standard};
  flex-shrink: 0;
`;

const FooterButton = styled(Button)`
  flex: 1;
`;

const actionButtonStyle = {
  padding: '0.1rem 0.15rem',
  fontSize: '0.6rem',
  width: '1.6rem',
  minWidth: '1.6rem',
} as const;

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

  if (!isOpen) {
    return (
      <SidebarContainer $isOpen={false} onClick={onToggle} aria-label="Expand sidebar">
        <CollapsedStrip>
          <i className="pi pi-chevron-right" />
        </CollapsedStrip>
      </SidebarContainer>
    );
  }

  return (
    <SidebarContainer $isOpen={true}>
      <Header>
        <HeaderTitle>Scenarios</HeaderTitle>
        <HeaderActions>
          <i
            className="pi pi-chart-bar"
            style={{ fontSize: fontSize.sm, color: colors.primary }}
          />
          <DesktopToggle onClick={onToggle} aria-label="Collapse sidebar">
            <i className="pi pi-chevron-left" />
          </DesktopToggle>
          <CloseMobileButton onClick={onToggle} aria-label="Close sidebar">
            <i className="pi pi-times" />
          </CloseMobileButton>
        </HeaderActions>
      </Header>
      <ScenarioList>
        {scenarios.map((scenario) => {
          const isActive = activeScenario?.id === scenario.id;
          const total = scenario.accounts.reduce((sum, a) => sum + a.balance, 0);
          const prob = scenario.lastSuccessProbability;
          return (
            <ScenarioItem
              key={scenario.id}
              $isActive={isActive}
              onClick={() => setActiveScenario(scenario.id)}
            >
              <ScenarioName $isActive={isActive}>{scenario.name}</ScenarioName>
              <Metrics>
                <Total>{formatCurrencyShort(total)}</Total>
                <Probability $defined={prob != null}>
                  {prob != null ? `${prob}%` : '—'}
                </Probability>
              </Metrics>
              <ScenarioActions>
                <Button
                  icon='pi pi-trash'
                  className='p-button-text p-button-danger'
                  style={actionButtonStyle}
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
                  style={actionButtonStyle}
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
                  style={actionButtonStyle}
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
          );
        })}
      </ScenarioList>
      <Footer>
        <FooterButton
          label='New'
          icon='pi pi-plus'
          onClick={() => setDialogVisible(true)}
        />
        <FooterButton
          label='Import'
          icon='pi pi-upload'
          className='p-button-outlined'
          onClick={() => importScenario()}
        />
      </Footer>
      <ScenarioDialog
        visible={dialogVisible}
        onHide={handleDialogHide}
        onSave={handleSave}
        scenario={editingScenario || undefined}
      />
      <ConfirmDialog />
    </SidebarContainer>
  );
};

export default Sidebar;
