// MUST be the first import — installs crypto.randomUUID polyfill before
// any other module (e.g. stores) is evaluated.
import './polyfills.ts'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { enableMapSet } from 'immer'
import './index.css'
import App from './App.tsx'

// Polyfill crypto.randomUUID for non-secure contexts (HTTP over IP/LAN).
// Browsers only expose it on HTTPS or http://localhost. RFC4122 v4 fallback.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  ;(crypto as Crypto & { randomUUID: () => `${string}-${string}-${string}-${string}-${string}` }).randomUUID =
    function randomUUID() {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}` as `${string}-${string}-${string}-${string}-${string}`
    }
}

// Enable Map/Set support in immer drafts (used by synthStore.activeNotes Set).
enableMapSet()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
