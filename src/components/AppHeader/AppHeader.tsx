import { useContext, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { spacing, colors, fontSize, mediaQuery } from '../../styles/theme';
import { RetirementContext } from '../../context/RetirementContext';
import ModelingDialog from '../../dialogs/ModelingDialog';
import CashBucketDialog from '../../dialogs/CashBucketDialog';
import TaxAndIrsDialog from '../../dialogs/TaxAndIrsDialog';
import SocialSecurityWizardDialog from '../../dialogs/SocialSecurityWizardDialog';
import RothConversionDialog from '../../dialogs/RothConversionDialog';
import { applyGeneratedConversions } from '../../utils/applyGeneratedConversions';
import ExamplePickerDialog from '../../dialogs/ExamplePickerDialog';
import AboutDialog from '../../dialogs/AboutDialog';
import WhatsNewDialog from '../../dialogs/WhatsNewDialog';
import ChangelogDialog from '../../dialogs/ChangelogDialog';
import MarkdownViewerSidebar from '../../dialogs/MarkdownViewerSidebar';
import userGuideContent from '../../docs/USER_GUIDE.md?raw';
import modelDetailsContent from '../../docs/MODEL_DETAILS.md?raw';
import {
  changelogMarkdownForApp,
  parsedChangelog,
  unseenReleases,
  type ChangelogRelease,
} from '../../utils/changelog';
import { getLastSeenVersion, setLastSeenVersion } from '../../utils/lastSeenVersion';
import type { Scenario } from '../../types/Scenario';

const changelogContent = changelogMarkdownForApp(parsedChangelog, __APP_VERSION__);

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
  userGuideVisible: boolean;
  onUserGuideVisibleChange: (v: boolean) => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  onMenuToggle,
  onExportCsv,
  userGuideVisible,
  onUserGuideVisibleChange,
}) => {
  const context = useContext(RetirementContext);
  const scenarioName = context?.activeScenario?.name;
  const activeScenario = context?.activeScenario ?? null;

  const menuRef = useRef<Menu>(null);
  const reportsMenuRef = useRef<Menu>(null);
  const toolsMenuRef = useRef<Menu>(null);
  const helpMenuRef = useRef<Menu>(null);
  const [ssWizardVisible, setSsWizardVisible] = useState(false);
  const [rothWizardVisible, setRothWizardVisible] = useState(false);
  const [modelingVisible, setModelingVisible] = useState(false);
  const [cashBucketVisible, setCashBucketVisible] = useState(false);
  const [taxIrsVisible, setTaxIrsVisible] = useState(false);
  // Gate the Cash Bucket menu item: visible only when ≥1 cash account exists OR
  // the policy has been previously configured (so the user can still re-open it
  // to edit even after the cash account is removed). Progressive disclosure:
  // casual users never see this item.
  const hasCashContext = !!activeScenario && (
    activeScenario.accounts.some((a) => a.type === 'cash')
    || !!activeScenario.cashBucketPolicy
  );
  const [examplePickerVisible, setExamplePickerVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [modelDetailsVisible, setModelDetailsVisible] = useState(false);
  const [changelogVisible, setChangelogVisible] = useState(false);
  const [whatsNewVisible, setWhatsNewVisible] = useState(false);
  const [whatsNewReleases, setWhatsNewReleases] = useState<ChangelogRelease[]>([]);

  // Mount-only: stamp first visit silently; pop What's New only on a version upgrade.
  useEffect(() => {
    const lastSeen = getLastSeenVersion();
    if (lastSeen == null) {
      setLastSeenVersion(__APP_VERSION__);
      return;
    }
    const unseen = unseenReleases(parsedChangelog.releases, lastSeen, __APP_VERSION__);
    if (unseen.length > 0) {
      setWhatsNewReleases(unseen);
      setWhatsNewVisible(true);
    }
  }, []);

  const acknowledgeVersion = () => {
    setLastSeenVersion(__APP_VERSION__);
    setWhatsNewVisible(false);
  };

  const openFullChangelog = () => {
    acknowledgeVersion();
    setChangelogVisible(true);
  };

  const menuItems: MenuItem[] = [
    {
      label: 'Modeling',
      icon: 'pi pi-chart-line',
      command: () => setModelingVisible(true),
      disabled: !activeScenario,
    },
    ...(hasCashContext
      ? [{
          label: 'Cash Bucket',
          icon: 'pi pi-wallet',
          command: () => setCashBucketVisible(true),
        }]
      : []),
    {
      label: 'Tax & IRS',
      icon: 'pi pi-percentage',
      command: () => setTaxIrsVisible(true),
      disabled: !activeScenario,
    },
  ];

  const toolsMenuItems: MenuItem[] = [
    {
      label: 'Load example…',
      icon: 'pi pi-bolt',
      command: () => setExamplePickerVisible(true),
    },
    { separator: true },
    {
      label: 'Social Security',
      icon: 'pi pi-shield',
      command: () => setSsWizardVisible(true),
      disabled: !activeScenario,
    },
    {
      label: 'Roth Conversions',
      icon: 'pi pi-sync',
      command: () => setRothWizardVisible(true),
      disabled: !activeScenario,
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
    { label: 'User Guide',    icon: 'pi pi-book',        command: () => onUserGuideVisibleChange(true) },
    { label: 'Model Details', icon: 'pi pi-sliders-h',   command: () => setModelDetailsVisible(true) },
    { separator: true },
    { label: 'Changelog',     icon: 'pi pi-list',        command: () => setChangelogVisible(true) },
    { label: 'About YARP',    icon: 'pi pi-info-circle', command: () => setAboutVisible(true) },
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
          <Menu model={toolsMenuItems} popup ref={toolsMenuRef} />
          <Button
            label="Tools"
            icon="pi pi-chevron-down"
            iconPos="right"
            className="p-button-text p-button-sm"
            style={{ padding: '0.15rem 0.5rem' }}
            onClick={(e) => toolsMenuRef.current?.toggle(e)}
          />
          <Menu model={menuItems} popup ref={menuRef} />
          <Button
            label="Settings"
            icon="pi pi-chevron-down"
            iconPos="right"
            className="p-button-text p-button-sm"
            style={{ padding: '0.15rem 0.5rem' }}
            onClick={(e) => menuRef.current?.toggle(e)}
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
      {activeScenario && (
        <CashBucketDialog
          visible={cashBucketVisible}
          onHide={() => setCashBucketVisible(false)}
          scenario={activeScenario}
          onSave={handleSave}
        />
      )}
      {activeScenario && (
        <TaxAndIrsDialog
          visible={taxIrsVisible}
          onHide={() => setTaxIrsVisible(false)}
          scenario={activeScenario}
          onSave={handleSave}
        />
      )}
      {activeScenario && (
        <SocialSecurityWizardDialog
          visible={ssWizardVisible}
          onHide={() => setSsWizardVisible(false)}
          scenario={activeScenario}
          onSave={handleSave}
        />
      )}
      {activeScenario && (
        <RothConversionDialog
          visible={rothWizardVisible}
          onHide={() => setRothWizardVisible(false)}
          userData={activeScenario}
          existingEvents={activeScenario.incomeEvents}
          onApplyBatch={(batch) => {
            handleSave(applyGeneratedConversions(activeScenario, batch));
            setRothWizardVisible(false);
          }}
          onSave={(event) => handleSave({
            ...activeScenario,
            incomeEvents: [...activeScenario.incomeEvents, { ...event, id: crypto.randomUUID() }],
          })}
        />
      )}
      <ExamplePickerDialog
        visible={examplePickerVisible}
        onHide={() => setExamplePickerVisible(false)}
        onSelect={(example) => {
          context?.loadExampleScenario(example.template);
        }}
      />
      <AboutDialog visible={aboutVisible} onHide={() => setAboutVisible(false)} />
      <WhatsNewDialog
        visible={whatsNewVisible}
        releases={whatsNewReleases}
        onHide={acknowledgeVersion}
        onViewFullChangelog={openFullChangelog}
      />
      <MarkdownViewerSidebar
        title="User Guide"
        icon="pi pi-book"
        content={userGuideContent}
        visible={userGuideVisible}
        onHide={() => onUserGuideVisibleChange(false)}
        showLogo
      />
      <MarkdownViewerSidebar
        title="Model Details"
        icon="pi pi-sliders-h"
        content={modelDetailsContent}
        visible={modelDetailsVisible}
        onHide={() => setModelDetailsVisible(false)}
      />
      <ChangelogDialog
        visible={changelogVisible}
        content={changelogContent}
        onHide={() => setChangelogVisible(false)}
      />
    </>
  );
};

export default AppHeader;
