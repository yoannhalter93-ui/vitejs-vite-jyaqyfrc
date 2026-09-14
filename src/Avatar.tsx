// Avatar réutilisable : affiche la photo importée par le joueur si elle
// existe, sinon l'emoji qu'il a choisi, sinon repli sur l'initiale de son
// pseudo (comportement historique, avant que le choix d'avatar existe).
export const AVATAR_EMOJIS = ['⚽', '🦁', '🐐', '🔥', '😎', '🦊', '🐺', '🚀', '🎯', '🏆', '🥷', '🐉']

interface AvatarProps {
  pseudo: string
  avatarUrl?: string | null
  avatarEmoji?: string | null
  size?: number
  className?: string
}

export default function Avatar({ pseudo, avatarUrl, avatarEmoji, size = 38, className = '' }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46), flexShrink: 0 }

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={pseudo}
        className={`avatar-circle avatar-circle-photo ${className}`}
        style={style}
      />
    )
  }
  if (avatarEmoji) {
    return (
      <span className={`avatar-circle avatar-circle-emoji ${className}`} style={style}>
        {avatarEmoji}
      </span>
    )
  }
  return (
    <span className={`avatar-circle avatar-circle-initial ${className}`} style={style}>
      {(pseudo || '?').charAt(0).toUpperCase()}
    </span>
  )
}
