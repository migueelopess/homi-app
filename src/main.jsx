import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerSW } from 'virtual:pwa-register'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Fade out the splash screen (index.html) once React is up. Held only until the
// intro animation finishes — the mark pops over 0.65s and the wordmark settles
// at 0.85s, so anything beyond that is the app making a warm start wait for
// nothing. The fade itself sets pointer-events:none straight away, so the app
// is already tappable while it clears.
const splash = document.getElementById('splash')
if (splash) {
  const MIN_SPLASH_MS = 850
  const delay = Math.max(0, MIN_SPLASH_MS - performance.now())
  setTimeout(() => {
    splash.classList.add('splash-hide')
    setTimeout(() => splash.remove(), 600)
  }, delay)
}

// Register service worker for PWA + push notifications
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Verifica atualizações a cada 60 minutos
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000);
    }
  },
})
