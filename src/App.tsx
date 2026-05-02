import styled from 'styled-components'
import AppContent from './components/AppContent/AppContent'

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
`

function App() {
  return (
    <AppContainer>
      <AppContent />
    </AppContainer>
  )
}

export default App
