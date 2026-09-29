// Écran d'un événement de journée (Journée x2, Total de buts, Duo du
// week-end), ouvert depuis la bannière de l'accueil ou la notification.
// Tout le calcul est côté serveur (get_event_view) : scores des matchs,
// pronos "total de buts" des autres (visibles une fois la journée
// commencée), équipes du duo et leur moyenne en direct.

import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import LoadingSkeleton from './LoadingSkeleton'
import TeamBadge from './TeamBadge'
import { APP_EVENT_INFO, eventKickoffLabel, shortTeam, type AppEventKind } from './events'

interface Fixture {
  home: string
  away: string
  kickoff: string
  home_score: number | null
  away_score: number | null
  status: string
}

interface EventView {
  id: string
  kind: AppEventKind
  matchday: number
  first_kickoff: string
  last_kickoff: string
  started: boolean
  resolved: boolean
  result: { total?: number; best_gap?: number; best_avg?: number; winners?: string[] } | null
  fixtures: Fixture[]
  goals: number
  my_prediction: number | null
  predictions: { pseudo: string; value: number; me: boolean }[]
  teams: { team_no: number; mine: boolean; avg: number; members: { pseudo: string; points: number }[] }[]
}

interface Props {
  eventId: string
  groupId: string
  onBack: () => void
  onGoToPronos: () => void
}

export default function AppEventScreen({ eventId, groupId, onBack, onGoToPronos }: Props) {
  const [view, setView] = useState<EventView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guess, setGuess] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    const { data, error: err } = await supabase.rpc('get_event_view', { p_event_id: eventId, p_group_id: groupId })
    if (err) { setError(err.message); return }
    const v = data as EventView
    setView(v)
    if (v.my_prediction != null) setGuess(String(v.my_prediction))
  }

  useEffect(() => { load() }, [eventId, groupId])

  const saveGuess = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: err } = await supabase.rpc('submit_event_prediction', { p_event_id: eventId, p_value: Number(guess) })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    load()
  }

  if (!view) {
    return (
      <div className="app-event">
        <button className="predictions-back" onClick={onBack}>← Accueil</button>
        {error ? <p className="groups-error">{error}</p> : <LoadingSkeleton />}
      </div>
    )
  }

  const info = APP_EVENT_INFO[view.kind]
  const played = view.fixtures.filter((f) => f.status === 'resolved').length
  const winners = view.result?.winners ?? []

  return (
    <div className="app-event">
      <button className="predictions-back" onClick={onBack}>← Accueil</button>
      <div className="app-event-hero">
        <span className="app-event-icon">{info.icon}</span>
        <div>
          <h2>{info.label}</h2>
          <p>Journée {view.matchday} de Ligue 1 · {view.resolved ? 'terminé' : view.started ? 'en cours' : `dès ${eventKickoffLabel(view.first_kickoff)}`}</p>
        </div>
      </div>

      {view.resolved && winners.length > 0 && (
        <div className="app-event-winner">
          🏆 {winners.join(', ')} {winners.length > 1 ? 'remportent' : 'remporte'} l'événement : +3 points et +2 🪙
          {view.kind === 'total_buts' && view.result?.total != null && ` (${view.result.total} buts au total)`}
        </div>
      )}

      {view.kind === 'journee_x2' && (
        <div className="app-event-card">
          <p>Tous les pronos de cette journée comptent <b>double</b> au classement. Pas besoin de Joker : il n'est pas utilisable sur ces matchs.</p>
          {!view.started && (
            <button className="groups-action-btn" onClick={onGoToPronos}>Faire mes pronos →</button>
          )}
        </div>
      )}

      {view.kind === 'total_buts' && (
        <div className="app-event-card">
          <p>Devine le <b>nombre total de buts</b> marqués sur les {view.fixtures.length} matchs de la journée. Le plus proche du groupe gagne 3 points + 2 🪙.</p>
          {!view.started ? (
            <div className="app-event-guess">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={200}
                placeholder="Ex : 24"
                value={guess}
                onChange={(e) => { setGuess(e.target.value); setSaved(false) }}
              />
              <button className="groups-action-btn" disabled={saving || guess === ''} onClick={saveGuess}>
                {saving ? '...' : view.my_prediction != null ? 'Modifier' : 'Valider'}
              </button>
            </div>
          ) : (
            <p className="app-event-live">
              ⚽ <b>{view.goals}</b> but{view.goals > 1 ? 's' : ''} marqué{view.goals > 1 ? 's' : ''} ({played}/{view.fixtures.length} matchs joués)
              {view.my_prediction != null && ` · ton prono : ${view.my_prediction}`}
            </p>
          )}
          {saved && <p className="app-event-saved">✓ Enregistré (modifiable jusqu'au 1er coup d'envoi)</p>}
          {!view.started && <small>Tu verras les pronos des autres dès le premier coup d'envoi.</small>}
          {view.started && view.predictions.length > 0 && (
            <ul className="app-event-list">
              {view.predictions.map((p, i) => (
                <li key={i} className={p.me ? 'me' : ''}>
                  <span>{p.pseudo}</span>
                  <b>{p.value} buts</b>
                  <small>écart {Math.abs(p.value - view.goals)}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.kind === 'duo' && (
        <div className="app-event-card">
          <p>Chaque équipe marque la <b>moyenne</b> des points de pronos de ses joueurs sur la journée (un trio si le groupe est impair). La meilleure équipe gagne 3 points + 2 🪙 par joueur.</p>
          {!view.started && (
            <button className="groups-action-btn" onClick={onGoToPronos}>Faire mes pronos →</button>
          )}
          <ul className="app-event-teams">
            {view.teams.map((t, i) => (
              <li key={t.team_no} className={t.mine ? 'mine' : ''}>
                <span className="app-event-rank">{i + 1}</span>
                <span className="app-event-members">
                  {t.members.map((m) => `${m.pseudo} (${m.points})`).join(' · ')}
                  {t.mine && <em> — ton équipe</em>}
                </span>
                <b>{t.avg} pts</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="groups-error">{error}</p>}

      <h3 className="app-event-sub">Les matchs</h3>
      <ul className="app-event-fixtures">
        {view.fixtures.map((f, i) => (
          <li key={i}>
            <TeamBadge name={f.home} size={24} />
            <span className="app-event-team">{shortTeam(f.home)}</span>
            <b>{f.home_score != null ? `${f.home_score} - ${f.away_score}` : eventKickoffLabel(f.kickoff)}</b>
            <span className="app-event-team app-event-team-away">{shortTeam(f.away)}</span>
            <TeamBadge name={f.away} size={24} />
          </li>
        ))}
      </ul>
    </div>
  )
}
