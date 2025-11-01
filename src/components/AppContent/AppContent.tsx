import styled from 'styled-components';
import AppHeader from '../AppHeader/AppHeader';
import Content from '../Content/Content';
import Sidebar from '../Sidebar/Sidebar';
import Footer from '../Footer';

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

const AppContent: React.FC = () => {
  return (
    <AppContentContainer>
      <AppHeader />
      <ContentArea>
        <Sidebar />
        <Content />
      </ContentArea>
      <Footer />
    </AppContentContainer>
  );
};

export default AppContent;
