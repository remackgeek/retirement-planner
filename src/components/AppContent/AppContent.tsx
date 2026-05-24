import { useState, useEffect, useRef, useContext } from 'react';
import styled from 'styled-components';
import AppHeader from '../AppHeader/AppHeader';
import Content from '../Content/Content';
import Sidebar from '../Sidebar/Sidebar';
import Footer from '../Footer';
import { breakpoints, colors, mediaQuery } from '../../styles/theme';
import { RetirementContext } from '../../context/RetirementContext';
import type { Scenario } from '../../types/Scenario';
import { confirmDialog } from 'primereact/confirmdialog';

const AppContentContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const Backdrop = styled.div<{ $visible: boolean }>`
  display: none;
  ${mediaQuery.mobile} {
    display: ${props => (props.$visible ? 'block' : 'none')};
    position: fixed;
    inset: 0;
    background-color: ${colors.shadowMedium};
    z-index: 99;
  }
`;

const mobileMediaQuery = `(max-width: ${breakpoints.mobile - 1}px)`;

const AppContent: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.matchMedia(mobileMediaQuery).matches;
  });
  const [compareScenarioId, setCompareScenarioId] = useState<string | null>(null);
  const [whatIfSnapshot, setWhatIfSnapshot] = useState<Scenario | null>(null);
  const ctx = useContext(RetirementContext);
  const exportCsvRef = useRef<(() => void) | null>(null);
  const [canExport, setCanExport] = useState(false);
  const handleRegisterExport = (fn: (() => void) | null) => {
    exportCsvRef.current = fn;
    setCanExport(fn !== null);
  };
  const handleExportCsv = canExport ? () => exportCsvRef.current?.() : undefined;
  // Dispatch a resize event after the sidebar CSS transition so Chart.js
  // re-measures its container after the layout shift.
  const nudgeChartResize = (delay = 330) =>
    setTimeout(() => window.dispatchEvent(new Event('resize')), delay);

  const toggle = () => {
    setIsSidebarOpen(o => !o);
    nudgeChartResize();
  };

  const enterWhatIf = () => {
    if (!ctx?.activeScenario || whatIfSnapshot || compareScenarioId) return;
    // structuredClone preserves `undefined` fields and is the right primitive
    // for plain-data scenario cloning. JSON.parse(JSON.stringify(...)) silently
    // drops undefined and corrupts non-JSON-safe values — same family of footgun
    // as the cache-fingerprint bug fixed elsewhere in this codebase.
    setWhatIfSnapshot(structuredClone(ctx.activeScenario));
  };

  const discardWhatIf = () => {
    if (!whatIfSnapshot || !ctx) return;
    confirmDialog({
      message: `Discard What If changes and restore "${whatIfSnapshot.name}"?`,
      header: 'Discard What If Changes',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Discard',
      rejectLabel: 'Cancel',
      accept: async () => {
        await ctx.updateScenario(whatIfSnapshot);
        setWhatIfSnapshot(null);
      },
    });
  };

  const saveWhatIf = () => {
    setWhatIfSnapshot(null);
  };

  const saveWhatIfAsNew = async (name: string) => {
    if (!whatIfSnapshot || !ctx?.activeScenario) return;
    const experiment = ctx.activeScenario;
    await ctx.cloneScenario(experiment.id, name);
    await ctx.updateScenario(whatIfSnapshot);
    setWhatIfSnapshot(null);
  };

  const requestSwitchScenario = (id: string) => {
    if (!ctx) return;
    if (!whatIfSnapshot) { ctx.setActiveScenario(id); return; }
    confirmDialog({
      message: 'You have unsaved What If changes. Discard them and switch scenarios?',
      header: 'Unsaved What If Changes',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Discard & Switch',
      rejectLabel: 'Cancel',
      accept: async () => {
        await ctx.updateScenario(whatIfSnapshot);
        setWhatIfSnapshot(null);
        await ctx.setActiveScenario(id);
      },
    });
  };

  // Auto-clear What If state if the active scenario changes for any other reason
  // (e.g. delete, import).
  useEffect(() => {
    if (whatIfSnapshot && ctx?.activeScenario && ctx.activeScenario.id !== whatIfSnapshot.id) {
      setWhatIfSnapshot(null);
    }
  }, [ctx?.activeScenario?.id, whatIfSnapshot]);

  // While What If is active, warn before unload: edits are live-persisted to
  // IndexedDB and the in-memory snapshot is the only path back to the original.
  useEffect(() => {
    if (!whatIfSnapshot) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [whatIfSnapshot]);

  // Auto-close the sidebar when the viewport crosses into mobile width
  // (e.g. shrinking a desktop window or rotating a tablet to portrait).
  // Nudge Chart.js on both crossing directions: the sidebar enters/exits the
  // flex layout flow, changing the content area width in ways Chart.js misses.
  useEffect(() => {
    const mql = window.matchMedia(mobileMediaQuery);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setIsSidebarOpen(false);
      nudgeChartResize(50);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return (
    <AppContentContainer>
      <AppHeader onMenuToggle={toggle} onExportCsv={handleExportCsv} />
      <ContentArea>
        <Backdrop $visible={isSidebarOpen} onClick={() => setIsSidebarOpen(false)} />
        <Sidebar
          isOpen={isSidebarOpen}
          onToggle={toggle}
          requestSwitchScenario={requestSwitchScenario}
        />
        <Content
          compareScenarioId={whatIfSnapshot ? null : compareScenarioId}
          onSetCompare={setCompareScenarioId}
          onRegisterExport={handleRegisterExport}
          whatIfSnapshot={whatIfSnapshot}
          whatIfActive={whatIfSnapshot != null}
          compareDisabled={whatIfSnapshot != null}
          onEnterWhatIf={enterWhatIf}
          onDiscardWhatIf={discardWhatIf}
          onSaveWhatIf={saveWhatIf}
          onSaveWhatIfAsNew={saveWhatIfAsNew}
        />
      </ContentArea>
      <Footer />
    </AppContentContainer>
  );
};

export default AppContent;
