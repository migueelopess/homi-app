import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerSW } from 'virtual:pwa-register'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Fade out the splash screen (index.html) once React is up. Keep it visible
// for at least ~1.1s from page load so the logo animation has time to play.
const splash = document.getElementById('splash')
if (splash) {
  const MIN_SPLASH_MS = 1100
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
