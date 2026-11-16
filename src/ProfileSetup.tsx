// Création du profil à la première connexion (pseudo, photo, homme/femme),
// et petite fenêtre « Homme ou femme ? » pour les comptes déjà inscrits.
// Le genre sert à accorder les notifications (« viens le / la défier »).
import { useRef, useState } from 'react'
import Avatar from './Avatar'
import './ProfileSetup.css'

export type Gender = 'h' | 'f'

interface Props {
  mode: 'full' | 'gender'
  initialPseudo: string
  avatarUrl: string | null
  avatarEmoji: string | null
  presets: string[]
  avatarSaving: boolean
  avatarError: string | null
  onPickPreset: (filename: string) => void
  onUploadPhoto: (e: React.ChangeEvent<HTMLInputElement>) => void
  // renvoie un message d'erreur, ou null si c'est enregistré
  onSubmit: (v: { pseudo: string; gender: Gender }) => Promise<string | null>
}

function GenderChoice({ value, onChange }: { value: Gender | null; onChange: (g: Gender) => void }) {
  return (
    <div className="ps-gender">
      <button type="button" className={'ps-gender-btn' + (value === 'h' ? ' on' : '')} onClick={() => onChange('h')}>
        <span className="ps-gender-ico">♂</span>Homme
      </button>
      <button type="button" className={'ps-gender-btn' + (value === 'f' ? ' on' : '')} onClick={() => onChange('f')}>
        <span className="ps-gender-ico">♀</span>Femme
      </button>
    </div>
  )
}

export default function ProfileSetup(p: Props) {
  const [pseudo, setPseudo] = useState(p.initialPseudo)
  const [gender, setGender] = useState<Gender | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const t = pseudo.trim()
    if (p.mode === 'full') {
      if (t.length < 2) return setError('Le pseudo doit faire au moins 2 caractères.')
      if (t.length > 20) return setError('Le pseudo doit faire au plus 20 caractères.')
    }
    if (!gender) return setError('Choisis Homme ou Femme.')
    setSaving(true); setError(null)
    const err = await p.onSubmit({ pseudo: t, gender })
    setSaving(false)
    if (err) setError(err)
  }

  if (p.mode === 'gender') {
    return (
      <div className="avatar-picker-overlay ps-overlay">
        <div className="avatar-picker-modal ps-modal">
          <h3>Petite question 🙂</h3>
          <p className="ps-text">Tu es un homme ou une femme ? C'est juste pour que les notifications parlent de toi correctement (« viens <b>le</b> défier » ou « viens <b>la</b> défier »).</p>
          <GenderChoice value={gender} onChange={(g) => { setGender(g); setError(null) }} />
          {error && <p className="login-error">{error}</p>}
          <button className="login-submit ps-submit" disabled={saving || !gender} onClick={submit}>
            {saving ? 'Un instant...' : 'Valider'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen ps-screen">
      <div className="login-card ps-card">
        <h1 className="login-title">Crée ton <span className="login-title-accent">profil</span></h1>
        <p className="login-subtitle">C'est comme ça que tes potes te verront dans les ligues</p>

        <div className="ps-photo">
          <Avatar pseudo={pseudo || '?'} avatarUrl={p.avatarUrl} avatarEmoji={p.avatarEmoji} size={96} />
          <div className="ps-photo-btns">
            <button type="button" className="ps-small-btn" disabled={p.avatarSaving} onClick={() => fileRef.current?.click()}>
              📷 {p.avatarUrl ? 'Changer la photo' : 'Ajouter une photo'}
            </button>
            <button type="button" className="ps-small-btn ps-small-btn-2" disabled={p.avatarSaving} onClick={() => setShowPresets((s) => !s)}>
              🖼️ Choisir un avatar
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={p.onUploadPhoto} />
        </div>
        {p.avatarSaving && <p className="ps-hint">Envoi de la photo…</p>}
        {p.avatarError && <p className="login-error">{p.avatarError}</p>}
        {showPresets && (
          <div className="avatar-preset-grid ps-presets">
            {p.presets.map((f) => {
              const url = `${import.meta.env.BASE_URL}avatar-presets/${f}`
              const on = !!p.avatarUrl && p.avatarUrl.includes(`avatar-presets/${f}`)
              return (
                <button key={f} type="button" className={'avatar-preset-option' + (on ? ' avatar-preset-option-active' : '')}
                  disabled={p.avatarSaving} onClick={() => { p.onPickPreset(f); setShowPresets(false) }}>
                  <img src={url} alt="" />
                </button>
              )
            })}
          </div>
        )}

        <label className="login-label" htmlFor="ps-pseudo">Ton pseudo</label>
        <input id="ps-pseudo" className="login-input" value={pseudo} maxLength={20}
          onChange={(e) => { setPseudo(e.target.value); setError(null) }} />

        <label className="login-label">Tu es</label>
        <GenderChoice value={gender} onChange={(g) => { setGender(g); setError(null) }} />

        {error && <p className="login-error">{error}</p>}
        <button className="login-submit ps-submit" disabled={saving} onClick={submit}>
          {saving ? 'Un instant...' : "C'est parti ⚽"}
        </button>
        <p className="ps-hint">Tu pourras tout changer plus tard dans ton Profil.</p>
      </div>
    </div>
  )
}
