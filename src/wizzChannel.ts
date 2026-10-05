import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

// Canal temps réel `wizz-<groupId>` partagé entre App.tsx (bandeau "X joue au
// mini-jeu !") et les mini-jeux (diffusion début/fin de partie, réception des
// wizz). supabase.channel() renvoie le MÊME objet pour un même nom : avant,
// chaque écran créait "son" canal puis appelait removeChannel() en partant,
// ce qui fermait en réalité celui d'App — plus aucun bandeau ni wizz jusqu'au
// prochain changement de groupe. Ici le canal est compté par référence et
// n'est fermé qu'au départ du dernier utilisateur.

type Handler = (payload: any) => void

interface Entry {
  channel: ReturnType<typeof supabase.channel>
  refs: number
  listeners: { wizz: Set<Handler>; playing: Set<Handler>; presence: Set<Handler> }
  subscribed: boolean
  // présence « je joue » à (re)publier dès que le canal est prêt
  pendingTrack: Record<string, unknown> | null | undefined
}

const entries = new Map<string, Entry>()

function acquire(groupId: string): Entry {
  let entry = entries.get(groupId)
  if (!entry) {
    const listeners = { wizz: new Set<Handler>(), playing: new Set<Handler>(), presence: new Set<Handler>() }
    const channel = supabase.channel(`wizz-${groupId}`)
    const e: Entry = { channel, refs: 0, listeners, subscribed: false, pendingTrack: undefined }
    channel
      .on('broadcast', { event: 'wizz' }, ({ payload }) => listeners.wizz.forEach((fn) => fn(payload)))
      .on('broadcast', { event: 'playing' }, ({ payload }) => listeners.playing.forEach((fn) => fn(payload)))
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        listeners.presence.forEach((fn) => fn(state))
      })
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED') return
        e.subscribed = true
        if (e.pendingTrack) channel.track(e.pendingTrack)
      })
    entry = e
    entries.set(groupId, entry)
  }
  entry.refs++
  return entry
}

function release(groupId: string) {
  const entry = entries.get(groupId)
  if (!entry) return
  entry.refs--
  if (entry.refs <= 0) {
    entries.delete(groupId)
    supabase.removeChannel(entry.channel)
  }
}

export interface WizzHandlers {
  onWizz?: Handler
  onPlaying?: Handler
  // état de présence du canal (qui est en train de jouer, en continu)
  onPresence?: Handler
}

// « Je suis en train de jouer » (payload) ou plus (null) : contrairement au
// broadcast 'playing' (un instant), la présence reste visible tant que la
// partie dure, même pour quelqu'un qui ouvre l'appli en cours de route.
export function setPlayingPresence(groupId: string | null | undefined, payload: Record<string, unknown> | null) {
  if (!groupId) return
  const entry = entries.get(groupId)
  if (!entry) return
  entry.pendingTrack = payload
  if (!entry.subscribed) return
  if (payload) entry.channel.track(payload)
  else entry.channel.untrack()
}

// Renvoie une fonction d'envoi stable ; les handlers sont lus via une ref à
// chaque message, donc jamais figés sur le premier rendu.
export function useWizzChannel(groupId: string | null | undefined, handlers: WizzHandlers = {}) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const groupIdRef = useRef(groupId)
  groupIdRef.current = groupId

  useEffect(() => {
    if (!groupId) return
    const entry = acquire(groupId)
    const onWizz: Handler = (p) => handlersRef.current.onWizz?.(p)
    const onPlaying: Handler = (p) => handlersRef.current.onPlaying?.(p)
    const onPresence: Handler = (p) => handlersRef.current.onPresence?.(p)
    entry.listeners.wizz.add(onWizz)
    entry.listeners.playing.add(onPlaying)
    entry.listeners.presence.add(onPresence)
    if (entry.subscribed) onPresence(entry.channel.presenceState())
    return () => {
      entry.listeners.wizz.delete(onWizz)
      entry.listeners.playing.delete(onPlaying)
      entry.listeners.presence.delete(onPresence)
      release(groupId)
    }
  }, [groupId])

  // Recherche le canal au moment de l'envoi (et pas via une ref vidée au
  // démontage) : un "stop" envoyé dans le cleanup d'un mini-jeu part donc
  // quand même tant qu'App garde le canal ouvert.
  return useRef((event: 'wizz' | 'playing', payload: Record<string, unknown>) => {
    const id = groupIdRef.current
    if (id) entries.get(id)?.channel.send({ type: 'broadcast', event, payload })
  }).current
}
