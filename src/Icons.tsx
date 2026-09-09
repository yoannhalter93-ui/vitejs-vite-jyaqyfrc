// Petites illustrations "façon croquis" pour habiller l'accueil : un vrai
// ballon de foot (panneaux noirs pleins sur fond crème, façon icône
// classique — pas juste un contour) et une coupe pour le classement.
// Volontairement en deux couleurs (crème + encre) pour rester lisibles à
// toutes les tailles et cohérentes avec le reste de la charte.

export function SketchBall({ size = 120, className }: { size?: number; className?: string }) {
  const cx = 60
  const cy = 60
  const r = 52
  // pentagone central + 5 panneaux extérieurs, disposition classique d'un
  // ballon de foot vu de face (calculée géométriquement, cf. commit).
  const central = '60,41 78.1,54.1 71.2,75.4 48.8,75.4 41.9,54.1'
  const outer0 = '72.3,43 67.6,28.5 80,19.5 92.3,28.5 87.6,43'
  const outer1 = '80,66.5 92.3,57.5 104.7,66.5 100,81 84.7,81'
  const outer2 = '60,81 72.4,90 67.6,104.5 52.4,104.5 47.6,90'
  const outer3 = '40,66.5 35.3,81 20,81 15.3,66.5 27.7,57.5'
  const outer4 = '47.7,43 32.4,43 27.7,28.5 40,19.5 52.4,28.5'
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className}>
      <circle cx={cx} cy={cy} r={r} fill="#F4EFE2" stroke="#1B1B1F" strokeWidth="3.5" />
      <g fill="#1B1B1F" stroke="#1B1B1F" strokeWidth="1.5" strokeLinejoin="round">
        <polygon points={central} />
        <polygon points={outer0} />
        <polygon points={outer1} />
        <polygon points={outer2} />
        <polygon points={outer3} />
        <polygon points={outer4} />
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1B1B1F" strokeOpacity="0.15" strokeWidth="1" />
    </svg>
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
