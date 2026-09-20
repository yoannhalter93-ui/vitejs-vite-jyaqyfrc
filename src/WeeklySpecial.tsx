import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
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

interface BonusMatch {
  week_start: string
  api_fixture_id: number
  home_team: string
  away_team: string
  kickoff_at: string
}

interface Props {
  groupId: string
  groupName: string
  autoApplyAllLeagues: boolean
  onGoToBonusMatch: () => void
  onExit: () => void
}

const TEAM_LABELS: Record<'domicile' | 'exterieur' | 'aucun_but', string> = {
  domicile: 'Domicile',
  exterieur: 'Extérieur',
  aucun_but: 'Aucun but (0-0)',
}

// Minute maximale de la barre : 95 plutôt que 90, pour couvrir les buts
// marqués dans le temps additionnel (« 90+ ») sans avoir à zoomer plus loin
// que ce qu'un vrai match peut produire.
const MAX_MINUTE = 95

// Au-delà de la 90e minute, affiché "90+" plutôt que la valeur exacte de la
// barre — même convention que les commentateurs ("but à la 90+3e minute"),
// plus lisible qu'un nombre brut type "93".
function minuteLabel(minute: number): string {
  return minute >= 90 ? '90+' : String(minute)
}

// Curseur "ballon" pour choisir la minute exacte du 1er but, sur une barre de
// 0 à MAX_MINUTE — remplace les boutons de plage de 15 min utilisés avant
// (plus rapide à taper qu'un nombre, mais imprécis) : ici on garde la
// rapidité du geste (un tap ou un glisser) tout en envoyant la vraie minute
// choisie au serveur, comparée telle quelle à la vraie minute du but (voir
// weekly_special_score côté serveur / scoreForPrediction ci-dessous), sans
// plus passer par un milieu de plage approximatif.
function MinuteSlider({ value, onCommit }: { value: number; onCommit: (minute: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragValue, setDragValue] = useState(value)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) setDragValue(value)
  }, [value, dragging])

  const minuteFromClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track) return dragValue
    const rect = track.getBoundingClientRect()
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0
    return Math.round(ratio * MAX_MINUTE)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setDragValue(minuteFromClientX(e.clientX))
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragValue(minuteFromClientX(e.clientX))
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    onCommit(minuteFromClientX(e.clientX))
  }

  const pct = (dragValue / MAX_MINUTE) * 100

  return (
    <div className="minute-slider">
      <div
        className="minute-slider-track"
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="minute-slider-fill" style={{ width: `${pct}%` }} />
        <div className="minute-slider-tick minute-slider-tick-45" />
        <div className="minute-slider-ball" style={{ left: `${pct}%` }}>
          ⚽
        </div>
      </div>
      <div className="minute-slider-scale">
        <span>0</span>
        <span>45</span>
        <span>90+</span>
      </div>
      <div className="minute-slider-value">{minuteLabel(dragValue)}e minute</div>
    </div>
  )
}

// Même barème que la fonction SQL weekly_special_score côté serveur : équipe
// et minute sont notées indépendamment (5 pts la bonne équipe, jusqu'à 10 pts
// pour la minute exacte, dégressif par tranches de 5 min), sauf pour "aucun
// but" qui remplace tout (15 pts si deviné juste, 0 sinon). Recalculé ici
// côté client juste pour l'affichage individuel du pronostic — le vrai crédit
// de points au classement ne se fait qu'une fois par semaine, pour le
// meilleur total du groupe (voir resolve_weekly_special_week côté serveur).
function scoreForPrediction(
  predTeam: 'domicile' | 'exterieur' | 'aucun_but' | undefined,
  predMinute: number | null | undefined,
  realTeam: 'domicile' | 'exterieur' | 'aucun_but' | null,
  realMinute: number | null,
): number {
  if (!predTeam || !realTeam) return 0
  if (realTeam === 'aucun_but') return predTeam === 'aucun_but' ? 15 : 0
  if (predTeam === 'aucun_but') return 0
  let pts = predTeam === realTeam ? 5 : 0
  if (predMinute != null && realMinute != null) {
    const diff = Math.abs(predMinute - realMinute)
    if (diff === 0) pts += 10
    else if (diff <= 5) pts += 9
    else if (diff <= 10) pts += 8
    else if (diff <= 15) pts += 7
    else if (diff <= 20) pts += 6
    else if (diff <= 25) pts += 5
    else if (diff <= 30) pts += 4
    else if (diff <= 35) pts += 3
    else if (diff <= 40) pts += 2
    else if (diff <= 45) pts += 1
  }
  return pts
}

export default function WeeklySpecial({ groupId, groupName, autoApplyAllLeagues, onGoToBonusMatch, onExit }: Props) {
  const { user } = useAuth()
  const [matches, setMatches] = useState<SpecialMatch[]>([])
  const [predictions, setPredictions] = useState<Record<string, PredictionRow>>({})
  const [bonusMatch, setBonusMatch] = useState<BonusMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [reveals, setReveals] = useState<Record<string, RevealRow[]>>({})
  const [revealLoading, setRevealLoading] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    // match bonus x2 de la semaine (3e match, parié normalement dans
    // Pronostics) — indépendant des 2 matchs équipe+minute ci-dessous, donc
    // chargé séparément et sans bloquer le reste si absent
    const { data: bonus } = await supabase
      .from('weekly_bonus_matches')
      .select('week_start, api_fixture_id, home_team, away_team, kickoff_at')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    setBonusMatch(bonus ?? null)

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
      for (const p of predsData ?? []) {
        map[p.match_id] = p
      }
      setPredictions(map)
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
    // Réglage "Pronostics dans toutes mes ligues" actif : la RPC
    // submit_weekly_special_prediction_all_leagues applique le même
    // pronostic à toutes les ligues où je suis membre (le match "But en or"
    // est global, partagé par toutes les ligues la même semaine). Sinon,
    // comportement inchangé : RPC mono-ligue.
    const { error: rpcError } = autoApplyAllLeagues
      ? (await supabase.rpc('submit_weekly_special_prediction_all_leagues', {
          p_match_id: matchId,
          p_pred_team: team,
          p_pred_minute: minute,
        }))
      : (await supabase.rpc('submit_weekly_special_prediction', {
          p_match_id: matchId,
          p_group_id: groupId,
          p_pred_team: team,
          p_pred_minute: minute,
        }))
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
    const existingMinute = predictions[matchId]?.pred_minute ?? null
    if (existingMinute != null) {
      submitPrediction(matchId, team, existingMinute)
    } else {
      // on retient le choix d'équipe localement en attendant la minute (via
      // le curseur), sans encore rien envoyer (obligatoire pour
      // domicile/extérieur)
      setPredictions((prev) => ({
        ...prev,
        [matchId]: { id: prev[matchId]?.id ?? '', match_id: matchId, pred_team: team, pred_minute: null },
      }))
    }
  }

  const handleMinutePick = (matchId: string, minute: number) => {
    const team = predictions[matchId]?.pred_team
    if (team && team !== 'aucun_but') {
      submitPrediction(matchId, team, minute)
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
        <button className="predictions-back" onClick={onExit}>← Accueil</button>
        <h2>But en or — {groupName}</h2>
      </div>

      <p className="predictions-period">
        Devine quelle équipe va marquer en premier sur chacun de ces 2 matchs, et à quelle minute exacte (glisse le
        ⚽ sur la barre, ou choisis « aucun but » si tu penses au 0-0) — équipe et minute comptent chacune pour leurs
        points, indépendamment. Le meilleur total du groupe sur les 2 matchs remporte 3 points au classement général
        + 2 🪙 jetons.
      </p>

      {bonusMatch && (
        <button type="button" className="weekly-bonus-banner" onClick={onGoToBonusMatch}>
          <span className="weekly-bonus-x2">x2</span>
          <span className="weekly-bonus-text">
            <strong>3e match bonus</strong>
            <span>
              {bonusMatch.home_team} vs {bonusMatch.away_team} — pronostic classique, points doublés au classement
            </span>
          </span>
        </button>
      )}

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
                        : `${TEAM_LABELS[m.real_first_scorer_team!]} à la ${minuteLabel(m.real_first_goal_minute ?? 0)}e minute`}
                    </span>
                    {pred && (
                      <span className="match-my-pred">
                        Ton pronostic : {TEAM_LABELS[pred.pred_team]}
                        {pred.pred_team !== 'aucun_but' && pred.pred_minute != null ? ` — ${minuteLabel(pred.pred_minute)}e minute` : ''}
                        {' — '}
                        {scoreForPrediction(pred.pred_team, pred.pred_minute, m.real_first_scorer_team, m.real_first_goal_minute)} pts / 15
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
                              {r.pred_team !== 'aucun_but' && r.pred_minute != null ? ` (${minuteLabel(r.pred_minute)}e minute)` : ''}
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
                        <label>Minute du 1er but :</label>
                        <MinuteSlider
                          value={pred.pred_minute ?? 45}
                          onCommit={(minute) => handleMinutePick(m.id, minute)}
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
