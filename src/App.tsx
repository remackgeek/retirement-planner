import styled from 'styled-components'
import Menu from './components/Menu/Menu'

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
`

const MainContent = styled.main`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`

function App() {
  return (
    <AppContainer>
      <Menu />
      <MainContent>
        <h1>hello world!</h1>
      </MainContent>
    </AppContainer>
  )
}

export default App
