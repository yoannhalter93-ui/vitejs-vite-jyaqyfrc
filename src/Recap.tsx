import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Avatar from './Avatar'
import { useAuth } from './AuthContext'

export interface WeekRecap {
  week_start: string
  week_end: string
  podium: { pseudo: string; avatar_url: string | null; avatar_emoji: string | null; points: number; rank: number; is_me: boolean }[]
  me: { points: number; rank: number } | null
  members: number
  exact_king: { pseudo: string; count: number } | null
  my_exact: number
  duels: { kind: 'quiz' | 'penalty'; opponent: string | null; result: 'won' | 'lost' | 'draw' }[]
  minigame: { game: string; winner?: string | null; best?: number | null; mine?: number | null; players?: number } | null
}

interface Props {
  groupId: string
  groupName: string
  onBack: () => void
  onOpenRanking: () => void
}

const MEDALS = ['🥇', '🥈', '🥉']
const GAME_LABEL: Record<string, string> = {
  jonglage: '🤹 Jonglage',
  dribble: '⚽ Dribble',
  'coup-franc': '🧱 Coup franc',
  toro: '🐂 Le toro',
  'jeu-semaine': '🎯 But en or',
}
const RESULT_LABEL = { won: 'Gagné ✅', lost: 'Perdu', draw: 'Nul' }

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`)

// d'où viennent les points (points_ledger.source_type)
const SOURCE_LABEL: Record<string, string> = {
  match: '🎯 Pronostics',
  team_assignment: '🎡 Mon équipe',
  duel: '🧠 Duel quiz',
  minijeu: '🥅 Duel penalty',
  jonglage_chrono: '🎮 Mini-jeu',
  dribble_chrono: '🎮 Mini-jeu',
  coup_franc_chrono: '🎮 Mini-jeu',
  toro_chrono: '🎮 Mini-jeu',
  free_bet: '🤝 Paris libres',
  jeu_semaine: '🎉 Événements',
  evenement: '🎉 Événements',
}

interface WeekRow {
  profile_id: string
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
  points: number
  rank: number
  bySource: [string, number][]
}

// Classement complet de la semaine + détail par joueur, lu directement
// dans points_ledger (même fenêtre lundi → lundi que get_week_recap)
async function loadWeekRanking(groupId: string, weekStart: string): Promise<WeekRow[]> {
  const from = new Date(`${weekStart}T00:00:00Z`)
  const to = new Date(from.getTime() + 7 * 24 * 3600 * 1000)
  const [{ data: mem }, { data: ledger }] = await Promise.all([
    supabase.from('group_members').select('profile_id, profiles(pseudo, avatar_url, avatar_emoji)').eq('group_id', groupId),
    supabase.from('points_ledger').select('profile_id, source_type, points')
      .eq('group_id', groupId).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
  ])
  type Prof = { pseudo: string; avatar_url: string | null; avatar_emoji: string | null }
  const sums: Record<string, Record<string, number>> = {}
  for (const l of ledger ?? []) {
    const label = SOURCE_LABEL[l.source_type] ?? l.source_type
    sums[l.profile_id] = sums[l.profile_id] ?? {}
    sums[l.profile_id][label] = (sums[l.profile_id][label] ?? 0) + l.points
  }
  const rows = ((mem ?? []) as unknown as { profile_id: string; profiles: Prof | Prof[] | null }[]).map((m) => {
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    const bySource = Object.entries(sums[m.profile_id] ?? {}).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1])
    return {
      profile_id: m.profile_id,
      pseudo: prof?.pseudo ?? '???',
      avatar_url: prof?.avatar_url ?? null,
      avatar_emoji: prof?.avatar_emoji ?? null,
      points: bySource.reduce((t, [, v]) => t + v, 0),
      rank: 0,
      bySource,
    }
  }).sort((a, b) => b.points - a.points || a.pseudo.localeCompare(b.pseudo))
  // rang « sportif » : les ex æquo partagent la même place
  rows.forEach((row, i) => { row.rank = i > 0 && row.points === rows[i - 1].points ? rows[i - 1].rank : i + 1 })
  return rows
}

// Récap de la semaine écoulée (lundi → dimanche) du groupe : RPC
// get_week_recap. Ouvert depuis la case "Récap" de l'accueil et depuis la
// notification du lundi.
export default function Recap({ groupId, groupName, onBack, onOpenRanking }: Props) {
  const [recap, setRecap] = useState<WeekRecap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState<WeekRow[] | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const { user } = useAuth()

  const toggleFull = () => {
    if (!recap) return
    if (!showFull && !full) loadWeekRanking(groupId, recap.week_start).then(setFull)
    setShowFull((v) => !v)
  }

  useEffect(() => {
    supabase.rpc('get_week_recap', { p_group_id: groupId }).then(({ data, error: err }) => {
      if (err) setError(err.message)
      else setRecap(data as WeekRecap)
    })
  }, [groupId])

  const mg = recap?.minigame

  return (
    <div className="stats-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Accueil</button>
        <h2>Récap de la semaine</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      {!recap && !error ? (
        <div className="skeleton-stack" aria-busy="true" aria-label="Chargement">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      ) : recap && (
        <>
          <div className="stats-hero">
            <span className="stats-hero-label">
              {groupName} · du {fmtDay(recap.week_start)} au {fmtDay(recap.week_end)}
            </span>
            <span className="stats-hero-value">
              {recap.me && recap.me.points > 0 ? `+${recap.me.points}` : recap.me?.points ?? 0} pts
            </span>
            <span className="stats-hero-label">
              {recap.me && recap.me.points > 0
                ? `${ordinal(recap.me.rank)} sur ${recap.members} cette semaine`
                : 'Pas de points pour toi cette semaine'}
            </span>
          </div>

          <div className="stats-card">
            <h3 className="stats-card-title">🏆 Podium de la semaine</h3>
            {recap.podium.length === 0 ? (
              <p className="stats-empty">Personne n'a marqué de points cette semaine.</p>
            ) : showFull ? (
              !full ? (
                <div className="skeleton skeleton-block" aria-busy="true" />
              ) : (
                <ul className="recap-podium recap-full">
                  {full.map((p) => (
                    <li key={p.profile_id} className={p.profile_id === user?.id ? 'is-me' : undefined}>
                      <button
                        type="button"
                        className="recap-full-row"
                        onClick={() => setOpenId((id) => (id === p.profile_id ? null : p.profile_id))}
                        aria-expanded={openId === p.profile_id}
                      >
                        <span className="recap-medal">{p.rank <= 3 && p.points > 0 ? MEDALS[p.rank - 1] : p.rank}</span>
                        <Avatar pseudo={p.pseudo} avatarUrl={p.avatar_url} avatarEmoji={p.avatar_emoji} size={28} />
                        <span className="recap-name">{p.pseudo}</span>
                        <b>{p.points > 0 ? `+${p.points}` : p.points} pts</b>
                        <span className="recap-chevron">{openId === p.profile_id ? '▲' : '▼'}</span>
                      </button>
                      {openId === p.profile_id && (
                        p.bySource.length === 0 ? (
                          <p className="recap-detail-empty">Aucun point cette semaine.</p>
                        ) : (
                          <ul className="recap-detail">
                            {p.bySource.map(([label, pts]) => (
                              <li key={label}><span>{label}</span><b>{pts > 0 ? `+${pts}` : pts}</b></li>
                            ))}
                          </ul>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul className="recap-podium recap-podium-tap" onClick={toggleFull} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleFull() }}>
                {recap.podium.map((p, i) => (
                  <li key={p.pseudo} className={p.is_me ? 'is-me' : undefined}>
                    <span className="recap-medal">{MEDALS[Math.min(p.rank, 3) - 1] ?? MEDALS[i]}</span>
                    <Avatar pseudo={p.pseudo} avatarUrl={p.avatar_url} avatarEmoji={p.avatar_emoji} size={28} />
                    <span className="recap-name">{p.pseudo}</span>
                    <b>+{p.points} pts</b>
                  </li>
                ))}
              </ul>
            )}
            {recap.podium.length > 0 && (
              <button type="button" className="recap-full-toggle" onClick={toggleFull}>
                {showFull ? 'Revenir au podium ▲' : 'Voir tout le classement de la semaine ▼'}
              </button>
            )}
          </div>

          <div className="stats-card">
            <h3 className="stats-card-title">🎯 Pronostics</h3>
            <div className="stats-grid">
              <div>
                <b>{recap.exact_king ? recap.exact_king.pseudo : '—'}</b>
                <span>
                  {recap.exact_king
                    ? `roi des scores exacts (${recap.exact_king.count})`
                    : 'aucun score exact'}
                </span>
              </div>
              <div><b>{recap.my_exact}</b><span>score{recap.my_exact > 1 ? 's' : ''} exact{recap.my_exact > 1 ? 's' : ''} pour toi</span></div>
            </div>
          </div>

          <div className="stats-card">
            <h3 className="stats-card-title">⚔️ Tes duels</h3>
            {recap.duels.length === 0 ? (
              <p className="stats-empty">Aucun duel terminé cette semaine.</p>
            ) : (
              <ul className="recap-duels">
                {recap.duels.map((d, i) => (
                  <li key={i} className={`recap-duel-${d.result}`}>
                    <span>{d.kind === 'quiz' ? '🧠 Quiz' : '🥅 Penalty'} vs {d.opponent ?? '?'}</span>
                    <b>{RESULT_LABEL[d.result]}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {mg && (
            <div className="stats-card">
              <h3 className="stats-card-title">{GAME_LABEL[mg.game] ?? 'Mini-jeu'} · mini-jeu</h3>
              {mg.game === 'jeu-semaine' ? (
                <p className="stats-empty">Résultats dans l'écran But en or.</p>
              ) : !mg.players ? (
                <p className="stats-empty">Personne n'a joué cette semaine.</p>
              ) : (
                <div className="stats-grid">
                  <div><b>{mg.winner}</b><span>vainqueur ({mg.best})</span></div>
                  <div><b>{mg.mine ?? '—'}</b><span>{mg.mine != null ? 'ton meilleur score' : "tu n'as pas joué"}</span></div>
                </div>
              )}
            </div>
          )}

          <button className="dash-v2-cta recap-ranking-btn" onClick={onOpenRanking}>
            Voir le classement complet →
          </button>
        </>
      )}
    </div>
  )
}
