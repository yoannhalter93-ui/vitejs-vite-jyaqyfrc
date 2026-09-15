import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import { EyeIcon, EyeOffIcon } from './Icons'

type Mode = 'signin' | 'signup'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Erreur renvoyée par Supabase quand on revient d'un lien reçu par email
  // (confirmation d'inscription ou mot de passe oublié) qui s'avère
  // invalide ou déjà utilisé — ça arrive très souvent avec Outlook/Hotmail,
  // qui "cliquent" automatiquement les liens pour les scanner avant même
  // que la personne ne clique vraiment, ce qui grille le lien à usage
  // unique. Sans ça, l'appli ne montrait rien : la personne atterrissait
  // juste sur l'écran de connexion sans comprendre pourquoi "ça ne marche
  // pas".
  const [linkError, setLinkError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  // Mot de passe oublié : petit formulaire à part (juste l'email), qui
  // envoie un lien de réinitialisation.
  const [showForgot, setShowForgot] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('error')) return
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const code = params.get('error_code')
    if (code === 'otp_expired') {
      setLinkError(
        "Le lien reçu par email a expiré ou a déjà été utilisé (fréquent avec Outlook/Hotmail, qui scannent le lien automatiquement). Entre ton email ci-dessous puis clique sur \"Renvoyer l'email\"."
      )
    } else {
      const desc = params.get('error_description')
      setLinkError(desc ? desc.replace(/\+/g, ' ') : "Le lien reçu par email n'est plus valide.")
    }
    // On nettoie le hash pour ne pas réafficher cette erreur si la page est
    // rechargée plus tard.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

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
        options: {
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
      })
      if (signUpError) {
        setError(signUpError.message)
      } else if (!data.session) {
        setInfo('Compte créé. Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.')
      }
    }

    setLoading(false)
  }

  const handleResend = async () => {
    if (!email) {
      setError('Entre ton email ci-dessus pour renvoyer le lien.')
      return
    }
    setResending(true)
    setError(null)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
      },
    })
    setResending(false)
    if (resendError) {
      setError(resendError.message)
    } else {
      setLinkError(null)
      setInfo('Nouvel email envoyé — vérifie ta boîte mail (et le dossier spams).')
    }
  }

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setError(null)
    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    })
    setLoading(false)
    if (resetError) {
      setError(resetError.message)
    } else {
      setForgotSent(true)
    }
  }

  if (showForgot) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-title">Entre <span className="login-title-accent">Nous</span></h1>
          <p className="login-subtitle">Mot de passe oublié</p>

          {forgotSent ? (
            <>
              <p className="login-info">
                Email envoyé à {email} — clique sur le lien qu'il contient pour choisir un nouveau mot de passe.
              </p>
              <button
                className="login-switch"
                type="button"
                onClick={() => {
                  setShowForgot(false)
                  setForgotSent(false)
                  setError(null)
                }}
              >
                Retour à la connexion
              </button>
            </>
          ) : (
            <>
              <form className="login-form" onSubmit={handleForgotSubmit}>
                <label className="login-label" htmlFor="forgot-email">
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  className="login-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />

                {error && <p className="login-error">{error}</p>}

                <button className="login-submit" type="submit" disabled={loading}>
                  {loading ? 'Un instant...' : 'Envoyer le lien de réinitialisation'}
                </button>
              </form>

              <button
                className="login-switch"
                type="button"
                onClick={() => {
                  setShowForgot(false)
                  setError(null)
                }}
              >
                Retour à la connexion
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Entre <span className="login-title-accent">Nous</span></h1>
        <p className="login-subtitle">
          {mode === 'signin' ? 'Connecte-toi pour rejoindre tes groupes' : 'Crée ton compte pour commencer'}
        </p>

        {linkError && (
          <div className="login-link-error">
            <p className="login-error">{linkError}</p>
            <button
              type="button"
              className="login-switch"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? 'Envoi...' : "Renvoyer l'email de confirmation"}
            </button>
          </div>
        )}

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
          <div className="login-password-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              className="login-input login-input-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
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

          {mode === 'signin' && (
            <button
              type="button"
              className="login-forgot-link"
              onClick={() => {
                setShowForgot(true)
                setError(null)
                setInfo(null)
              }}
            >
              Mot de passe oublié ?
            </button>
          )}

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

        <a className="login-legal-link" href={`${import.meta.env.BASE_URL}politique-confidentialite.html`}>
          Politique de confidentialité
        </a>
      </div>
    </div>
  )
}
