import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import TeamBadge from './TeamBadge'
import LoadingSkeleton from './LoadingSkeleton'

interface HistoryRow {
  predictionId: string
  matchId: string
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  realHomeScore: number
  realAwayScore: number
  predHomeScore: number
  predAwayScore: number
  groupName: string
}

interface Props {
  onBack: () => void
}

// Mêmes règles que la page Règles du jeu : score exact 5 pts, bon écart de
// buts + bon résultat 4 pts, juste le bon résultat 3 pts, sinon 0.
function pointsFor(predHome: number, predAway: number, realHome: number, realAway: number): number {
  if (predHome === realHome && predAway === realAway) return 5
  const predDiff = predHome - predAway
  const realDiff = realHome - realAway
  const sameOutcome = Math.sign(predDiff) === Math.sign(realDiff)
  if (!sameOutcome) return 0
  return predDiff === realDiff ? 4 : 3
}

export default function PredictionsHistory({ onBack }: Props) {
  const { user } = useAuth()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      // Tous les pronos de l'utilisateur, tous groupes confondus, avec le
      // match et le groupe associés — on filtre côté client sur les matchs
      // résolus (les seuls pour lesquels on a un vrai score à comparer).
      const { data, error: err } = await supabase
        .from('match_predictions')
        .select(
          'id, match_id, pred_home_score, pred_away_score, matches(id, home_team, away_team, kickoff_at, status, real_home_score, real_away_score, group_id, groups(name))'
        )
        .eq('profile_id', user.id)

      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      type Raw = {
        id: string
        match_id: string
        pred_home_score: number
        pred_away_score: number
        matches:
          | {
              id: string
              home_team: string
              away_team: string
              kickoff_at: string
              status: string
              real_home_score: number | null
              real_away_score: number | null
              group_id: string
              groups: { name: string } | { name: string }[] | null
            }
          | {
              id: string
              home_team: string
              away_team: string
              kickoff_at: string
              status: string
              real_home_score: number | null
              real_away_score: number | null
              group_id: string
              groups: { name: string } | { name: string }[] | null
            }[]
          | null
      }

      const list: HistoryRow[] = ((data ?? []) as unknown as Raw[])
        .map((r) => {
          const m = Array.isArray(r.matches) ? r.matches[0] : r.matches
          if (!m || m.status !== 'resolved' || m.real_home_score == null || m.real_away_score == null) return null
          const g = Array.isArray(m.groups) ? m.groups[0] : m.groups
          return {
            predictionId: r.id,
            matchId: m.id,
            homeTeam: m.home_team,
            awayTeam: m.away_team,
            kickoffAt: m.kickoff_at,
            realHomeScore: m.real_home_score,
            realAwayScore: m.real_away_score,
            predHomeScore: r.pred_home_score,
            predAwayScore: r.pred_away_score,
            groupName: g?.name ?? '',
          } as HistoryRow
        })
        .filter((r): r is HistoryRow => r !== null)
        .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime())

      setRows(list)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user])

  const totalPoints = rows.reduce(
    (sum, r) => sum + pointsFor(r.predHomeScore, r.predAwayScore, r.realHomeScore, r.realAwayScore),
    0
  )

  return (
    <div className="history-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Profil</button>
        <h2>Historique de mes pronos</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <p className="groups-empty">Aucun pronostic résolu pour l'instant.</p>
      ) : (
        <>
          <p className="history-total">
            {rows.length} pronostic{rows.length > 1 ? 's' : ''} joué{rows.length > 1 ? 's' : ''} · {totalPoints} pts au total
          </p>
          <ul className="history-list">
            {rows.map((r) => {
              const pts = pointsFor(r.predHomeScore, r.predAwayScore, r.realHomeScore, r.realAwayScore)
              const tier = pts === 5 ? 'exact' : pts > 0 ? 'partiel' : 'rate'
              return (
                <li key={r.predictionId} className="history-row">
                  <div className="history-row-top">
                    <span className="history-row-group">{r.groupName}</span>
                    <span className="history-row-date">
                      {new Date(r.kickoffAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div className="history-row-match">
                    <span className="history-row-team">
                      <TeamBadge name={r.homeTeam} size={22} />
                      {r.homeTeam}
                    </span>
                    <span className="history-row-score history-row-score-real">
                      {r.realHomeScore} - {r.realAwayScore}
                    </span>
                    <span className="history-row-team history-row-team-right">
                      {r.awayTeam}
                      <TeamBadge name={r.awayTeam} size={22} />
                    </span>
                  </div>
                  <div className="history-row-bottom">
                    <span className="history-row-pred">Ton prono : {r.predHomeScore} - {r.predAwayScore}</span>
                    <span className={`history-row-pts history-row-pts-${tier}`}>
                      {pts > 0 ? `+${pts} pts` : '0 pt'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
