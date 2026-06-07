import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'primereact/resources/themes/lara-light-indigo/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import App from './App.tsx'
import { RetirementProvider } from './context/RetirementContext'
import { UIStateProvider } from './context/UIStateContext'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RetirementProvider>
        <UIStateProvider>
          <App />
        </UIStateProvider>
      </RetirementProvider>
    </ErrorBoundary>
  </StrictMode>,
)
