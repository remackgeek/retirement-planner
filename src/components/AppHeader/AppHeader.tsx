import { useContext, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { spacing, colors, fontSize } from '../../styles/theme';
import { RetirementContext } from '../../context/RetirementContext';
import PortfolioDialog from '../../dialogs/PortfolioDialog';
import ModelingDialog from '../../dialogs/ModelingDialog';
import type { Scenario } from '../../types/Scenario';

const HeaderContainer = styled.header`
  display: flex;
  align-items: center;
  padding: 7px ${spacing.lg};
  background-color: ${colors.bgLight};
  border-bottom: 1px solid ${colors.borderLight};
`;

const HeaderLeft = styled.div`
  flex: 1;
  font-weight: bold;
  font-size: ${fontSize.lg};
`;

const HeaderCenter = styled.div`
  flex: 1;
  text-align: center;
  font-weight: normal;
  font-size: ${fontSize.lg};
  color: ${colors.textSecondary};
`;

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  justify-content: flex-end;
`;

const AppHeader: React.FC = () => {
  const context = useContext(RetirementContext);
  const scenarioName = context?.activeScenario?.name;
  const activeScenario = context?.activeScenario ?? null;

  const menuRef = useRef<Menu>(null);
  const [portfolioVisible, setPortfolioVisible] = useState(false);
  const [modelingVisible, setModelingVisible] = useState(false);

  const menuItems: MenuItem[] = [
    {
      label: 'Portfolio',
      icon: 'pi pi-sliders-h',
      command: () => setPortfolioVisible(true),
    },
    {
      label: 'Modeling',
      icon: 'pi pi-chart-line',
      command: () => setModelingVisible(true),
    },
  ];

  const handleSave = (updated: Scenario) => {
    context?.updateScenario(updated);
  };

  return (
    <>
      <HeaderContainer>
        <HeaderLeft>Retirement Planner MVP</HeaderLeft>
        <HeaderCenter>
          {scenarioName && (
            <>
              <i className="pi pi-chart-bar" style={{ marginRight: spacing.sm, fontSize: fontSize.base, color: colors.primary }} />
              {scenarioName}
            </>
          )}
        </HeaderCenter>
        <HeaderRight>
          <Menu model={menuItems} popup ref={menuRef} />
          <Button
            label="Settings"
            icon="pi pi-chevron-down"
            iconPos="right"
            className="p-button-text p-button-sm"
            style={{ padding: '0.15rem 0.5rem' }}
            onClick={(e) => menuRef.current?.toggle(e)}
            disabled={!activeScenario}
          />
        </HeaderRight>
      </HeaderContainer>

      {activeScenario && (
        <>
          <PortfolioDialog
            visible={portfolioVisible}
            onHide={() => setPortfolioVisible(false)}
            scenario={activeScenario}
            onSave={handleSave}
          />
          <ModelingDialog
            visible={modelingVisible}
            onHide={() => setModelingVisible(false)}
            scenario={activeScenario}
            onSave={handleSave}
          />
        </>
      )}
    </>
  );
};

export default AppHeader;
