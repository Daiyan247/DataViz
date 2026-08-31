import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RootErrorBoundary } from './components/RootErrorBoundary.tsx'
import { followSystemTheme } from './lib/theme.ts'

// shadcn's dark tokens live under `.dark`; the OS preference drives that class.
// Run before render so the first paint is already in the right theme.
followSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
