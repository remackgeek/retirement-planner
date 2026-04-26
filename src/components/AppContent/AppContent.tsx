import { useState, useEffect } from 'react';
import styled from 'styled-components';
import AppHeader from '../AppHeader/AppHeader';
import Content from '../Content/Content';
import Sidebar from '../Sidebar/Sidebar';
import Footer from '../Footer';
import { breakpoints, colors, mediaQuery } from '../../styles/theme';

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
  // Dispatch a resize event after the sidebar CSS transition so Chart.js
  // re-measures its container after the layout shift.
  const nudgeChartResize = (delay = 330) =>
    setTimeout(() => window.dispatchEvent(new Event('resize')), delay);

  const toggle = () => {
    setIsSidebarOpen(o => !o);
    nudgeChartResize();
  };

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
      <AppHeader onMenuToggle={toggle} />
      <ContentArea>
        <Backdrop $visible={isSidebarOpen} onClick={() => setIsSidebarOpen(false)} />
        <Sidebar isOpen={isSidebarOpen} onToggle={toggle} />
        <Content />
      </ContentArea>
      <Footer />
    </AppContentContainer>
  );
};

export default AppContent;
