import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Avatar from './Avatar'
import { useAuth } from './AuthContext'
import { shareInvite } from './invite'

// ============================================================================
// Salle d'attente d'une nouvelle ligue (groups.awaiting_kickoff) : affichée à
// la place de l'accueil tant que le créateur n'a pas lancé le championnat.
// On voit qui est déjà là, on invite, et le créateur appuie sur « Lancer le
// championnat » quand tout le monde est arrivé (start_group_championship).
// ============================================================================

interface Member {
  profile_id: string
  role: string
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

type Prof = { pseudo: string | null; avatar_url: string | null; avatar_emoji: string | null }

export default function WaitingRoom({ groupId, groupName, onStarted }: {
  groupId: string
  groupName: string
  onStarted: () => void
}) {
  const { user } = useAuth()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const onStartedRef = useRef(onStarted)
  onStartedRef.current = onStarted

  const load = useCallback(async () => {
    const [{ data: mem }, { data: grp }] = await Promise.all([
      supabase.from('group_members').select('profile_id, role, joined_at, profiles(pseudo, avatar_url, avatar_emoji)')
        .eq('group_id', groupId).order('joined_at'),
      supabase.from('groups').select('invite_code, awaiting_kickoff').eq('id', groupId).maybeSingle(),
    ])
    // le créateur a lancé pendant qu'on regardait l'écran
    if (grp && grp.awaiting_kickoff === false) { onStartedRef.current(); return }
    setInviteCode(grp?.invite_code ?? null)
    setMembers(((mem ?? []) as unknown as { profile_id: string; role: string; profiles: Prof | Prof[] | null }[]).map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { profile_id: m.profile_id, role: m.role, pseudo: p?.pseudo ?? '???', avatar_url: p?.avatar_url ?? null, avatar_emoji: p?.avatar_emoji ?? null }
    }))
  }, [groupId])

  // liste à jour sans recharger : nouveaux arrivants toutes les 15 s
  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const isOwner = !!members?.some((m) => m.profile_id === user?.id && m.role === 'owner')

  const invite = async () => {
    if (!inviteCode) return
    const r = await shareInvite(groupName, inviteCode)
    if (r === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  const start = async () => {
    const n = members?.length ?? 0
    if (!window.confirm(`Lancer le championnat de « ${groupName} » avec ${n} joueur${n > 1 ? 's' : ''} ? Tout le monde tire son équipe maintenant. Ceux qui arrivent après pourront toujours rejoindre.`)) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('start_group_championship', { p_group_id: groupId })
    setBusy(false)
    if (err) { setError(err.message); return }
    onStartedRef.current()
  }

  return (
    <div className="stats-screen waiting-room">
      <div className="stats-hero waiting-hero">
        <span className="waiting-icon">⏳</span>
        <span className="stats-hero-label">En attente du coup d'envoi</span>
        <span className="waiting-title">{groupName}</span>
        <span className="stats-hero-label">
          {isOwner
            ? 'Invite tes potes, puis lance le championnat quand tout le monde est là.'
            : 'Le créateur lancera le championnat quand tout le monde sera là. Tu seras prévenu 🔔'}
        </span>
      </div>

      {error && <p className="groups-error">{error}</p>}

      <div className="stats-card">
        <h3 className="stats-card-title">👥 Déjà là {members ? `(${members.length})` : ''}</h3>
        {!members ? (
          <div className="skeleton skeleton-block" aria-busy="true" />
        ) : (
          <ul className="recap-podium">
            {members.map((m) => (
              <li key={m.profile_id} className={m.profile_id === user?.id ? 'is-me' : undefined}>
                <Avatar pseudo={m.pseudo} avatarUrl={m.avatar_url} avatarEmoji={m.avatar_emoji} size={28} />
                <span className="recap-name">{m.pseudo}</span>
                {m.role === 'owner' && <span className="waiting-owner">👑 créateur</span>}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="groups-card-share-btn waiting-invite" onClick={invite} disabled={!inviteCode}>
          {copied ? 'Lien copié ✓' : '📤 Inviter des potes'}
        </button>
        {inviteCode && <p className="waiting-code">Code d'invitation : <code>{inviteCode}</code></p>}
      </div>

      {isOwner && (
        <div className="stats-card waiting-start">
          <button type="button" className="dribble-cta waiting-start-btn" disabled={busy} onClick={start}>
            {busy ? 'Lancement…' : '⚽ Lancer le championnat'}
          </button>
          <p>Au lancement : chacun tire son équipe à la roue 🎡, les pronos s'ouvrent et les duels démarrent dans les jours qui suivent.</p>
        </div>
      )}
    </div>
  )
}
