import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface MatchRow {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: 'open' | 'resolved' | 'cancelled'
  real_home_score: number | null
  real_away_score: number | null
}

interface PredictionRow {
  id: string
  match_id: string
  pred_home_score: number
  pred_away_score: number
}

interface Props {
  groupId: string
  groupName: string
  onBack: () => void
}

export default function Predictions({ groupId, groupName, onBack }: Props) {
  const { user } = useAuth()
  const [periodLabel, setPeriodLabel] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [predictions, setPredictions] = useState<Record<string, PredictionRow>>({})
  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: period, error: periodError } = await supabase
      .from('group_periods')
      .select('id, label')
      .eq('group_id', groupId)
      .eq('is_current', true)
      .maybeSingle()

    if (periodError) {
      setError(periodError.message)
      setLoading(false)
      return
    }
    if (!period) {
      setPeriodLabel(null)
      setMatches([])
      setLoading(false)
      return
    }
    setPeriodLabel(period.label)

    const { data: matchesData, error: matchesError } = await supabase
      .from('matches')
      .select('id, home_team, away_team, kickoff_at, status, real_home_score, real_away_score')
      .eq('group_id', groupId)
      .eq('period_id', period.id)
      .order('kickoff_at', { ascending: true })

    if (matchesError) {
      setError(matchesError.message)
      setLoading(false)
      return
    }
    setMatches(matchesData ?? [])

    const matchIds = (matchesData ?? []).map((m) => m.id)
    if (matchIds.length > 0) {
      const { data: predsData, error: predsError } = await supabase
        .from('match_predictions')
        .select('id, match_id, pred_home_score, pred_away_score')
        .eq('profile_id', user.id)
        .in('match_id', matchIds)

      if (predsError) {
        setError(predsError.message)
        setLoading(false)
        return
      }

      const map: Record<string, PredictionRow> = {}
      const draftMap: Record<string, { home: string; away: string }> = {}
      for (const p of predsData ?? []) {
        map[p.match_id] = p
        draftMap[p.match_id] = { home: String(p.pred_home_score), away: String(p.pred_away_score) }
      }
      setPredictions(map)
      setDrafts(draftMap)
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const handleDraftChange = (matchId: string, field: 'home' | 'away', value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [matchId]: { ...(prev[matchId] ?? { home: '', away: '' }), [field]: value },
    }))
  }

  const handleSave = async (matchId: string) => {
    if (!user) return
    const draft = drafts[matchId]
    if (!draft || draft.home === '' || draft.away === '') return

    setSavingId(matchId)
    setError(null)

    const { data, error: saveError } = await supabase
      .from('match_predictions')
      .upsert(
        {
          match_id: matchId,
          profile_id: user.id,
          pred_home_score: Number(draft.home),
          pred_away_score: Number(draft.away),
        },
        { onConflict: 'match_id,profile_id' }
      )
      .select()
      .single()

    if (saveError) {
      setError(saveError.message)
    } else if (data) {
      setPredictions((prev) => ({ ...prev, [matchId]: data }))
    }
    setSavingId(null)
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Groupes</button>
        <h2>{groupName}</h2>
      </div>

      {periodLabel && <p className="predictions-period">Période : {periodLabel}</p>}

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement des matchs...</p>
      ) : matches.length === 0 ? (
        <p className="groups-empty">Aucun match pour la période en cours.</p>
      ) : (
        <ul className="matches-list">
          {matches.map((m) => {
            const isOpen = m.status === 'open' && new Date(m.kickoff_at).getTime() > Date.now()
            const draft = drafts[m.id] ?? { home: '', away: '' }
            const hasPrediction = !!predictions[m.id]

            return (
              <li className="match-card" key={m.id}>
                <div className="match-teams">
                  <span>{m.home_team}</span>
                  <span className="match-vs">vs</span>
                  <span>{m.away_team}</span>
                </div>
                <div className="match-kickoff">
                  {new Date(m.kickoff_at).toLocaleString('fr-FR', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>

                {m.status === 'resolved' ? (
                  <div className="match-result">
                    Score final : {m.real_home_score} - {m.real_away_score}
                    {hasPrediction && (
                      <span className="match-my-pred">
                        {' '}(ton pronostic : {predictions[m.id].pred_home_score} - {predictions[m.id].pred_away_score})
                      </span>
                    )}
                  </div>
                ) : isOpen ? (
                  <div className="match-predict">
                    <input
                      type="number"
                      min={0}
                      className="match-score-input"
                      value={draft.home}
                      onChange={(e) => handleDraftChange(m.id, 'home', e.target.value)}
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min={0}
                      className="match-score-input"
                      value={draft.away}
                      onChange={(e) => handleDraftChange(m.id, 'away', e.target.value)}
                    />
                    <button
                      className="match-save-btn"
                      onClick={() => handleSave(m.id)}
                      disabled={savingId === m.id}
                    >
                      {savingId === m.id ? '...' : hasPrediction ? 'Modifier' : 'Valider'}
                    </button>
                  </div>
                ) : m.status === 'cancelled' ? (
                  <div className="match-cancelled">Match annulé</div>
                ) : (
                  <div className="match-cancelled">
                    Pronostics clôturés (coup d'envoi passé)
                    {hasPrediction && (
                      <span className="match-my-pred">
                        {' '}(ton pronostic : {predictions[m.id].pred_home_score} - {predictions[m.id].pred_away_score})
                      </span>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
