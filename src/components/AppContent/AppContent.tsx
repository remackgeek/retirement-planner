import styled from 'styled-components'
import Menu from '../Menu/Menu'
import Content from '../Content/Content'
import Sidebar from '../Sidebar/Sidebar'

const AppContentContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`

const AppContent: React.FC = () => {
  return (
    <AppContentContainer>
      <Menu />
      <ContentArea>
        <Sidebar />
        <Content />
      </ContentArea>
    </AppContentContainer>
  )
}

export default AppContent
