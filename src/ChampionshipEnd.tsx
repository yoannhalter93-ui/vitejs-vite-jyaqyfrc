import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Avatar from './Avatar'
import { useAuth } from './AuthContext'

// ============================================================================
// Page de fin de championnat : affichée à la place de l'accueil quand la
// ligue est arrêtée (groups.ended_at). Podium, classement complet (détail des
// points au toucher), trophées et stats. Le créateur peut relancer un
// nouveau championnat : tout le monde repart à 0.
// ============================================================================

interface Row {
  profile_id: string
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
  points: number
  rank: number
  by_source: Record<string, number>
  good_predictions: number
}

interface Summary {
  period_id: string
  label: string
  starts_at: string
  ends_at: string
  is_owner: boolean
  matches_played: number
  ranking: Row[]
}

const MEDALS = ['🥇', '🥈', '🥉']

const SOURCE_LABEL: Record<string, string> = {
  match: '🎯 Pronostics',
  team_assignment: '🎡 Mon équipe',
  duel: '🧠 Duel quiz',
  minijeu: '🥅 Duel penalty',
  jonglage_chrono: '🎮 Mini-jeux',
  dribble_chrono: '🎮 Mini-jeux',
  coup_franc_chrono: '🎮 Mini-jeux',
  toro_chrono: '🎮 Mini-jeux',
  free_bet: '🤝 Paris libres',
  jeu_semaine: '🎉 Événements',
  evenement: '🎉 Événements',
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

// points regroupés par libellé (les 4 mini-jeux n'en font qu'un)
function grouped(r: Row): [string, number][] {
  const sums: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.by_source ?? {})) {
    const label = SOURCE_LABEL[k] ?? k
    sums[label] = (sums[label] ?? 0) + v
  }
  return Object.entries(sums).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1])
}

// trophée = celui qui a le plus de points dans une catégorie (ex æquo : tous)
function award(rows: Row[], score: (r: Row) => number) {
  const best = Math.max(0, ...rows.map(score))
  if (best <= 0) return null
  return { names: rows.filter((r) => score(r) === best).map((r) => r.pseudo), value: best }
}

const sumOf = (r: Row, keys: string[]) => keys.reduce((t, k) => t + (r.by_source?.[k] ?? 0), 0)

export default function ChampionshipEnd({ groupId, groupName, onRestarted }: {
  groupId: string
  groupName: string
  onRestarted: () => void
}) {
  const { user } = useAuth()
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.rpc('get_championship_summary', { p_group_id: groupId }).then(({ data, error }) => {
      if (error) setError(error.message)
      else setData(data as Summary | null)
    })
  }, [groupId])

  const restart = async () => {
    if (!window.confirm(`Relancer un nouveau championnat dans « ${groupName} » ? Tout le monde repart à 0 et retire son équipe à la roue.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('restart_group_championship', { p_group_id: groupId })
    setBusy(false)
    if (error) { setError(error.message); return }
    onRestarted()
  }

  if (error) return <div className="stats-screen"><p className="groups-error">{error}</p></div>
  if (!data) {
    return (
      <div className="stats-screen">
        <div className="skeleton-stack" aria-busy="true" aria-label="Chargement">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      </div>
    )
  }

  const rows = data.ranking ?? []
  const me = rows.find((r) => r.profile_id === user?.id)
  const champion = rows.find((r) => r.rank === 1 && r.points > 0)
  const podium = rows.filter((r) => r.rank <= 3 && r.points > 0)
  const totalPoints = rows.reduce((t, r) => t + Math.max(0, r.points), 0)
  const awards = [
    { icon: '🎯', title: 'Meilleur pronostiqueur', a: award(rows, (r) => r.by_source?.match ?? 0), unit: 'pts' },
    { icon: '✅', title: 'Le plus de bons pronos', a: award(rows, (r) => r.good_predictions), unit: 'pronos' },
    { icon: '🧠', title: 'Roi du quiz', a: award(rows, (r) => r.by_source?.duel ?? 0), unit: 'pts' },
    { icon: '🥅', title: 'Roi du penalty', a: award(rows, (r) => r.by_source?.minijeu ?? 0), unit: 'pts' },
    { icon: '🎮', title: 'As des mini-jeux', a: award(rows, (r) => sumOf(r, ['jonglage_chrono', 'dribble_chrono', 'coup_franc_chrono', 'toro_chrono'])), unit: 'pts' },
    { icon: '🎡', title: 'Meilleure équipe', a: award(rows, (r) => r.by_source?.team_assignment ?? 0), unit: 'pts' },
  ].filter((x) => x.a)

  return (
    <div className="stats-screen champ-end">
      <div className="stats-hero champ-end-hero">
        <span className="champ-end-flag">🏁</span>
        <span className="stats-hero-label">Championnat terminé</span>
        <span className="champ-end-title">{groupName}</span>
        <span className="stats-hero-label">{data.label} · du {fmtDay(data.starts_at)} au {fmtDay(data.ends_at)}</span>
        {champion && (
          <span className="champ-end-champion">👑 Champion : <b>{champion.pseudo}</b></span>
        )}
        {me && (
          <span className="stats-hero-label">
            Toi : {me.rank === 1 && me.points > 0 ? 'CHAMPION 👑' : `${me.rank}e`} avec {me.points} pts
          </span>
        )}
      </div>

      {podium.length > 0 && (
        <div className="champ-end-podium">
          {[1, 0, 2].map((i) => podium[i] && (
            <div key={podium[i].profile_id} className={`champ-end-step step-${podium[i].rank}`}>
              <Avatar pseudo={podium[i].pseudo} avatarUrl={podium[i].avatar_url} avatarEmoji={podium[i].avatar_emoji} size={i === 0 ? 56 : 44} />
              <span className="champ-end-step-name">{podium[i].pseudo}</span>
              <span className="champ-end-step-pts">{podium[i].points} pts</span>
              <div className="champ-end-step-block">{MEDALS[podium[i].rank - 1]}</div>
            </div>
          ))}
        </div>
      )}

      <div className="stats-card">
        <h3 className="stats-card-title">📋 Classement final</h3>
        <ul className="recap-podium recap-full">
          {rows.map((r) => (
            <li key={r.profile_id} className={r.profile_id === user?.id ? 'is-me' : undefined}>
              <button
                type="button"
                className="recap-full-row"
                onClick={() => setOpenId((id) => (id === r.profile_id ? null : r.profile_id))}
                aria-expanded={openId === r.profile_id}
              >
                <span className="recap-medal">{r.rank <= 3 && r.points > 0 ? MEDALS[r.rank - 1] : r.rank}</span>
                <Avatar pseudo={r.pseudo} avatarUrl={r.avatar_url} avatarEmoji={r.avatar_emoji} size={28} />
                <span className="recap-name">{r.pseudo}</span>
                <b>{r.points} pts</b>
                <span className="recap-chevron">{openId === r.profile_id ? '▲' : '▼'}</span>
              </button>
              {openId === r.profile_id && (
                grouped(r).length === 0 ? (
                  <p className="recap-detail-empty">Aucun point sur ce championnat.</p>
                ) : (
                  <ul className="recap-detail">
                    {grouped(r).map(([label, pts]) => (
                      <li key={label}><span>{label}</span><b>{pts > 0 ? `+${pts}` : pts}</b></li>
                    ))}
                    <li><span>✅ Bons pronos</span><b>{r.good_predictions}</b></li>
                  </ul>
                )
              )}
            </li>
          ))}
        </ul>
      </div>

      {awards.length > 0 && (
        <div className="stats-card">
          <h3 className="stats-card-title">🏅 Les trophées</h3>
          <ul className="champ-end-awards">
            {awards.map((x) => (
              <li key={x.title}>
                <span className="champ-end-award-icon">{x.icon}</span>
                <span className="champ-end-award-text">
                  <span className="champ-end-award-title">{x.title}</span>
                  <b>{x.a!.names.join(', ')}</b>
                </span>
                <span className="champ-end-award-value">{x.a!.value} {x.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats-card">
        <h3 className="stats-card-title">📊 Le championnat en chiffres</h3>
        <div className="champ-end-figures">
          <div><b>{data.matches_played}</b><span>matchs joués</span></div>
          <div><b>{rows.length}</b><span>joueurs</span></div>
          <div><b>{totalPoints}</b><span>points distribués</span></div>
        </div>
      </div>

      <div className="stats-card champ-end-next">
        {data.is_owner ? (
          <>
            <p>Tu es le créateur de la ligue : tu peux lancer un nouveau championnat. Tout le monde repart à 0 et retire son équipe à la roue 🎡</p>
            <button type="button" className="dribble-cta champ-end-restart" disabled={busy} onClick={restart}>
              {busy ? 'Lancement…' : '▶️ Relancer un championnat'}
            </button>
          </>
        ) : (
          <p>La ligue est à l'arrêt. Si le créateur relance un championnat, tu seras prévenu et tout le monde repartira à 0.</p>
        )}
      </div>
    </div>
  )
}
