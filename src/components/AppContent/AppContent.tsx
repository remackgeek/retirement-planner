import { useState } from 'react';
import styled from 'styled-components';
import AppHeader from '../AppHeader/AppHeader';
import Content from '../Content/Content';
import Sidebar from '../Sidebar/Sidebar';
import Footer from '../Footer';
import { colors, mediaQuery } from '../../styles/theme';

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

const AppContent: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const toggle = () => setIsSidebarOpen(o => !o);

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
