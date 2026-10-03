import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickCapture } from './components/QuickCapture'
import './styles/app.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* The quick-capture window loads this page with #capture. */}
      {location.hash === '#capture' ? <QuickCapture /> : <App />}
    </StrictMode>
  )
}
