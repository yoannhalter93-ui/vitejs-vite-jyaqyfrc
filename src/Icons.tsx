// Petites illustrations "façon croquis" pour habiller l'accueil : un ballon
// dessiné au trait (repris du même dessin que l'icône de l'appli, mais en
// version contour) et une coupe pour le classement. Volontairement simples
// (SVG statique, une seule couleur de trait) pour rester légers et lisibles
// à toutes les tailles.

export function SketchBall({ size = 120, className }: { size?: number; className?: string }) {
  const cx = 60
  const cy = 60
  const r = 52
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth="3" />
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M60 60 L60 34 L38 20" />
        <path d="M60 60 L84 44 L96 62" />
        <path d="M60 60 L78 82 L66 104" />
        <path d="M60 60 L42 82 L26 100" />
        <path d="M60 60 L36 46 L18 52" />
        <path d="M60 34 L84 44" />
        <path d="M84 44 L78 82" />
        <path d="M78 82 L42 82" />
        <path d="M42 82 L36 46" />
        <path d="M36 46 L60 34" />
      </g>
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
