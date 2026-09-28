import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Cartons rouges en cours dans un groupe (bonus "Carton rouge", 24 h) :
// joueur visé → date de fin. Sert au badge 🟥 à côté des pseudos et à
// bloquer l'accès au jeu de la semaine (le vrai blocage est côté serveur).
export function useRedCards(groupId: string | null | undefined, refreshKey: unknown = null) {
  const [cards, setCards] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!groupId) { setCards({}); return }
    let cancelled = false
    const load = () => {
      supabase
        .from('red_cards')
        .select('target_id, expires_at')
        .eq('group_id', groupId)
        .gt('expires_at', new Date().toISOString())
        .then(({ data }: any) => {
          if (cancelled || !data) return
          const map: Record<string, string> = {}
          for (const c of data) {
            if (!map[c.target_id] || c.expires_at > map[c.target_id]) map[c.target_id] = c.expires_at
          }
          setCards(map)
        })
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [groupId, refreshKey])

  // un carton expiré entre deux rechargements ne compte plus
  const active: Record<string, string> = {}
  const now = new Date().toISOString()
  for (const [id, until] of Object.entries(cards)) if (until > now) active[id] = until
  return active
}

export function redCardUntilLabel(until: string) {
  return new Date(until).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
}
