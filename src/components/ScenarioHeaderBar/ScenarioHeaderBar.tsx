import { useContext, useRef } from 'react';
import styled from 'styled-components';
import { OverlayPanel } from 'primereact/overlaypanel';
import { RetirementContext } from '../../context/RetirementContext';
import { spacing, colors, fontSize, border } from '../../styles/theme';

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.lg};
  padding: 0.4rem ${spacing.xl};
  background: ${colors.bgLight};
  border-bottom: ${border.medium};
  font-size: ${fontSize.base};
  min-height: 36px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: ${colors.bgHover};
  }
`;

const ScenarioLabel = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
  margin-right: ${spacing.xs};
`;

const Stat = styled.span`
  color: ${colors.textSecondary};
  white-space: nowrap;
`;

const Separator = styled.span`
  color: ${colors.textSeparator};
`;

const InfoHint = styled.span`
  color: ${colors.textMuted};
  font-size: ${fontSize.sm};
  margin-left: auto;
`;

const OverlayGrid = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.35rem ${spacing.lg};
  padding: ${spacing.sm};
  font-size: ${fontSize.base};
`;

const OverlayLabel = styled.span`
  color: ${colors.textSecondary};
  white-space: nowrap;
`;

const OverlayValue = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
  text-align: right;
`;

const OverlayTitle = styled.div`
  font-weight: 700;
  font-size: 0.95rem;
  padding-bottom: 0.35rem;
  margin-bottom: ${spacing.xs};
  border-bottom: ${border.light};
  grid-column: 1 / -1;
`;

const formatCurrency = (value: number): string => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }
  return `$${value.toLocaleString()}`;
};

const ScenarioHeaderBar: React.FC = () => {
  const context = useContext(RetirementContext);
  const overlayRef = useRef<OverlayPanel>(null);
  if (!context) return null;
  const { activeScenario } = context;
  if (!activeScenario) return null;

  return (
    <>
      <HeaderBar onClick={(e) => overlayRef.current?.toggle(e)}>
        <ScenarioLabel>{activeScenario.name}</ScenarioLabel>
        <Separator>|</Separator>
        <Stat>Age {activeScenario.currentAge}</Stat>
        <Separator>|</Separator>
        <Stat>{formatCurrency(activeScenario.currentSavings)} saved</Stat>
        <Separator>|</Separator>
        <Stat>{activeScenario.portfolioAssumptions.riskLevel}</Stat>
        <InfoHint>
          <i className="pi pi-info-circle" /> click for details
        </InfoHint>
      </HeaderBar>
      <OverlayPanel ref={overlayRef}>
        <OverlayGrid>
          <OverlayTitle>{activeScenario.name}</OverlayTitle>
          <OverlayLabel>Current Age</OverlayLabel>
          <OverlayValue>{activeScenario.currentAge}</OverlayValue>
          <OverlayLabel>Life Expectancy</OverlayLabel>
          <OverlayValue>{activeScenario.lifeExpectancy}</OverlayValue>
          <OverlayLabel>Current Savings</OverlayLabel>
          <OverlayValue>
            ${activeScenario.currentSavings.toLocaleString()}
          </OverlayValue>
          <OverlayLabel>Income Events</OverlayLabel>
          <OverlayValue>{activeScenario.incomeEvents.length}</OverlayValue>
          <OverlayLabel>Spending Goals</OverlayLabel>
          <OverlayValue>{activeScenario.spendingGoals.length}</OverlayValue>
          <OverlayLabel>Risk Level</OverlayLabel>
          <OverlayValue>
            {activeScenario.portfolioAssumptions.riskLevel}
          </OverlayValue>
          <OverlayLabel>Inflation Rate</OverlayLabel>
          <OverlayValue>
            {(activeScenario.inflationRate * 100).toFixed(1)}%
          </OverlayValue>
        </OverlayGrid>
      </OverlayPanel>
    </>
  );
};

export default ScenarioHeaderBar;
