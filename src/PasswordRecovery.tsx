import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import { EyeIcon, EyeOffIcon } from './Icons'

interface Props {
  onDone: () => void
}

// Écran affiché quand on revient du lien "mot de passe oublié" reçu par
// email (Supabase redirige vers l'appli avec "#type=recovery..." dans
// l'URL et connecte temporairement la personne le temps qu'elle choisisse
// un nouveau mot de passe) — voir la détection dans App.tsx.
export default function PasswordRecovery({ onDone }: Props) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(
        updateError.message.toLowerCase().includes('session')
          ? "Le lien a expiré. Redemande un email depuis l'écran de connexion (Mot de passe oublié ?)."
          : updateError.message
      )
      setLoading(false)
      return
    }

    // On nettoie le "#type=recovery..." de l'URL pour ne pas re-déclencher
    // cet écran si la page est rechargée.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-title">Entre <span className="login-title-accent">Nous</span></h1>
          <p className="login-subtitle">Mot de passe mis à jour !</p>
          <button className="login-submit" type="button" onClick={onDone}>
            Continuer →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Entre <span className="login-title-accent">Nous</span></h1>
        <p className="login-subtitle">Choisis un nouveau mot de passe</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="new-password">
            Nouveau mot de passe
          </label>
          <div className="login-password-wrap">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              className="login-input login-input-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
            </button>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Un instant...' : 'Valider le nouveau mot de passe'}
          </button>
        </form>
      </div>
    </div>
  )
}
