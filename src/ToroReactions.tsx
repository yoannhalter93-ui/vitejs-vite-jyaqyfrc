import { useCallback, useRef, useState } from 'react'

// Réactions emoji pendant un toro en direct : les spectateurs en envoient,
// tout le monde (joueur et spectateurs) les voit s'envoler sur le bord du
// terrain. Purement décoratif : ça ne touche pas au jeu (≠ chambrer).
export const TORO_REACTIONS = ['🔥', '👏', '😂', '😱', '💪', '🐂'] as const

export interface FloatingReaction { id: number; emoji: string; from: string; left: number; bottom: number }

const MAX_ON_SCREEN = 8

export function useFloatingReactions() {
  const [items, setItems] = useState<FloatingReaction[]>([])
  const nextId = useRef(0)
  const add = useCallback((emoji: string, from: string) => {
    if (!(TORO_REACTIONS as readonly string[]).includes(emoji)) return
    const id = nextId.current++
    // sur les bords, une fois à gauche une fois à droite (pas de chevauchement),
    // pour ne pas masquer le cercle de jeu
    const left = id % 2 === 0 ? 7 + Math.random() * 9 : 84 + Math.random() * 9
    const bottom = 6 + Math.random() * 40
    setItems((list) => [...list.slice(-(MAX_ON_SCREEN - 1)), { id, emoji, from, left, bottom }])
    setTimeout(() => setItems((list) => list.filter((r) => r.id !== id)), 2400)
  }, [])
  return { items, add }
}

export function FloatingReactions({ items, corners = false }: { items: FloatingReaction[]; corners?: boolean }) {
  // variante « coins » (jonglage) : les réactions s'affichent en haut à
  // gauche / en haut à droite, sans bouger, pour ne jamais passer devant
  // un ballon en plein jeu
  if (corners) {
    const side = (left: boolean) => items.filter((r) => (r.id % 2 === 0) === left).slice(-2)
    return (
      <div className="toro-reactions-layer" aria-hidden>
        {[true, false].map((left) => (
          <div key={left ? 'g' : 'd'} className={`toro-reaction-corner ${left ? 'is-left' : 'is-right'}`}>
            {side(left).map((r) => (
              <div key={r.id} className="toro-reaction-still">
                <span className="toro-reaction-emoji">{r.emoji}</span>
                <span className="toro-reaction-from">{r.from}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="toro-reactions-layer" aria-hidden>
      {items.map((r) => (
        <div key={r.id} className="toro-reaction-float" style={{ left: `${r.left}%`, bottom: r.bottom }}>
          <span className="toro-reaction-emoji">{r.emoji}</span>
          <span className="toro-reaction-from">{r.from}</span>
        </div>
      ))}
    </div>
  )
}

// barre de boutons côté spectateur (une réaction par seconde au plus)
export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const last = useRef(0)
  return (
    <div className="toro-reaction-bar">
      {TORO_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          className="toro-reaction-btn"
          onClick={() => {
            if (Date.now() - last.current < 1000) return
            last.current = Date.now()
            onReact(e)
          }}
        >{e}</button>
      ))}
    </div>
  )
}
