// Fond décoratif pour l'écran de tchat de groupe : papier crème, petits
// scotchs washi, doodles façon "carnet de coach" et annotations manuscrites
// dans les coins, dans l'esprit de la charte de l'appli (mêmes couleurs et
// mêmes polices que le reste — Oswald / Pacifico). Les éléments décoratifs
// restent sur les bords pour laisser le centre bien lisible : c'est là que
// les messages du tchat viendront se poser, par-dessus.

import type { ReactNode } from 'react'
import { SketchFloodlight, SketchTactics } from './Icons'

export default function ChatBackground({ children }: { children: ReactNode }) {
  return (
    <div className="chat-background">
      <div className="chat-bg-tape chat-bg-tape-tl" aria-hidden="true" />
      <div className="chat-bg-tape chat-bg-tape-br" aria-hidden="true" />
      <div className="chat-bg-corner chat-bg-corner-tr" aria-hidden="true">
        <SketchTactics size={50} />
      </div>
      <div className="chat-bg-corner chat-bg-corner-bl" aria-hidden="true">
        <SketchFloodlight size={38} />
      </div>
      <span className="chat-bg-annotation chat-bg-annotation-tl" aria-hidden="true">On en parle ?</span>
      <span className="chat-bg-annotation chat-bg-annotation-br" aria-hidden="true">Toujours entre potes</span>
      <div className="chat-bg-content">
        {children}
      </div>
    </div>
  )
}
