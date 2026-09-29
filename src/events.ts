import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Événement "But en or" en cours (lancé à la main par l'administrateur, voir
// AdminEvents.tsx) : les 2 matchs "1er but" de la semaine de l'événement.
// Il reste affiché tant qu'un match n'est pas résolu, puis 2 jours après le
// dernier match (le temps de voir le résultat).
export interface EventMatch {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  resolved: boolean
}

export interface CurrentEvent {
  weekStart: string
  matches: EventMatch[]
  // matchs encore ouverts sur lesquels je n'ai pas encore pronostiqué
  todo: number
}

const SHOW_AFTER_MS = 2 * 86400000

export function useCurrentEvent(groupId: string | null | undefined, userId: string | null | undefined) {
  const [event, setEvent] = useState<CurrentEvent | null>(null)

  useEffect(() => {
    if (!groupId || !userId) { setEvent(null); return }
    let cancelled = false
    const load = async () => {
      const { data: latest } = await supabase
        .from('weekly_special_matches')
        .select('week_start')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      if (!latest) { setEvent(null); return }

      const { data: rows } = await supabase
        .from('weekly_special_matches')
        .select('id, home_team, away_team, kickoff_at, resolved')
        .eq('week_start', latest.week_start)
        .order('match_number', { ascending: true })
      if (cancelled) return
      const matches = (rows ?? []) as EventMatch[]
      const lastKickoff = Math.max(...matches.map((m) => new Date(m.kickoff_at).getTime()))
      const active = matches.some((m) => !m.resolved) || Date.now() - lastKickoff < SHOW_AFTER_MS
      if (!matches.length || !active) { setEvent(null); return }

      const open = matches.filter((m) => new Date(m.kickoff_at).getTime() > Date.now())
      let todo = 0
      if (open.length) {
        const { data: preds } = await supabase
          .from('weekly_special_predictions')
          .select('match_id')
          .eq('group_id', groupId)
          .eq('profile_id', userId)
          .in('match_id', open.map((m) => m.id))
        if (cancelled) return
        const done = new Set((preds ?? []).map((p: any) => p.match_id))
        todo = open.filter((m) => !done.has(m.id)).length
      }
      setEvent({ weekStart: latest.week_start, matches, todo })
    }
    load()
    return () => { cancelled = true }
  }, [groupId, userId])

  return event
}

export function shortTeam(name: string) {
  return name
    .replace(/^(Racing Club de |Olympique de |Olympique |Stade |AS |OGC |FC |RC |AJ )/, '')
    .replace(/ (FC|AC|SCO|OSC|HAC|29|1901)$/, '')
}

export function eventKickoffLabel(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Événements de journée (Journée x2, Total de buts, Duo du week-end)
export type AppEventKind = 'journee_x2' | 'total_buts' | 'duo'

export interface AppEventSummary {
  id: string
  kind: AppEventKind
  matchday: number
  first_kickoff: string
  last_kickoff: string
  resolved: boolean
  todo: boolean
}

export const APP_EVENT_INFO: Record<AppEventKind, { icon: string; label: string }> = {
  journee_x2: { icon: '🔥', label: 'Journée x2' },
  total_buts: { icon: '⚽', label: 'Total de buts' },
  duo: { icon: '🤝', label: 'Duo du week-end' },
}

export function useAppEvents(groupId: string | null | undefined) {
  const [events, setEvents] = useState<AppEventSummary[]>([])
  useEffect(() => {
    if (!groupId) { setEvents([]); return }
    let cancelled = false
    supabase.rpc('get_active_app_events', { p_group_id: groupId }).then(({ data, error }: any) => {
      if (!cancelled && !error) setEvents((data ?? []) as AppEventSummary[])
    })
    return () => { cancelled = true }
  }, [groupId])
  return events
}
