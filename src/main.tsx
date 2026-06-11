import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/vazirmatn/400.css'
import '@fontsource/vazirmatn/500.css'
import '@fontsource/vazirmatn/700.css'
import '@fontsource/vazirmatn/800.css'
import './index.css'
import App from './App.tsx'
import { installErrorCapture } from './logger'

installErrorCapture()   // capture errors/events for the in-app diagnostics log

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ثبتِ سرویس‌ورکر فقط در نسخه‌ی وب (نه در اپِ اندرویدِ Capacitor) و فقط در production
if (import.meta.env.PROD && !(window as any).Capacitor && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* بدونِ آفلاین هم کار می‌کند */ });
  });
}
