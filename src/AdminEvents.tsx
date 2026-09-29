// Écran réservé à l'administrateur (Profil → Événements) : lancer un
// événement "But en or" certaines semaines, en plus du jeu de la semaine
// (2 matchs dont on devine l'équipe et la minute du 1er but + un match
// optionnel dont les pronos comptent x2), l'annuler tant qu'il n'a pas
// commencé, et saisir le 1er but à la main si l'API ne le fournit pas.
// Tout est vérifié côté serveur (admin_* : réservées aux app_admins).

import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import LoadingSkeleton from './LoadingSkeleton'
import { eventKickoffLabel, APP_EVENT_INFO, type AppEventKind } from './events'

interface Fixture {
  api_fixture_id: number
  home_team: string
  away_team: string
  kickoff_at: string
}

interface EventMatchRow {
  id: string
  week_start: string
  match_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  resolved: boolean
  real_first_scorer_team: 'domicile' | 'exterieur' | 'aucun_but' | null
  real_first_goal_minute: number | null
}

interface MatchdayRow {
  matchday: number
  fixtures: number
  first_kickoff: string
  last_kickoff: string
}

interface AppEventRow {
  id: string
  kind: AppEventKind
  matchday: number
  first_kickoff: string
  resolved_at: string | null
}

const KINDS: AppEventKind[] = ['journee_x2', 'total_buts', 'duo']

interface BonusRow {
  week_start: string
  home_team: string
  away_team: string
  kickoff_at: string
}

// lundi (heure de Paris) de la semaine d'un coup d'envoi, "2026-10-05"
function weekOf(iso: string) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekLabel(weekStart: string) {
  const d = new Date(`${weekStart}T12:00:00`)
  return `Semaine du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
}

function ResolveForm({ match, onDone }: { match: EventMatchRow; onDone: () => void }) {
  const [team, setTeam] = useState<'domicile' | 'exterieur' | 'aucun_but'>('domicile')
  const [minute, setMinute] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const label = team === 'aucun_but' ? 'aucun but (0-0)' : `${team === 'domicile' ? match.home_team : match.away_team}, ${minute}e minute`
    if (!window.confirm(`Confirmer le 1er but : ${label} ? (définitif)`)) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('admin_resolve_golden_goal_match', {
      p_match_id: match.id,
      p_team: team,
      p_minute: team === 'aucun_but' ? null : Number(minute),
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    onDone()
  }

  return (
    <div className="admin-ev-resolve">
      <div className="admin-ev-resolve-row">
        <select value={team} onChange={(e) => setTeam(e.target.value as typeof team)}>
          <option value="domicile">1er but : {match.home_team}</option>
          <option value="exterieur">1er but : {match.away_team}</option>
          <option value="aucun_but">Aucun but (0-0)</option>
        </select>
        {team !== 'aucun_but' && (
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={130}
            placeholder="Minute"
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
          />
        )}
      </div>
      <button
        className="groups-action-btn"
        disabled={busy || (team !== 'aucun_but' && minute === '')}
        onClick={submit}
      >
        {busy ? '...' : 'Valider le résultat'}
      </button>
      {error && <p className="groups-error">{error}</p>}
    </div>
  )
}

export default function AdminEvents({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [events, setEvents] = useState<EventMatchRow[]>([])
  const [bonuses, setBonuses] = useState<BonusRow[]>([])
  const [golden, setGolden] = useState<number[]>([])
  const [bonus, setBonus] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [matchdays, setMatchdays] = useState<MatchdayRow[]>([])
  const [appEvents, setAppEvents] = useState<AppEventRow[]>([])
  const [goldenDay, setGoldenDay] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    const [fx, ev, bn, md, ae] = await Promise.all([
      supabase.rpc('admin_upcoming_fixtures'),
      supabase
        .from('weekly_special_matches')
        .select('id, week_start, match_number, home_team, away_team, kickoff_at, resolved, real_first_scorer_team, real_first_goal_minute')
        .order('week_start', { ascending: false })
        .order('match_number', { ascending: true })
        .limit(12),
      supabase.from('weekly_bonus_matches').select('week_start, home_team, away_team, kickoff_at').order('week_start', { ascending: false }).limit(6),
      supabase.rpc('admin_upcoming_matchdays'),
      supabase.from('app_events').select('id, kind, matchday, first_kickoff, resolved_at').order('first_kickoff', { ascending: false }).limit(12),
    ])
    setMatchdays((md.data ?? []) as MatchdayRow[])
    setAppEvents((ae.data ?? []) as AppEventRow[])
    if (fx.error) setError(fx.error.message)
    setFixtures(((fx.data ?? []) as Fixture[]).sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at)))
    setEvents((ev.data ?? []) as EventMatchRow[])
    setBonuses((bn.data ?? []) as BonusRow[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const eventWeeks = [...new Set(events.map((e) => e.week_start))]
  const busyWeeks = new Set([...eventWeeks, ...bonuses.map((b) => b.week_start)])

  const toggleGolden = (id: number) => {
    setNotice(null)
    if (bonus === id) setBonus(null)
    setGolden((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id]))
  }
  const toggleBonus = (id: number) => {
    setNotice(null)
    setGolden((prev) => prev.filter((x) => x !== id))
    setBonus((prev) => (prev === id ? null : id))
  }

  const selected = fixtures.filter((f) => golden.includes(f.api_fixture_id) || f.api_fixture_id === bonus)
  const sameWeek = new Set(selected.map((f) => weekOf(f.kickoff_at))).size <= 1
  const canLaunch = golden.length === 2 && sameWeek && !busy

  const launch = async () => {
    const [a, b] = golden.map((id) => fixtures.find((f) => f.api_fixture_id === id)!)
    const x2 = bonus != null ? fixtures.find((f) => f.api_fixture_id === bonus) : null
    const msg = `Lancer l'événement But en or ?\n\n🎯 ${a.home_team} - ${a.away_team}\n🎯 ${b.home_team} - ${b.away_team}`
      + (x2 ? `\n✖️2 ${x2.home_team} - ${x2.away_team}` : '')
      + '\n\nTous les joueurs recevront une notification.'
    if (!window.confirm(msg)) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('admin_create_golden_goal_event', {
      p_fixture_1: golden[0],
      p_fixture_2: golden[1],
      p_bonus_fixture: bonus,
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    setGolden([])
    setBonus(null)
    setGoldenDay(null)
    setNotice('🎯 But en or lancé ! Tout le monde a été prévenu.')
    load()
  }

  const cancel = async (weekStart: string) => {
    if (!window.confirm(`Annuler l'événement de la ${weekLabel(weekStart).toLowerCase()} ? Les pronos déjà faits seront effacés.`)) return
    const { error: err } = await supabase.rpc('admin_cancel_golden_goal_event', { p_week_start: weekStart })
    if (err) { setError(err.message); return }
    setNotice('Événement annulé.')
    load()
  }

  const launchDayEvent = async (kind: AppEventKind, matchday: number) => {
    const info = APP_EVENT_INFO[kind]
    if (!window.confirm(`Lancer « ${info.icon} ${info.label} » sur la journée ${matchday} ?\n\nTous les joueurs recevront une notification.`)) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('admin_create_app_event', { p_kind: kind, p_matchday: matchday })
    setBusy(false)
    if (err) { setError(err.message); return }
    setNotice(`${info.icon} ${info.label} lancé sur la journée ${matchday} !`)
    load()
  }

  const cancelDayEvent = async (ev: AppEventRow) => {
    const info = APP_EVENT_INFO[ev.kind]
    if (!window.confirm(`Annuler « ${info.label} » (journée ${ev.matchday}) ?`)) return
    const { error: err } = await supabase.rpc('admin_cancel_app_event', { p_event_id: ev.id })
    if (err) { setError(err.message); return }
    setNotice('Événement annulé.')
    load()
  }

  // But en or ouvert sur quelle journée (choix des matchs dans sa carte)
  const openGolden = (matchday: number) => {
    setNotice(null)
    setGolden([])
    setBonus(null)
    setGoldenDay((d) => (d === matchday ? null : matchday))
  }

  return (
    <div className="admin-ev">
      <button className="jeux-back-btn" onClick={onBack}>← Profil</button>
      <h2 className="admin-ev-title">🎉 Événements</h2>
      <p className="admin-ev-help">
        Sur une journée de Ligue 1 : 🔥 Journée x2 · ⚽ Total de buts · 🤝 Duo du week-end · 🎯 But en or.
        Tous les joueurs sont prévenus au lancement. Réservé à toi.
      </p>

      {error && <p className="groups-error">{error}</p>}
      {notice && <p className="admin-ev-notice">{notice}</p>}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {(appEvents.length > 0 || eventWeeks.length > 0) && (
            <section className="admin-ev-section">
              <h3>Événements lancés</h3>
              {appEvents.map((ev) => {
                const info = APP_EVENT_INFO[ev.kind]
                const started = new Date(ev.first_kickoff).getTime() <= Date.now()
                return (
                  <div className="admin-ev-card admin-ev-card-row" key={ev.id}>
                    <span>{info.icon} {info.label} · J{ev.matchday}</span>
                    {ev.resolved_at ? (
                      <small>✅ terminé</small>
                    ) : started ? (
                      <small>en cours</small>
                    ) : (
                      <button className="admin-ev-cancel" onClick={() => cancelDayEvent(ev)}>Annuler</button>
                    )}
                  </div>
                )
              })}
              {eventWeeks.map((w) => {
                const list = events.filter((e) => e.week_start === w)
                const x2 = bonuses.find((b) => b.week_start === w)
                const started = list.some((m) => new Date(m.kickoff_at).getTime() <= Date.now())
                  || (x2 && new Date(x2.kickoff_at).getTime() <= Date.now())
                return (
                  <div className="admin-ev-card" key={w}>
                    <div className="admin-ev-card-head">
                      <strong>🎯 But en or · {weekLabel(w).toLowerCase()}</strong>
                      {!started && (
                        <button className="admin-ev-cancel" onClick={() => cancel(w)}>Annuler</button>
                      )}
                    </div>
                    {list.map((m) => {
                      const played = new Date(m.kickoff_at).getTime() <= Date.now()
                      return (
                        <div className="admin-ev-match" key={m.id}>
                          <div>🎯 {m.home_team} - {m.away_team}</div>
                          <small>{eventKickoffLabel(m.kickoff_at)}</small>
                          {m.resolved ? (
                            <div className="admin-ev-result">
                              ✅ {m.real_first_scorer_team === 'aucun_but'
                                ? 'Aucun but'
                                : `1er but : ${m.real_first_scorer_team === 'domicile' ? m.home_team : m.away_team}, ${m.real_first_goal_minute}e`}
                            </div>
                          ) : played ? (
                            <ResolveForm match={m} onDone={load} />
                          ) : (
                            <div className="admin-ev-pending">À venir</div>
                          )}
                        </div>
                      )
                    })}
                    {x2 && (
                      <div className="admin-ev-match">
                        <div>✖️2 {x2.home_team} - {x2.away_team}</div>
                        <small>{eventKickoffLabel(x2.kickoff_at)}</small>
                      </div>
                    )}
                  </div>
                )
              })}
              {eventWeeks.length > 0 && (
                <p className="admin-ev-help">
                  But en or : le 1er but se remplit tout seul si l'API foot le fournit. Sinon, entre-le ici après le
                  match ; quand les 2 matchs sont renseignés, les points et jetons sont attribués.
                </p>
              )}
            </section>
          )}

          <section className="admin-ev-section">
            <h3>Lancer un événement</h3>
            {matchdays.length === 0 && <p className="groups-empty">Aucune journée à venir pour l'instant.</p>}
            {matchdays.map((md) => {
              const taken = new Set<string>(appEvents.filter((e) => e.matchday === md.matchday && !e.resolved_at).map((e) => e.kind))
              if (busyWeeks.has(weekOf(md.first_kickoff))) taken.add('but_en_or')
              const dayFixtures = fixtures.filter((f) => f.kickoff_at >= md.first_kickoff && f.kickoff_at <= md.last_kickoff)
              const pickerOpen = goldenDay === md.matchday
              return (
                <div className="admin-ev-week" key={md.matchday}>
                  <div className="admin-ev-week-title">
                    Journée {md.matchday} <small>· {md.fixtures} matchs · {eventKickoffLabel(md.first_kickoff)} → {eventKickoffLabel(md.last_kickoff)}</small>
                  </div>
                  <div className="admin-ev-kinds">
                    {KINDS.map((k) => (
                      <button key={k} disabled={busy || taken.has(k)} onClick={() => launchDayEvent(k, md.matchday)}>
                        {APP_EVENT_INFO[k].icon} {APP_EVENT_INFO[k].label}{taken.has(k) ? ' ✓' : ''}
                      </button>
                    ))}
                    <button
                      className={pickerOpen ? 'on' : ''}
                      disabled={busy || taken.has('but_en_or')}
                      onClick={() => openGolden(md.matchday)}
                    >
                      🎯 But en or{taken.has('but_en_or') ? ' ✓' : ''}
                    </button>
                  </div>

                  {pickerOpen && (
                    <div className="admin-ev-golden">
                      <p className="admin-ev-golden-help">
                        Choisis <b>2 matchs 🎯</b> (équipe + minute du 1er but) et, si tu veux, <b>1 match ×2</b> (ses pronos comptent double).
                      </p>
                      {dayFixtures.map((f) => {
                        const isGolden = golden.includes(f.api_fixture_id)
                        const isBonus = bonus === f.api_fixture_id
                        return (
                          <div className={'admin-ev-fixture' + (isGolden || isBonus ? ' admin-ev-fixture-on' : '')} key={f.api_fixture_id}>
                            <div className="admin-ev-fixture-text">
                              <span>{f.home_team} - {f.away_team}</span>
                              <small>{eventKickoffLabel(f.kickoff_at)}</small>
                            </div>
                            <button className={'admin-ev-pick' + (isGolden ? ' on' : '')} onClick={() => toggleGolden(f.api_fixture_id)}>🎯</button>
                            <button className={'admin-ev-pick' + (isBonus ? ' on' : '')} disabled={taken.has('journee_x2')} title={taken.has('journee_x2') ? 'Journée x2 : ce match compte déjà double' : undefined} onClick={() => toggleBonus(f.api_fixture_id)}>×2</button>
                          </div>
                        )
                      })}
                      {!sameWeek && <p className="groups-error">Les matchs choisis doivent être dans la même semaine.</p>}
                      <button className="groups-action-btn admin-ev-golden-launch" disabled={!canLaunch} onClick={launch}>
                        {busy ? '...' : `Lancer le But en or (${golden.length}/2 🎯${bonus != null ? ' + ×2' : ''})`}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}
