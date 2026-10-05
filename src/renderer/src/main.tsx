import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { QuickCapture } from './components/QuickCapture'
import './styles/app.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        {/* The quick-capture window loads this page with #capture. */}
        {location.hash === '#capture' ? <QuickCapture /> : <App />}
      </ErrorBoundary>
    </StrictMode>
  )
}
