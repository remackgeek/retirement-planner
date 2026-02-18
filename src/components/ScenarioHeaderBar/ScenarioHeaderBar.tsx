import { useContext, useRef } from 'react';
import styled from 'styled-components';
import { OverlayPanel } from 'primereact/overlaypanel';
import { RetirementContext } from '../../context/RetirementContext';

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.4rem 1.25rem;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  font-size: 0.85rem;
  min-height: 36px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: #f0f1f3;
  }
`;

const ScenarioLabel = styled.span`
  font-weight: 600;
  color: #333;
  margin-right: 0.25rem;
`;

const Stat = styled.span`
  color: #666;
  white-space: nowrap;
`;

const Separator = styled.span`
  color: #ccc;
`;

const InfoHint = styled.span`
  color: #999;
  font-size: 0.75rem;
  margin-left: auto;
`;

const OverlayGrid = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.35rem 1rem;
  padding: 0.5rem;
  font-size: 0.85rem;
`;

const OverlayLabel = styled.span`
  color: #666;
  white-space: nowrap;
`;

const OverlayValue = styled.span`
  font-weight: 600;
  color: #333;
  text-align: right;
`;

const OverlayTitle = styled.div`
  font-weight: 700;
  font-size: 0.95rem;
  padding-bottom: 0.35rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid #eee;
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

  const monthlySpending = activeScenario.retirementSpending?.monthlyAmount || 0;

  return (
    <>
      <HeaderBar onClick={(e) => overlayRef.current?.toggle(e)}>
        <ScenarioLabel>{activeScenario.name}</ScenarioLabel>
        <Separator>|</Separator>
        <Stat>
          Age {activeScenario.currentAge} → {activeScenario.retirementAge}
        </Stat>
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
          <OverlayLabel>Retirement Age</OverlayLabel>
          <OverlayValue>{activeScenario.retirementAge}</OverlayValue>
          <OverlayLabel>Life Expectancy</OverlayLabel>
          <OverlayValue>{activeScenario.lifeExpectancy}</OverlayValue>
          <OverlayLabel>Current Savings</OverlayLabel>
          <OverlayValue>
            ${activeScenario.currentSavings.toLocaleString()}
          </OverlayValue>
          <OverlayLabel>Annual Savings</OverlayLabel>
          <OverlayValue>
            ${activeScenario.annualSavings.toLocaleString()}
          </OverlayValue>
          <OverlayLabel>Monthly Spending</OverlayLabel>
          <OverlayValue>${monthlySpending.toLocaleString()}</OverlayValue>
          <OverlayLabel>Spending Goals</OverlayLabel>
          <OverlayValue>{activeScenario.spendingGoals.length}</OverlayValue>
          <OverlayLabel>Income Events</OverlayLabel>
          <OverlayValue>{activeScenario.incomeEvents.length}</OverlayValue>
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
