import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry } from './lib/sentry'
import App from './App'
import './index.css'
import { initTheme } from './components/ui/ThemeSelector'

initSentry();
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
