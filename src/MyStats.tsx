import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

interface Record3 { played: number; won: number; draw: number; lost: number }

interface Stats {
  predictions: { played: number; exact: number; good_result: number; points: number }
  quiz: Record3
  penalty: Record3
  minigames: { best_juggle: number | null; best_dribble: number | null; games_played: number }
  free_bets: { votes: number; created: number; points: number }
  total_points: number
}

interface Props {
  onBack: () => void
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

function DuelRecord({ title, icon, r }: { title: string; icon: string; r: Record3 }) {
  return (
    <div className="stats-card">
      <h3 className="stats-card-title">{icon} {title}</h3>
      {r.played === 0 ? (
        <p className="stats-empty">Aucun duel terminé pour l'instant.</p>
      ) : (
        <>
          <div className="stats-record">
            <span className="stats-record-won"><b>{r.won}</b> V</span>
            <span className="stats-record-draw"><b>{r.draw}</b> N</span>
            <span className="stats-record-lost"><b>{r.lost}</b> D</span>
          </div>
          <div className="stats-bar" aria-hidden="true">
            <span className="stats-bar-won" style={{ width: `${pct(r.won, r.played)}%` }} />
            <span className="stats-bar-draw" style={{ width: `${pct(r.draw, r.played)}%` }} />
            <span className="stats-bar-lost" style={{ width: `${pct(r.lost, r.played)}%` }} />
          </div>
          <p className="stats-sub">{pct(r.won, r.played)} % de victoires sur {r.played} duel{r.played > 1 ? 's' : ''}</p>
        </>
      )}
    </div>
  )
}

// Profil > Mes statistiques : tous groupes confondus, calculé côté serveur
// (RPC get_my_stats).
export default function MyStats({ onBack }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('get_my_stats').then(({ data, error: err }) => {
      if (err) setError(err.message)
      else setStats(data as Stats)
    })
  }, [])

  const p = stats?.predictions

  return (
    <div className="stats-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Profil</button>
        <h2>Mes statistiques</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      {!stats && !error ? (
        <div className="skeleton-stack" aria-busy="true" aria-label="Chargement">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      ) : stats && p && (
        <>
          <div className="stats-hero">
            <span className="stats-hero-value">{stats.total_points}</span>
            <span className="stats-hero-label">points marqués au total</span>
          </div>

          <div className="stats-card">
            <h3 className="stats-card-title">🎯 Pronostics</h3>
            {p.played === 0 ? (
              <p className="stats-empty">Aucun pronostic résolu pour l'instant.</p>
            ) : (
              <div className="stats-grid">
                <div><b>{p.played}</b><span>joués</span></div>
                <div><b>{p.exact}</b><span>scores exacts</span></div>
                <div><b>{pct(p.good_result, p.played)} %</b><span>bons résultats</span></div>
                <div><b>{p.points}</b><span>points</span></div>
              </div>
            )}
          </div>

          <DuelRecord title="Duels quiz" icon="🧠" r={stats.quiz} />
          <DuelRecord title="Duels penalty" icon="🥅" r={stats.penalty} />

          <div className="stats-card">
            <h3 className="stats-card-title">🤹 Mini-jeux</h3>
            <div className="stats-grid">
              <div><b>{stats.minigames.best_juggle ?? '—'}</b><span>record jonglage</span></div>
              <div><b>{stats.minigames.best_dribble ?? '—'}</b><span>record dribble</span></div>
              <div><b>{stats.minigames.games_played}</b><span>parties jouées</span></div>
            </div>
          </div>

          <div className="stats-card">
            <h3 className="stats-card-title">🤝 Paris libres</h3>
            <div className="stats-grid">
              <div><b>{stats.free_bets.votes}</b><span>votes</span></div>
              <div><b>{stats.free_bets.created}</b><span>paris lancés</span></div>
              <div><b>{stats.free_bets.points}</b><span>points</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
