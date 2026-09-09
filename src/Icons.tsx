// Petites illustrations pour habiller l'accueil : un vrai ballon de foot
// (illustration extraite telle quelle de la maquette envoyÃ©e) et une coupe
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

// petit trait ondulÃ© "Ã  la main" utilisÃ© sous les titres de section
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
