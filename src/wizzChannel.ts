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
  listeners: { wizz: Set<Handler>; playing: Set<Handler> }
}

const entries = new Map<string, Entry>()

function acquire(groupId: string): Entry {
  let entry = entries.get(groupId)
  if (!entry) {
    const listeners = { wizz: new Set<Handler>(), playing: new Set<Handler>() }
    const channel = supabase.channel(`wizz-${groupId}`)
    channel
      .on('broadcast', { event: 'wizz' }, ({ payload }) => listeners.wizz.forEach((fn) => fn(payload)))
      .on('broadcast', { event: 'playing' }, ({ payload }) => listeners.playing.forEach((fn) => fn(payload)))
      .subscribe()
    entry = { channel, refs: 0, listeners }
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
    entry.listeners.wizz.add(onWizz)
    entry.listeners.playing.add(onPlaying)
    return () => {
      entry.listeners.wizz.delete(onWizz)
      entry.listeners.playing.delete(onPlaying)
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
