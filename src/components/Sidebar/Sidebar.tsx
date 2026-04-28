import { useState, useContext } from 'react';
import styled, { css, createGlobalStyle } from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { ConfirmDialog } from 'primereact/confirmdialog';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize, mediaQuery, layout } from '../../styles/theme';
import { formatCurrencyShort } from '../../utils/formatCurrencyShort';
import { getProbabilityTier } from '../../utils/probabilityTier';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  compareScenarioId: string | null;
  onSetCompare: (id: string | null) => void;
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
  padding: ${spacing.md} ${spacing.lg};
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
  border-bottom: 1px solid ${colors.border};

  &:first-child {
    border-top: 1px solid ${colors.border};
  }
  cursor: pointer;
  background-color: ${(props) => (props.$isActive ? colors.activeRow : 'transparent')};
  display: flex;
  flex-direction: column;
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

const ScenarioRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

const ScenarioMeta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
  padding-top: ${spacing.xs};
`;

const ScenarioName = styled.span<{ $isActive: boolean }>`
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: ${(props) => (props.$isActive ? 600 : 400)};
`;

const Total = styled.span`
  color: ${colors.textMuted};
  font-size: ${fontSize.sm};
`;

const ProbabilityWrap = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
`;

const TierDot = styled.span<{ $color: string; $defined: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: ${border.radiusCircle};
  background: ${props => (props.$defined ? props.$color : 'transparent')};
  border: ${props => (props.$defined ? 'none' : `1px solid ${colors.borderMedium}`)};
  flex-shrink: 0;
  cursor: ${props => (props.$defined ? 'help' : 'default')};
`;

const Probability = styled.span<{ $defined: boolean }>`
  color: ${(props) => (props.$defined ? colors.textPrimary : colors.textMuted)};
  font-size: ${fontSize.md};
  font-weight: 600;
`;


const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  padding: ${spacing.sm} ${spacing.md};
  background-color: ${colors.bgMedium};
  border-top: ${border.standard};
  flex-shrink: 0;
`;

const CompactFooterButton = styled.button<{ $primary?: boolean }>`
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.xs};
  padding: ${spacing.xs} ${spacing.md};
  font-size: ${fontSize.sm};
  font-weight: 500;
  font-family: inherit;
  border-radius: ${border.radius};
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  background: transparent;
  border: 2px solid ${props => props.$primary ? colors.primary : colors.borderMedium};
  color: ${props => props.$primary ? colors.primary : colors.textPrimary};

  &:hover {
    background-color: ${props => props.$primary ? 'rgba(61, 122, 95, 0.08)' : 'rgba(0, 0, 0, 0.06)'};
    color: ${props => props.$primary ? colors.primary : colors.textPrimary};
  }
`;

const FooterButtons = styled.div`
  display: flex;
  gap: ${spacing.sm};
`;

const CompareRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
`;

const CompareSelect = styled.select`
  flex: 1;
  font-size: ${fontSize.xs};
  font-family: inherit;
  background: ${colors.bgLight};
  border: ${border.standard};
  border-radius: ${border.radius};
  color: ${colors.textPrimary};
  padding: 2px ${spacing.xs};
  cursor: pointer;
  min-width: 0;
`;

const CompareClearButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: ${border.radius};
  color: ${colors.textMuted};
  cursor: pointer;
  font-size: ${fontSize.xs};
  flex-shrink: 0;
  &:hover { color: ${colors.danger}; }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${spacing.sm};
  padding: ${spacing.xl};
  text-align: center;
  flex: 1;
`;

const EmptyStateIcon = styled.i`
  font-size: 1.75rem;
  color: ${colors.textMuted};
  opacity: 0.5;
`;

const EmptyStateTitle = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  font-weight: 500;
`;

const EmptyStateSub = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
`;

const EmptyStateCta = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  margin-top: ${spacing.xs};
  padding: ${spacing.xs} ${spacing.lg};
  font-size: ${fontSize.base};
  font-family: inherit;
  border-radius: ${border.radius};
  cursor: pointer;
  background: transparent;
  border: 1px solid ${colors.primary};
  color: ${colors.primary};
  transition: background-color 0.15s;

  &:hover {
    background-color: ${colors.bgHover};
  }
`;

const CompactTooltipStyle = createGlobalStyle`
  .compact-tooltip .p-tooltip-text {
    font-size: ${fontSize.xs};
    padding: ${spacing.xs} ${spacing.sm};
  }
`;

const actionButtonStyle = {
  padding: '0.1rem 0.15rem',
  fontSize: '0.6rem',
  width: '1.6rem',
  minWidth: '1.6rem',
} as const;

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, compareScenarioId, onSetCompare }) => {
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
      <CompactTooltipStyle />
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
        {scenarios.length === 0 && (
          <EmptyState>
            <EmptyStateIcon className="pi pi-chart-bar" />
            <EmptyStateTitle>No scenarios yet</EmptyStateTitle>
            <EmptyStateSub>Create one to get started</EmptyStateSub>
            <EmptyStateCta onClick={() => setDialogVisible(true)}>
              <i className="pi pi-plus" />
              New Scenario
            </EmptyStateCta>
          </EmptyState>
        )}
        {scenarios.map((scenario) => {
          const isActive = activeScenario?.id === scenario.id;
          const total = scenario.accounts.reduce((sum, a) => sum + a.balance, 0);
          const prob = scenario.lastSuccessProbability;
          return (
            <ScenarioItem
              key={scenario.id}
              $isActive={isActive}
              onClick={() => {
                setActiveScenario(scenario.id);
                if (scenario.id === compareScenarioId) onSetCompare(null);
              }}
            >
              <ScenarioRow>
                <ScenarioName $isActive={isActive}>{scenario.name}</ScenarioName>
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
                      accept: () => {
                        deleteScenario(scenario.id);
                        if (scenario.id === compareScenarioId) onSetCompare(null);
                      },
                    });
                  }}
                  tooltip='Delete'
                  tooltipOptions={{ position: 'top', className: 'compact-tooltip' }}
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
                  tooltipOptions={{ position: 'top', className: 'compact-tooltip' }}
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
                  tooltipOptions={{ position: 'top', className: 'compact-tooltip' }}
                />
              </ScenarioActions>
              </ScenarioRow>
              <ScenarioMeta>
                <Total>{formatCurrencyShort(total)}</Total>
                <ProbabilityWrap>
                  {(() => {
                    const tierInfo = prob != null ? getProbabilityTier(prob) : null;
                    const dotClass = `chance-tier-dot-${scenario.id}`;
                    return (
                      <>
                        {tierInfo && (
                          <PrimeTooltip target={`.${dotClass}`} position="right" showDelay={150}>
                            <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                              <strong>{tierInfo.label}</strong> — {tierInfo.tooltip}
                            </div>
                          </PrimeTooltip>
                        )}
                        <TierDot
                          className={dotClass}
                          $color={tierInfo?.color ?? ''}
                          $defined={tierInfo != null}
                          aria-label={tierInfo ? `Tier: ${tierInfo.label}` : 'No probability yet'}
                        />
                      </>
                    );
                  })()}
                  <Probability $defined={prob != null}>
                    {prob != null ? `${prob}%` : '—'}
                  </Probability>
                </ProbabilityWrap>
              </ScenarioMeta>
            </ScenarioItem>
          );
        })}
      </ScenarioList>
      <Footer>
        {scenarios.length > 1 && (
          <CompareRow>
            <span style={{ fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 0 }}>vs.</span>
            <CompareSelect
              value={compareScenarioId ?? ''}
              onChange={(e) => onSetCompare(e.target.value || null)}
            >
              <option value="">— no comparison —</option>
              {scenarios
                .filter(s => s.id !== activeScenario?.id)
                .map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))
              }
            </CompareSelect>
            {compareScenarioId && (
              <CompareClearButton onClick={() => onSetCompare(null)} title="Clear comparison">
                <i className="pi pi-times" />
              </CompareClearButton>
            )}
          </CompareRow>
        )}
        <FooterButtons>
          <CompactFooterButton $primary onClick={() => setDialogVisible(true)}>
            <i className="pi pi-plus" />
            New
          </CompactFooterButton>
          <CompactFooterButton onClick={() => importScenario()}>
            <i className="pi pi-upload" />
            Import
          </CompactFooterButton>
        </FooterButtons>
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
