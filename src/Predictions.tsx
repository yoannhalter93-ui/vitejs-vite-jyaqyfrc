import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import TeamBadge from './TeamBadge'

interface MatchRow {
  id: string
  api_fixture_id: number
  home_team: string
  away_team: string
  home_team_api_id: number | null
  away_team_api_id: number | null
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

interface RevealRow {
  profile_id: string
  pseudo: string
  pred_home_score: number
  pred_away_score: number
}

interface Props {
  groupId: string
  groupName: string
  onBack: () => void
}

// Regroupe les matchs par jour (clé = date locale ISO, ex. "2026-09-08"),
// en conservant l'ordre chronologique déjà renvoyé par la requête.
function groupByDay(matches: MatchRow[]): { key: string; label: string; matches: MatchRow[] }[] {
  const groups: { key: string; label: string; matches: MatchRow[] }[] = []
  for (const m of matches) {
    const d = new Date(m.kickoff_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let group = groups.find((g) => g.key === key)
    if (!group) {
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      group = { key, label: label.charAt(0).toUpperCase() + label.slice(1), matches: [] }
      groups.push(group)
    }
    group.matches.push(m)
  }
  return groups
}

export default function Predictions({ groupId, groupName, onBack }: Props) {
  const { user } = useAuth()
  const [periodLabel, setPeriodLabel] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchRow[]>([])
  // "Pari du 1er but" (WeeklySpecial.tsx) peut désigner un 3e match dont les
  // points comptent x2 au classement — identifié par api_fixture_id (partagé
  // entre les copies par groupe d'un même match, voir seed_matches_for_new_period)
  const [bonusFixtureId, setBonusFixtureId] = useState<number | null>(null)
  const [predictions, setPredictions] = useState<Record<string, PredictionRow>>({})
  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>({})
  const [standings, setStandings] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  // Enregistrement automatique : plus besoin de bouton "Valider"/"Modifier",
  // dès qu'un score est saisi il est sauvegardé tout seul après une courte
  // pause de frappe (évite d'oublier de valider après avoir rempli tous les
  // scores). Un timer par match, redémarré à chaque frappe.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Pour scroller automatiquement jusqu'au prochain match à jouer plutôt que
  // de rester sur le premier match de la période (qui peut être déjà passé).
  const matchRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const hasScrolledRef = useRef(false)

  // révélation des pronostics des autres, uniquement pour un match résolu —
  // même principe que pour les paris libres / le récap de quiz
  const [reveals, setReveals] = useState<Record<string, RevealRow[]>>({})
  const [revealLoading, setRevealLoading] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    hasScrolledRef.current = false

    const { data: bonus } = await supabase
      .from('weekly_bonus_matches')
      .select('api_fixture_id')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    setBonusFixtureId(bonus?.api_fixture_id ?? null)

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
      .select('id, api_fixture_id, home_team, away_team, home_team_api_id, away_team_api_id, kickoff_at, status, real_home_score, real_away_score')
      .eq('group_id', groupId)
      .eq('period_id', period.id)
      .order('kickoff_at', { ascending: true })

    if (matchesError) {
      setError(matchesError.message)
      setLoading(false)
      return
    }
    setMatches(matchesData ?? [])

    // classement Ligue 1 (petit "1e", "16e"... à côté de chaque badge) —
    // uniquement pour les équipes présentes dans les matchs affichés
    const teamIds = Array.from(
      new Set(
        (matchesData ?? []).flatMap((m) => [m.home_team_api_id, m.away_team_api_id]).filter((id): id is number => id != null)
      )
    )
    if (teamIds.length > 0) {
      const { data: standingsData } = await supabase
        .from('ligue1_standings')
        .select('api_team_id, position')
        .in('api_team_id', teamIds)
      setStandings(Object.fromEntries((standingsData ?? []).map((s) => [s.api_team_id, s.position])))
    } else {
      setStandings({})
    }

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

  // Nettoie les enregistrements en attente si on quitte l'écran avant la
  // fin du délai, pour ne pas déclencher de sauvegarde (ni d'appel setState)
  // après le démontage du composant.
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout)
    }
  }, [])

  // Une fois les matchs chargés, on saute directement au prochain match à
  // jouer plutôt que de laisser l'utilisateur sur le tout premier match de
  // la période (potentiellement déjà joué il y a une semaine).
  useEffect(() => {
    if (loading || matches.length === 0 || hasScrolledRef.current) return
    hasScrolledRef.current = true
    const now = Date.now()
    const target = matches.find((m) => new Date(m.kickoff_at).getTime() > now) ?? matches[matches.length - 1]
    requestAnimationFrame(() => {
      matchRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [loading, matches])

  const handleDraftChange = (matchId: string, field: 'home' | 'away', value: string) => {
    const nextDraft = { ...(drafts[matchId] ?? { home: '', away: '' }), [field]: value }
    setDrafts((prev) => ({ ...prev, [matchId]: nextDraft }))

    if (saveTimers.current[matchId]) clearTimeout(saveTimers.current[matchId])
    if (nextDraft.home === '' || nextDraft.away === '') return
    // On peut changer le score librement tant que le match n'a pas commencé :
    // chaque frappe redémarre le délai, seule la dernière valeur est envoyée.
    saveTimers.current[matchId] = setTimeout(() => {
      handleSave(matchId, nextDraft)
    }, 700)
  }

  const handleSave = async (matchId: string, overrideDraft?: { home: string; away: string }) => {
    if (!user) return
    const draft = overrideDraft ?? drafts[matchId]
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
    setRevealError(null)
    const { data, error: err } = await supabase.rpc('get_match_predictions_reveal', { p_match_id: matchId })
    if (err) setRevealError(err.message)
    setReveals((prev) => ({ ...prev, [matchId]: (data ?? []) as RevealRow[] }))
    setRevealLoading(null)
  }

  const dayGroups = groupByDay(matches)

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Accueil</button>
        <h2>{groupName}</h2>
      </div>

      {periodLabel && <p className="predictions-period">Période : {periodLabel}</p>}

      {error && <p className="groups-error">{error}</p>}
      {revealError && <p className="groups-error">{revealError}</p>}

      {loading ? (
        <p className="groups-loading">Chargement des matchs...</p>
      ) : matches.length === 0 ? (
        <p className="groups-empty">Aucun match pour la période en cours.</p>
      ) : (
        dayGroups.map((group) => {
          const doneCount = group.matches.filter((m) => !!predictions[m.id]).length
          return (
            <div className="match-day-group" key={group.key}>
              <div className="match-day-header">
                <span className="match-day-icon">⚽</span>
                <span className="match-day-label">{group.label}</span>
                <span className="match-day-count">{doneCount} / {group.matches.length}</span>
              </div>

              <ul className="matches-list matches-list-v2">
                {group.matches.map((m) => {
                  const isOpen = m.status === 'open' && new Date(m.kickoff_at).getTime() > Date.now()
                  const draft = drafts[m.id] ?? { home: '', away: '' }
                  const hasPrediction = !!predictions[m.id]
                  const homePos = m.home_team_api_id != null ? standings[m.home_team_api_id] : undefined
                  const awayPos = m.away_team_api_id != null ? standings[m.away_team_api_id] : undefined
                  const kickoffTime = new Date(m.kickoff_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })

                  return (
                    <li className="match-card-v2" key={m.id} ref={(el) => { matchRefs.current[m.id] = el }}>
                      <div className="match-row-v2">
                        <div className="match-meta-badge">⏱ {kickoffTime}</div>
                        {bonusFixtureId != null && m.api_fixture_id === bonusFixtureId && (
                          <div className="match-bonus-badge">🎯 Pari du 1er but : points x2</div>
                        )}
                      </div>

                      <div className="match-row-v2 match-row-teams">
                        <div className="match-team-v2 match-team-home">
                          <div className="match-team-crest-wrap">
                            {homePos != null && <span className="match-team-pos">{homePos}e</span>}
                            <TeamBadge name={m.home_team} size={40} />
                          </div>
                          <span className="match-team-name-v2">{m.home_team}</span>
                        </div>

                        <div className="match-score-center">
                          {m.status === 'resolved' ? (
                            <div className="match-score-final">
                              <span>{m.real_home_score}</span>
                              <span className="match-score-sep">-</span>
                              <span>{m.real_away_score}</span>
                            </div>
                          ) : isOpen ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                className="match-score-box"
                                value={draft.home}
                                onChange={(e) => handleDraftChange(m.id, 'home', e.target.value)}
                              />
                              <span className="match-score-sep">-</span>
                              <input
                                type="number"
                                min={0}
                                className="match-score-box"
                                value={draft.away}
                                onChange={(e) => handleDraftChange(m.id, 'away', e.target.value)}
                              />
                            </>
                          ) : (
                            <div className="match-score-box match-score-box-empty" />
                          )}
                        </div>

                        <div className="match-team-v2 match-team-away">
                          <span className="match-team-name-v2">{m.away_team}</span>
                          <div className="match-team-crest-wrap">
                            {awayPos != null && <span className="match-team-pos">{awayPos}e</span>}
                            <TeamBadge name={m.away_team} size={40} />
                          </div>
                        </div>
                      </div>

                      {m.status === 'resolved' ? (
                        <div className="match-row-v2 match-row-footer">
                          {hasPrediction && (
                            <span className="match-my-pred">
                              Ton pronostic : {predictions[m.id].pred_home_score} - {predictions[m.id].pred_away_score}
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
                              {reveals[m.id].length === 0 ? (
                                <li className="groups-empty">Personne n'a pronostiqué ce match.</li>
                              ) : (
                                reveals[m.id].map((r) => (
                                  <li className="bet-reveal-row" key={r.profile_id}>
                                    {r.pseudo} — {r.pred_home_score} - {r.pred_away_score}
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </div>
                      ) : isOpen ? (
                        <div className="match-row-v2 match-row-footer">
                          {/* Plus de bouton "Valider"/"Modifier" : le score est
                              enregistré tout seul dès qu'il est saisi (voir
                              handleDraftChange), modifiable librement jusqu'au
                              coup d'envoi. */}
                          <span
                            className={
                              'match-autosave-status' +
                              (savingId === m.id
                                ? ' match-autosave-saving'
                                : hasPrediction
                                ? ' match-autosave-saved'
                                : '')
                            }
                          >
                            {savingId === m.id
                              ? 'Enregistrement...'
                              : hasPrediction
                              ? '✓ Pronostic enregistré'
                              : 'Entre un score, il est enregistré automatiquement'}
                          </span>
                        </div>
                      ) : m.status === 'cancelled' ? (
                        <div className="match-row-v2 match-row-footer">
                          <span className="match-cancelled">Match annulé</span>
                        </div>
                      ) : (
                        <div className="match-row-v2 match-row-footer">
                          <span className="match-cancelled">
                            Pronostics clôturés
                            {hasPrediction && ` (ton pronostic : ${predictions[m.id].pred_home_score} - ${predictions[m.id].pred_away_score})`}
                          </span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })
      )}
    </div>
  )
}
