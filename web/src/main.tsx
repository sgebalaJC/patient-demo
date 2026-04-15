import React from 'react'
import ReactDOM from 'react-dom/client'
import { initClientErrorReporter } from './lib/client-errors'
import App from './App'
import './index.css'
import { initTheme } from './components/ui/ThemeSelector'

initClientErrorReporter();
initTheme();

// Auto-recover from stale lazy-chunk references after a new deploy.
// The previous `index.html` may reference chunk hashes that no longer
// exist on the server; the SPA fallback then serves index.html (HTML)
// for those .js requests, which the browser rejects as "not a module".
// Hard reload pulls fresh index.html with current hashes.
//
// Once per tab: if sessionStorage already recorded a reload, don't loop.
const RELOAD_SENTINEL = 'chunk-reload-once';
function recoverFromStaleChunk(reason: string) {
  if (sessionStorage.getItem(RELOAD_SENTINEL)) return;
  sessionStorage.setItem(RELOAD_SENTINEL, String(Date.now()));
  console.warn('[app] reloading to recover from stale chunk:', reason);
  window.location.reload();
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  recoverFromStaleChunk('vite:preloadError');
});

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes("Expected a JavaScript-or-Wasm module script")
  ) {
    recoverFromStaleChunk(msg);
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
