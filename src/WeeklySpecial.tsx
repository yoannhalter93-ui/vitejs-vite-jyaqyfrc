import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import TeamBadge from './TeamBadge'
import Avatar from './Avatar'

interface SpecialMatch {
  id: string
  week_start: string
  match_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  real_first_scorer_team: 'domicile' | 'exterieur' | 'aucun_but' | null
  real_first_goal_minute: number | null
  resolved: boolean
}

interface PredictionRow {
  id: string
  match_id: string
  pred_team: 'domicile' | 'exterieur' | 'aucun_but'
  pred_minute: number | null
}

interface RevealRow {
  profile_id: string
  pred_team: 'domicile' | 'exterieur' | 'aucun_but'
  pred_minute: number | null
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

// Selon comment Supabase infère la relation profile_id -> profiles, le champ
// embarqué peut revenir sous forme d'objet OU de tableau à 1 élément — même
// précaution que dans Classement.tsx pour ce même genre de jointure.
type RawReveal = {
  profile_id: string
  pred_team: 'domicile' | 'exterieur' | 'aucun_but'
  pred_minute: number | null
  profiles:
    | { pseudo: string; avatar_url: string | null; avatar_emoji: string | null }
    | { pseudo: string; avatar_url: string | null; avatar_emoji: string | null }[]
    | null
}

interface Props {
  groupId: string
  groupName: string
}

const TEAM_LABELS: Record<'domicile' | 'exterieur' | 'aucun_but', string> = {
  domicile: 'Domicile',
  exterieur: 'Extérieur',
  aucun_but: 'Aucun but (0-0)',
}

export default function WeeklySpecial({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [matches, setMatches] = useState<SpecialMatch[]>([])
  const [predictions, setPredictions] = useState<Record<string, PredictionRow>>({})
  const [minuteDrafts, setMinuteDrafts] = useState<Record<string, string>>({})
  const [myPoints, setMyPoints] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [reveals, setReveals] = useState<Record<string, RevealRow[]>>({})
  const [revealLoading, setRevealLoading] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    // la semaine en cours = le week_start le plus récent présent en base
    // (une seule semaine à la fois est activée manuellement)
    const { data: latest, error: latestError } = await supabase
      .from('weekly_special_matches')
      .select('week_start')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) {
      setError(latestError.message)
      setLoading(false)
      return
    }
    if (!latest) {
      setMatches([])
      setLoading(false)
      return
    }

    const { data: matchesData, error: matchesError } = await supabase
      .from('weekly_special_matches')
      .select('id, week_start, match_number, home_team, away_team, kickoff_at, real_first_scorer_team, real_first_goal_minute, resolved')
      .eq('week_start', latest.week_start)
      .order('match_number', { ascending: true })

    if (matchesError) {
      setError(matchesError.message)
      setLoading(false)
      return
    }
    setMatches(matchesData ?? [])

    const matchIds = (matchesData ?? []).map((m) => m.id)
    if (matchIds.length > 0) {
      const { data: predsData, error: predsError } = await supabase
        .from('weekly_special_predictions')
        .select('id, match_id, pred_team, pred_minute')
        .eq('group_id', groupId)
        .eq('profile_id', user.id)
        .in('match_id', matchIds)

      if (predsError) {
        setError(predsError.message)
        setLoading(false)
        return
      }

      const map: Record<string, PredictionRow> = {}
      const minuteMap: Record<string, string> = {}
      for (const p of predsData ?? []) {
        map[p.match_id] = p
        minuteMap[p.match_id] = p.pred_minute != null ? String(p.pred_minute) : ''
      }
      setPredictions(map)
      setMinuteDrafts(minuteMap)

      const resolvedIds = (matchesData ?? []).filter((m) => m.resolved).map((m) => m.id)
      const predIds = Object.values(map).map((p) => p.id)
      if (resolvedIds.length > 0 && predIds.length > 0) {
        const { data: pointsData } = await supabase
          .from('points_ledger')
          .select('source_id, points')
          .eq('group_id', groupId)
          .eq('source_type', 'jeu_semaine')
          .in('source_id', predIds)
        const pointsMap: Record<string, number> = {}
        for (const row of pointsData ?? []) {
          const pred = Object.values(map).find((p) => p.id === row.source_id)
          if (pred) pointsMap[pred.match_id] = row.points
        }
        setMyPoints(pointsMap)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const submitPrediction = async (matchId: string, team: 'domicile' | 'exterieur' | 'aucun_but', minute: number | null) => {
    setSavingId(matchId)
    setError(null)
    const { error: rpcError } = await supabase.rpc('submit_weekly_special_prediction', {
      p_match_id: matchId,
      p_group_id: groupId,
      p_pred_team: team,
      p_pred_minute: minute,
    })
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setPredictions((prev) => ({
        ...prev,
        [matchId]: { id: prev[matchId]?.id ?? '', match_id: matchId, pred_team: team, pred_minute: minute },
      }))
    }
    setSavingId(null)
  }

  const handleTeamPick = (matchId: string, team: 'domicile' | 'exterieur' | 'aucun_but') => {
    if (team === 'aucun_but') {
      submitPrediction(matchId, team, null)
      return
    }
    const minute = minuteDrafts[matchId]
    if (minute !== undefined && minute !== '') {
      submitPrediction(matchId, team, Number(minute))
    } else {
      // on retient le choix d'équipe localement en attendant la minute,
      // sans encore rien envoyer (la minute est obligatoire pour domicile/extérieur)
      setPredictions((prev) => ({
        ...prev,
        [matchId]: { id: prev[matchId]?.id ?? '', match_id: matchId, pred_team: team, pred_minute: prev[matchId]?.pred_minute ?? null },
      }))
    }
  }

  const handleMinuteChange = (matchId: string, value: string) => {
    setMinuteDrafts((prev) => ({ ...prev, [matchId]: value }))
    const team = predictions[matchId]?.pred_team
    if (team && team !== 'aucun_but' && value !== '') {
      submitPrediction(matchId, team, Number(value))
    }
  }

  const toggleReveal = async (matchId: string) => {
    if (reveals[matchId]) {
      setReveals((prev) => {
        const next = { ...prev }
        delete next[matchId]
        return next
      })
      return
    }
    setRevealLoading(matchId)
    const { data, error: err } = await supabase
      .from('weekly_special_predictions')
      .select('profile_id, pred_team, pred_minute, profiles(pseudo, avatar_url, avatar_emoji)')
      .eq('match_id', matchId)
      .eq('group_id', groupId)
    if (err) setError(err.message)
    const normalized = ((data ?? []) as unknown as RawReveal[]).map((r) => {
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      return {
        profile_id: r.profile_id,
        pred_team: r.pred_team,
        pred_minute: r.pred_minute,
        pseudo: prof?.pseudo ?? '???',
        avatar_url: prof?.avatar_url ?? null,
        avatar_emoji: prof?.avatar_emoji ?? null,
      }
    })
    setReveals((prev) => ({ ...prev, [matchId]: normalized }))
    setRevealLoading(null)
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Pari du 1er but — {groupName}</h2>
      </div>

      <p className="predictions-period">
        Devine quelle équipe va marquer en premier sur chacun de ces 2 matchs, et à quelle minute — plus tu es
        proche, plus tu marques de points.
      </p>

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : matches.length === 0 ? (
        <p className="groups-empty">Pas de pari du 1er but actif pour l'instant.</p>
      ) : (
        <ul className="matches-list matches-list-v2">
          {matches.map((m) => {
            const isOpen = !m.resolved && new Date(m.kickoff_at).getTime() > Date.now()
            const pred = predictions[m.id]
            const kickoffTime = new Date(m.kickoff_at).toLocaleString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
            const revealList = reveals[m.id] ?? []

            return (
              <li className="match-card-v2" key={m.id}>
                <div className="match-row-v2">
                  <div className="match-meta-badge">⏱ {kickoffTime}</div>
                </div>

                <div className="match-row-v2 match-row-teams">
                  <div className="match-team-v2 match-team-home">
                    <TeamBadge name={m.home_team} size={40} />
                    <span className="match-team-name-v2">{m.home_team}</span>
                  </div>
                  <span className="match-score-sep">vs</span>
                  <div className="match-team-v2 match-team-away">
                    <span className="match-team-name-v2">{m.away_team}</span>
                    <TeamBadge name={m.away_team} size={40} />
                  </div>
                </div>

                {m.resolved ? (
                  <div className="match-row-v2 match-row-footer">
                    <span className="match-my-pred">
                      Résultat :{' '}
                      {m.real_first_scorer_team === 'aucun_but'
                        ? 'aucun but marqué (0-0)'
                        : `${TEAM_LABELS[m.real_first_scorer_team!]} à la ${m.real_first_goal_minute}e minute`}
                    </span>
                    {pred && (
                      <span className="match-my-pred">
                        Ton pronostic : {TEAM_LABELS[pred.pred_team]}
                        {pred.pred_team !== 'aucun_but' && pred.pred_minute != null ? ` à la ${pred.pred_minute}e minute` : ''}
                        {myPoints[m.id] != null && ` — ${myPoints[m.id]} pt${myPoints[m.id] > 1 ? 's' : ''}`}
                      </span>
                    )}
                    <button
                      className="groups-action-btn groups-action-btn-secondary bet-reveal-btn"
                      disabled={revealLoading === m.id}
                      onClick={() => toggleReveal(m.id)}
                    >
                      {revealLoading === m.id ? '...' : reveals[m.id] ? 'Masquer les pronostics' : 'Voir les pronostics des autres'}
                    </button>
                    {reveals[m.id] && (
                      <ul className="bet-reveal-list">
                        {revealList.length === 0 ? (
                          <li className="groups-empty">Personne n'a pronostiqué ce match.</li>
                        ) : (
                          revealList.map((r) => (
                            <li className="bet-reveal-row" key={r.profile_id}>
                              <Avatar
                                pseudo={r.pseudo}
                                avatarUrl={r.avatar_url}
                                avatarEmoji={r.avatar_emoji}
                                size={28}
                              />
                              {r.pseudo} — {TEAM_LABELS[r.pred_team]}
                              {r.pred_team !== 'aucun_but' && r.pred_minute != null ? ` (${r.pred_minute}e min)` : ''}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                ) : isOpen ? (
                  <div className="match-row-v2 match-row-footer weekly-special-picker">
                    <div className="weekly-special-teams">
                      {(['domicile', 'exterieur', 'aucun_but'] as const).map((team) => (
                        <button
                          key={team}
                          type="button"
                          className={
                            'weekly-special-team-btn' + (pred?.pred_team === team ? ' weekly-special-team-btn-active' : '')
                          }
                          onClick={() => handleTeamPick(m.id, team)}
                        >
                          {TEAM_LABELS[team]}
                        </button>
                      ))}
                    </div>
                    {pred?.pred_team && pred.pred_team !== 'aucun_but' && (
                      <div className="weekly-special-minute">
                        <label htmlFor={`minute-${m.id}`}>Minute du 1er but :</label>
                        <input
                          id={`minute-${m.id}`}
                          type="number"
                          min={0}
                          max={99}
                          className="match-score-box"
                          value={minuteDrafts[m.id] ?? ''}
                          onChange={(e) => handleMinuteChange(m.id, e.target.value)}
                        />
                      </div>
                    )}
                    <span
                      className={
                        'match-autosave-status' +
                        (savingId === m.id ? ' match-autosave-saving' : pred && (pred.pred_team === 'aucun_but' || pred.pred_minute != null) ? ' match-autosave-saved' : '')
                      }
                    >
                      {savingId === m.id
                        ? 'Enregistrement...'
                        : pred && (pred.pred_team === 'aucun_but' || pred.pred_minute != null)
                        ? '✓ Pronostic enregistré'
                        : 'Choisis une équipe puis une minute'}
                    </span>
                  </div>
                ) : (
                  <div className="match-row-v2 match-row-footer">
                    <span className="match-cancelled">Pronostics clôturés — résultat à venir</span>
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
