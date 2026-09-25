import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './home-v2.css'
import './home-v2-details.css'
import './home-visual-reference.css'
import './home-reference-polish.css'
import './home-reference-exact.css'
import './home-approved-final.css'
import './ux.css'
import { AuthProvider } from './AuthContext'
import { capturePendingJoinFromUrl } from './invite'

// lien d'invitation ?join=CODE : mémorisé avant tout rendu (voir invite.ts)
capturePendingJoinFromUrl()

// Bloque le pincer-zoomer "pour de vrai" : le CSS touch-action seul (voir
// App.css) ne suffit pas sur certains navigateurs Android (Samsung
// Internet notamment), qui laissent quand même passer le geste à deux
// doigts. On intercepte donc directement les événements tactiles :
// touchmove à plusieurs doigts = un pincement en cours, on l'annule ;
// gesturestart est l'événement dédié au pincement sur WebKit/Safari.
// { passive: false } est indispensable, sinon preventDefault() est ignoré.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault()
  },
  { passive: false }
)
document.addEventListener('gesturestart', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
