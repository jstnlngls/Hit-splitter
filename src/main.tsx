import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles.css'

// The desktop app bundles its fonts; the web build loads them from Google Fonts.
if (import.meta.env.VITE_TARGET === 'desktop') void import('./fonts-local.css')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
