import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Avatar from './Avatar'

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
  'jeu-semaine': '🎯 But en or',
}
const RESULT_LABEL = { won: 'Gagné ✅', lost: 'Perdu', draw: 'Nul' }

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`)

// Récap de la semaine écoulée (lundi → dimanche) du groupe : RPC
// get_week_recap. Ouvert depuis la case "Récap" de l'accueil et depuis la
// notification du lundi.
export default function Recap({ groupId, groupName, onBack, onOpenRanking }: Props) {
  const [recap, setRecap] = useState<WeekRecap | null>(null)
  const [error, setError] = useState<string | null>(null)

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
            ) : (
              <ul className="recap-podium">
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
