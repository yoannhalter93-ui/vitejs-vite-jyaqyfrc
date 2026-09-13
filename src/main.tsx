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
import { AuthProvider } from './AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
