import type { ReactNode } from 'react'
import './chat-background.css'

type ChatBackgroundProps = {
  children?: ReactNode
  className?: string
}

export default function ChatBackground({ children, className = '' }: ChatBackgroundProps) {
  return (
    <div className={`chat-paper ${className}`.trim()}>
      <div className="chat-paper__grain" aria-hidden="true" />

      <header className="chat-paper__brand" aria-label="Entre Nous — Foot entre potes">
        <span className="chat-paper__crown">♛</span>
        <div className="chat-paper__title">ENTRE NOUS</div>
        <div className="chat-paper__subtitle-row">
          <i />
          <span>Foot entre potes</span>
          <i />
        </div>
      </header>

      <span className="chat-paper__note chat-paper__note--top-left">Plus<br />qu’un jeu</span>
      <span className="chat-paper__note chat-paper__note--top-right">Des potes<br />Des matchs<br />Toujours là</span>

      <div className="chat-paper__sticker chat-paper__sticker--left">
        MÊME<br />TERRAIN<br />MÊMES<br />VALEURS
        <span className="chat-paper__mini-bars" />
      </div>

      <div className="chat-paper__tactic chat-paper__tactic--top" aria-hidden="true">
        <span>×</span><span>×</span><b>↗</b><span>○</span><span>○</span>
      </div>

      <span className="chat-paper__scribble chat-paper__scribble--talk">On en parle ?</span>
      <span className="chat-paper__scribble chat-paper__scribble--welcome">Bienvenue<br />au club ! ♛</span>
      <span className="chat-paper__scribble chat-paper__scribble--together">Le foot<br />nous rassemble ♛</span>

      <div className="chat-paper__sticker chat-paper__sticker--right">
        FOOT<br />POTES<br />BIÈRES<br />PRONOS<br />VIE
      </div>

      <div className="chat-paper__floodlight chat-paper__floodlight--left" aria-hidden="true">
        <span className="chat-paper__lamp-grid" />
        <span className="chat-paper__mast" />
      </div>

      <div className="chat-paper__stadium chat-paper__stadium--bottom" aria-hidden="true">
        <span className="chat-paper__stand-lines" />
        <span className="chat-paper__crowd" />
        <span className="chat-paper__stand-copy">TOUJOURS ENTRE NOUS</span>
      </div>

      <div className="chat-paper__polaroid" aria-hidden="true">
        <div className="chat-paper__players"><span>10</span><span>7</span></div>
      </div>

      <div className="chat-paper__tactic chat-paper__tactic--bottom" aria-hidden="true">
        <span>×</span><b>↖</b><span>○</span><span>○</span><span>×</span>
      </div>

      <div className="chat-paper__content">{children}</div>
    </div>
  )
}
