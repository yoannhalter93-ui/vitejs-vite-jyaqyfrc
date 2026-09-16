// Fond décoratif pour l'écran de tchat de groupe : l'affiche "carnet de
// scrapbook" (papier vieilli, photos déchirées, scotchs, annotations
// manuscrites) que Yoann a envoyée est utilisée telle quelle comme image
// de fond (voir .chat-background dans App.css), plutôt que redessinée à
// la main, pour rester fidèle au visuel exact. Le centre de l'affiche est
// prévu vide : c'est là que les messages du tchat viennent se poser,
// par-dessus.

import type { ReactNode } from 'react'

export default function ChatBackground({ children }: { children: ReactNode }) {
  return (
    <div className="chat-background">
      <div className="chat-bg-content">
        {children}
      </div>
    </div>
  )
}
