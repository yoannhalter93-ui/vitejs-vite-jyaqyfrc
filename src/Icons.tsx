// Petites illustrations pour habiller l'accueil : un vrai ballon de foot
// (illustration extraite telle quelle de la maquette envoyée) et une coupe
// pour le classement.

import ballonImg from './assets/ballon-illustration.png'

export function SketchBall({ size = 120, className }: { size?: number; className?: string }) {
  return (
    <img
      src={ballonImg}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export function SketchTrophy({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <path
        d="M16 8H32V22C32 27 28.5 31 24 31C19.5 31 16 27 16 22V8Z"
        stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"
      />
      <path
        d="M16 11H10C10 17 12.5 21 16.5 21.5"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <path
        d="M32 11H38C38 17 35.5 21 31.5 21.5"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <path d="M24 31V37" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 43H32L29 37H19L16 43Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  )
}

// petite manette de jeu dessinée à la main, pour habiller le bas de
// l'onglet Jeux (même esprit que le ballon/la coupe ci-dessus)
export function SketchController({ size = 60, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * 0.625} viewBox="0 0 64 40" fill="none" className={className}>
      <path
        d="M16 8H48C56 8 60 14 60 20C60 28 55 32 50 32C46 32 44 28 40 28H24C20 28 18 32 14 32C9 32 4 28 4 20C4 14 8 8 16 8Z"
        stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"
      />
      <path d="M16 16V24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12 20H20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="44" cy="15" r="2.2" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="50" cy="21" r="2.2" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  )
}

// petit schéma tactique dessiné à la main (X/O + flèche en pointillés),
// pour le fond du tchat façon "carnet de coach"
export function SketchTactics({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="10" cy="30" r="2.2" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="38" cy="34" r="2.2" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 12L26 18M26 12L20 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M34 10L40 16M40 10L34 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12 27C18 18 26 16 32 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" fill="none" />
      <path d="M28 14L32 13L31 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// petite tour de projecteurs dessinée à la main, pour habiller le fond du tchat
export function SketchFloodlight({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 40 48" fill="none" className={className}>
      <path d="M20 48V16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 48L14 16M34 48L26 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="6" y="4" width="28" height="14" rx="2" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M11 8H29M11 12H29" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

// petit trait ondulé "à la main" utilisé sous les titres de section
export function Squiggle({ width = 46, className }: { width?: number; className?: string }) {
  return (
    <svg width={width} height="10" viewBox="0 0 46 10" fill="none" className={className}>
      <path
        d="M2 6.5C7 2.5 10 2.5 14 6C18 9.5 21 3 25 4C29 5 31 8.5 35 5.5C38 3 40 3.5 44 6"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none"
      />
    </svg>
  )
}

// petit ballon dessiné à la main (motif pentagone simplifié), pour les
// pastilles d'icône des cartes de groupe — dans le même esprit graphique
// que SketchTactics/SketchTrophy plutôt que la photo de SketchBall, pour
// rester cohérent avec les autres pastilles (toutes en simple trait)
export function SketchFootball({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="24" r="17" stroke="currentColor" strokeWidth="2.4" />
      <path d="M24 15L30 19.5L28 26.5H20L18 19.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M24 15V9.5M30 19.5L35.5 16M28 26.5L31 32.5M20 26.5L17 32.5M18 19.5L12.5 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// deux silhouettes dessinées à la main (tête + épaules), pour la pastille
// d'icône des groupes "famille"/amis — même style de trait que les autres
// petites illustrations de cet écran
export function SketchPeople({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="17" cy="16" r="6" stroke="currentColor" strokeWidth="2.4" />
      <path d="M6 38C6 30 10.5 26 17 26C23.5 26 28 30 28 38" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="33" cy="19" r="5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M25.5 38C26 32 29.5 29.5 33 29.5C38 29.5 42 33 42 38" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

// icône "œil" : bascule d'affichage du mot de passe (connexion / inscription)
export function EyeIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M2 12C2 12 5.5 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 18.5 18.5 12 18.5C5.5 18.5 2 12 2 12Z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

// même icône, barrée : le mot de passe est actuellement affiché en clair
export function EyeOffIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3.5 3.5L20.5 20.5"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
      <path
        d="M10.6 5.65C11.05 5.55 11.52 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 21.16 13.55 19.6 15.05M6.9 6.9C4.2 8.55 2 12 2 12C2 12 5.5 18.5 12 18.5C13.8 18.5 15.3 18 16.55 17.3"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <path
        d="M9.9 9.9C9.34 10.46 9 11.19 9 12C9 13.66 10.34 15 12 15C12.81 15 13.54 14.66 14.1 14.1"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  )
}

// Sifflet d'arbitre : bouton des notifications (à la place de la cloche,
// plus dans le thème foot). Doré comme l'ancienne cloche emoji.
export function WhistleIcon({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="whistle-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F3CF63" />
          <stop offset="1" stopColor="#C8961F" />
        </linearGradient>
      </defs>
      {/* cordon */}
      <circle cx="6.5" cy="8.5" r="3" fill="none" stroke="#C8961F" strokeWidth="1.8" />
      <path d="M8.6 10.6 L10.8 13" stroke="#C8961F" strokeWidth="1.8" strokeLinecap="round" />
      {/* corps : chambre ronde + embouchure */}
      <path
        d="M12.5 11.5 H27.5 a1.8 1.8 0 0 1 1.8 1.8 V16.2 a1.8 1.8 0 0 1 -1.8 1.8 H21.2
           A8.4 8.4 0 1 1 12.5 11.5 Z"
        fill="url(#whistle-gold)"
        stroke="#7A5A12"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* fente d'air */}
      <rect x="15.2" y="11.5" width="3.4" height="2.4" rx="0.6" fill="#7A5A12" />
      {/* bille */}
      <circle cx="12.5" cy="19.9" r="3.1" fill="#7A5A12" opacity="0.55" />
      {/* reflet */}
      <path d="M7.6 16.4 a5.6 5.6 0 0 1 3.2 -2.8" stroke="#FFF3C4" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}
