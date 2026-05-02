import { useContext, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { spacing, colors, fontSize, mediaQuery } from '../../styles/theme';
import { RetirementContext } from '../../context/RetirementContext';
import ModelingDialog from '../../dialogs/ModelingDialog';
import AboutDialog from '../../dialogs/AboutDialog';
import MarkdownViewerSidebar from '../../dialogs/MarkdownViewerSidebar';
import userGuideContent from '../../docs/USER_GUIDE.md?raw';
import modelDetailsContent from '../../docs/MODEL_DETAILS.md?raw';
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
  display: flex;
  align-items: center;
  font-weight: bold;
  font-size: ${fontSize.lg};
`;

const HamburgerButton = styled.button`
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: ${spacing.xs} ${spacing.sm};
  margin-right: ${spacing.sm};
  color: ${colors.primary};
  font-size: ${fontSize.xl};
  line-height: 1;

  ${mediaQuery.mobile} {
    display: inline-flex;
    align-items: center;
  }
`;

const HeaderCenter = styled.div`
  flex: 1;
  text-align: center;
  font-weight: normal;
  font-size: ${fontSize.lg};
  color: ${colors.textSecondary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${mediaQuery.mobile} {
    font-size: ${fontSize.sm};
  }
`;

const AppTitleFull = styled.span`
  ${mediaQuery.mobile} {
    display: none;
  }
`;

const AppTitleShort = styled.span`
  display: none;
  ${mediaQuery.mobile} {
    display: inline;
  }
`;

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  justify-content: flex-end;
`;

interface AppHeaderProps {
  onMenuToggle: () => void;
  onExportCsv?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ onMenuToggle, onExportCsv }) => {
  const context = useContext(RetirementContext);
  const scenarioName = context?.activeScenario?.name;
  const activeScenario = context?.activeScenario ?? null;

  const menuRef = useRef<Menu>(null);
  const reportsMenuRef = useRef<Menu>(null);
  const helpMenuRef = useRef<Menu>(null);
  const [modelingVisible, setModelingVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [userGuideVisible, setUserGuideVisible] = useState(false);
  const [modelDetailsVisible, setModelDetailsVisible] = useState(false);

  const menuItems: MenuItem[] = [
    {
      label: 'Modeling',
      icon: 'pi pi-chart-line',
      command: () => setModelingVisible(true),
    },
  ];

  const reportsMenuItems: MenuItem[] = [
    {
      label: 'Export CSV',
      icon: 'pi pi-download',
      command: () => onExportCsv?.(),
      disabled: !onExportCsv,
    },
  ];

  const helpMenuItems: MenuItem[] = [
    { label: 'User Guide',    icon: 'pi pi-book',       command: () => setUserGuideVisible(true) },
    { label: 'Model Details', icon: 'pi pi-sliders-h',  command: () => setModelDetailsVisible(true) },
    { separator: true },
    { label: 'About YARP',   icon: 'pi pi-info-circle', command: () => setAboutVisible(true) },
  ];

  const handleSave = (updated: Scenario) => {
    context?.updateScenario(updated);
  };

  return (
    <>
      <HeaderContainer>
        <HeaderLeft>
          <HamburgerButton onClick={onMenuToggle} aria-label="Toggle menu">
            <i className="pi pi-bars" />
          </HamburgerButton>
          <AppTitleFull>YARP (Yet Another Retirement Planner)</AppTitleFull>
          <AppTitleShort>YARP</AppTitleShort>
        </HeaderLeft>
        <HeaderCenter>
          {scenarioName && (
            <>
              <i className="pi pi-chart-bar" style={{ marginRight: spacing.sm, fontSize: fontSize.base, color: colors.primary }} />
              {scenarioName}
            </>
          )}
        </HeaderCenter>
        <HeaderRight>
          <Menu model={reportsMenuItems} popup ref={reportsMenuRef} />
          <Button
            label="Reports"
            icon="pi pi-chevron-down"
            iconPos="right"
            className="p-button-text p-button-sm"
            style={{ padding: '0.15rem 0.5rem' }}
            onClick={(e) => reportsMenuRef.current?.toggle(e)}
            disabled={!activeScenario}
          />
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
          <Menu model={helpMenuItems} popup ref={helpMenuRef} />
          <Button
            label="Help"
            icon="pi pi-chevron-down"
            iconPos="right"
            className="p-button-text p-button-sm"
            style={{ padding: '0.15rem 0.5rem' }}
            onClick={(e) => helpMenuRef.current?.toggle(e)}
          />
        </HeaderRight>
      </HeaderContainer>

      {activeScenario && (
        <ModelingDialog
          visible={modelingVisible}
          onHide={() => setModelingVisible(false)}
          scenario={activeScenario}
          onSave={handleSave}
        />
      )}
      <AboutDialog visible={aboutVisible} onHide={() => setAboutVisible(false)} />
      <MarkdownViewerSidebar
        title="User Guide"
        icon="pi pi-book"
        content={userGuideContent}
        visible={userGuideVisible}
        onHide={() => setUserGuideVisible(false)}
        showLogo
      />
      <MarkdownViewerSidebar
        title="Model Details"
        icon="pi pi-sliders-h"
        content={modelDetailsContent}
        visible={modelDetailsVisible}
        onHide={() => setModelDetailsVisible(false)}
      />
    </>
  );
};

export default AppHeader;
