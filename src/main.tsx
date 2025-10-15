import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'primereact/resources/themes/lara-light-indigo/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import App from './App.tsx'
import { RetirementProvider } from './context/RetirementContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RetirementProvider>
      <App />
    </RetirementProvider>
  </StrictMode>,
)
