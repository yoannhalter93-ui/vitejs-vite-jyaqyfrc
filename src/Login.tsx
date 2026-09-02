import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'

type Mode = 'signin' | 'signup'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)

    if (mode === 'signin') {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) {
        setError(signInError.message)
      }
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })
      if (signUpError) {
        setError(signUpError.message)
      } else if (!data.session) {
        setInfo('Compte créé. Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.')
      }
    }

    setLoading(false)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Entre <span className="login-title-accent">Nous</span></h1>
        <p className="login-subtitle">
          {mode === 'signin' ? 'Connecte-toi pour rejoindre tes groupes' : 'Crée ton compte pour commencer'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <label className="login-label" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />

          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Un instant...' : mode === 'signin' ? 'Se connecter' : "S'inscrire"}
          </button>
        </form>

        <button
          className="login-switch"
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setInfo(null)
          }}
        >
          {mode === 'signin' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
        </button>
      </div>
    </div>
  )
}