import { useMemo } from 'react'

// ============================================================================
// Décor des tirs au but : stade de nuit, cage, gardien, tireur n°10 vu de dos.
// On vise en touchant directement la cage (5 zones). Les animations (ballon
// qui part, gardien qui plonge) sont pilotées par l'écran du duel.
// ============================================================================

export type PenaltyZone = 'haut-gauche' | 'haut-droite' | 'milieu' | 'bas-gauche' | 'bas-droite'

// centre de chaque zone dans la cage (coordonnées du dessin 380 × 440)
const ZONE_XY: Record<string, [number, number]> = {
  'haut-gauche': [102, 128],
  'haut-droite': [278, 128],
  'milieu': [190, 172],
  'bas-gauche': [102, 210],
  'bas-droite': [278, 210],
}
// plongeon du gardien vers chaque zone (depuis sa position au centre)
const DIVE: Record<string, string> = {
  'haut-gauche': 'translate(-70px, -34px) rotate(-58deg)',
  'haut-droite': 'translate(70px, -34px) rotate(58deg)',
  'milieu': 'translate(0px, -26px)',
  'bas-gauche': 'translate(-80px, 14px) rotate(-84deg)',
  'bas-droite': 'translate(80px, 14px) rotate(84deg)',
}
const SPOT: [number, number] = [206, 392]

// public : points de couleur, toujours les mêmes (graine fixe)
function useCrowd() {
  return useMemo(() => {
    const dots: { x: number; y: number; c: string }[] = []
    let seed = 7
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    const colors = ['#d8dce6', '#2b55c9', '#c9302c', '#f2c94c', '#1b2a52', '#e8e8e8', '#3a6fd8']
    for (let row = 0; row < 9; row++) {
      for (let i = 0; i < 46; i++) {
        dots.push({ x: i * 8.4 + (row % 2) * 4 + rnd() * 2, y: 52 + row * 10.5 + rnd() * 2, c: colors[Math.floor(rnd() * colors.length)] })
      }
    }
    return dots
  }, [])
}

export default function PenaltyScene({
  choosing,
  onPick,
  ballZone,
  ballFlying,
  showBall,
  keeperZone,
  kicking,
  result,
  netShake,
}: {
  choosing: boolean                  // on attend que le joueur touche une zone
  onPick: (zone: PenaltyZone) => void
  ballZone: string | null            // où va le ballon (null = sur le point de penalty)
  ballFlying: boolean
  showBall: boolean
  keeperZone: string | null          // où plonge le gardien (null = au centre)
  kicking: boolean                   // le tireur frappe
  result: 'goal' | 'save' | null
  netShake: boolean
}) {
  const crowd = useCrowd()
  const target = ballZone && ballFlying ? ZONE_XY[ballZone] : SPOT
  const ballMove = `translate(${target[0] - SPOT[0]}px, ${target[1] - SPOT[1]}px) scale(${ballZone && ballFlying ? 0.42 : 1})`

  return (
    <svg className="pk-scene" viewBox="0 0 380 440" role="img" aria-label="Tir au but">
      <defs>
        <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1638" />
          <stop offset="1" stopColor="#16307a" />
        </linearGradient>
        <radialGradient id="pk-flood" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.25" stopColor="#bcd4ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#7aa2ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pk-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f8f3a" />
          <stop offset="1" stopColor="#1e6e2b" />
        </linearGradient>
        <radialGradient id="pk-ball" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#e6e8ec" />
          <stop offset="1" stopColor="#9ea3aa" />
        </radialGradient>
        <linearGradient id="pk-board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d3c8f" />
          <stop offset="1" stopColor="#0e2259" />
        </linearGradient>
        <pattern id="pk-net" width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M0 0 L9 9 M9 0 L0 9" stroke="rgba(255,255,255,.45)" strokeWidth="0.8" />
        </pattern>
      </defs>

      {/* tribunes */}
      <rect x="0" y="0" width="380" height="160" fill="url(#pk-sky)" />
      {crowd.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="3.1" fill={d.c} opacity="0.85" />)}
      <rect x="0" y="40" width="380" height="120" fill="rgba(8,16,40,.25)" />
      <circle cx="30" cy="22" r="60" fill="url(#pk-flood)" />
      <circle cx="350" cy="22" r="60" fill="url(#pk-flood)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={'l' + i} cx={18 + (i % 3) * 12} cy={16 + Math.floor(i / 3) * 10} r="3.5" fill="#fff" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={'r' + i} cx={338 + (i % 3) * 12} cy={16 + Math.floor(i / 3) * 10} r="3.5" fill="#fff" />
      ))}

      {/* panneaux publicitaires */}
      <rect x="0" y="148" width="380" height="26" fill="url(#pk-board)" />
      {[0, 1, 2, 3].map((i) => (
        <text key={i} x={48 + i * 95} y="166" textAnchor="middle" className="pk-board-text">Entre Nous</text>
      ))}

      {/* pelouse rayée + lignes */}
      <rect x="0" y="174" width="380" height="266" fill="url(#pk-grass)" />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const y0 = 174 + i * 44
        return i % 2 ? <rect key={i} x="0" y={y0} width="380" height="44" fill="rgba(255,255,255,.06)" /> : null
      })}
      <g stroke="rgba(255,255,255,.85)" strokeWidth="2.5" fill="none">
        <line x1="0" y1="232" x2="380" y2="232" />
        <path d="M30 232 L8 282 L372 282 L350 232" />
        <path d="M-40 232 L-90 352 M420 232 L470 352" />
      </g>
      <ellipse cx={SPOT[0]} cy={SPOT[1] + 9} rx="7" ry="3" fill="rgba(255,255,255,.85)" />

      {/* cage */}
      <g className={netShake ? 'pk-goal pk-goal-shake' : 'pk-goal'}>
        <path d="M74 102 L92 86 L288 86 L306 102 L306 232 L74 232 Z" fill="rgba(255,255,255,.08)" />
        <path d="M74 102 L92 86 L288 86 L306 102 L306 232 L74 232 Z" fill="url(#pk-net)" />
        <path d="M92 86 L92 220 M288 86 L288 220 M92 220 L288 220" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" fill="none" />
        <path d="M74 232 L92 220 M306 232 L288 220" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
        {/* poteaux et transversale */}
        <path d="M72 234 L72 100 L308 100 L308 234" stroke="#f4f6f8" strokeWidth="7" fill="none" strokeLinejoin="round" />
        <path d="M74 234 L74 102 L306 102 L306 234" stroke="rgba(0,0,0,.18)" strokeWidth="2" fill="none" />
      </g>

      {/* gardien */}
      <g transform="translate(190, 230)">
        <g className="pk-keeper" style={{ transform: keeperZone ? DIVE[keeperZone] : 'none' }}>
          <ellipse cx="0" cy="2" rx="20" ry="4" fill="rgba(0,0,0,.25)" />
          {/* jambes */}
          <path d="M-9 -24 L-13 0 M9 -24 L13 0" stroke="#1b1b1f" strokeWidth="8" strokeLinecap="round" />
          <path d="M-13 -6 L-14 0 M13 -6 L14 0" stroke="#f2d01e" strokeWidth="8" strokeLinecap="round" />
          {/* short */}
          <rect x="-15" y="-36" width="30" height="14" rx="4" fill="#1b1b1f" />
          {/* bras écartés + gants */}
          <path d="M-15 -66 L-34 -52 L-40 -68 M15 -66 L34 -52 L40 -68" stroke="#f2d01e" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="-41" cy="-71" r="6.5" fill="#2fd16b" stroke="#106b33" strokeWidth="1.5" />
          <circle cx="41" cy="-71" r="6.5" fill="#2fd16b" stroke="#106b33" strokeWidth="1.5" />
          {/* maillot */}
          <path d="M-17 -70 Q0 -76 17 -70 L15 -34 L-15 -34 Z" fill="#f2d01e" stroke="#c9a500" strokeWidth="1.5" />
          <path d="M-17 -60 L17 -60" stroke="#1b1b1f" strokeWidth="2" opacity="0.6" />
          {/* tête */}
          <circle cx="0" cy="-82" r="10" fill="#e0a77a" />
          <path d="M-10 -84 Q0 -98 10 -84 Q4 -90 -10 -84 Z" fill="#3b2414" />
        </g>
      </g>

      {/* zones à viser (seulement quand on choisit) */}
      {choosing && Object.entries(ZONE_XY).map(([z, [x, y]]) => (
        <g key={z} className="pk-zone" role="button" aria-label={z.replace('-', ' ')} onClick={() => onPick(z as PenaltyZone)}>
          <circle cx={x} cy={y} r="27" fill="rgba(255,210,74,.14)" />
          <circle cx={x} cy={y} r="22" fill="none" stroke="#FFD24A" strokeWidth="3" strokeDasharray="6 5" className="pk-zone-ring" />
          <circle cx={x} cy={y} r="4" fill="#FFD24A" />
        </g>
      ))}

      {/* ballon */}
      {showBall && (
        <g transform={`translate(${SPOT[0]}, ${SPOT[1]})`}>
          <g className="pk-ball" style={{ transform: ballMove }}>
            <ellipse cx="2" cy="14" rx="13" ry="4" fill="rgba(0,0,0,.3)" />
            <circle cx="0" cy="0" r="15" fill="url(#pk-ball)" />
            <path d="M0 -6 L5.7 -1.9 L3.5 4.9 L-3.5 4.9 L-5.7 -1.9 Z" fill="#1b1b1f" />
            <path d="M0 -6 L0 -15 M5.7 -1.9 L14 -4.5 M3.5 4.9 L8.5 12 M-3.5 4.9 L-8.5 12 M-5.7 -1.9 L-14 -4.5" stroke="#1b1b1f" strokeWidth="1.4" />
          </g>
        </g>
      )}

      {/* tireur n°10, vu de dos */}
      <g className={kicking ? 'pk-kicker pk-kicker-kick' : 'pk-kicker'} transform="translate(112, 440)">
        {/* jambe d'appui + jambe de frappe */}
        <path d="M-20 -58 L-30 -8" stroke="#f5f5f5" strokeWidth="16" strokeLinecap="round" />
        <path d="M-30 -30 L-33 -6" stroke="#d61f26" strokeWidth="15" strokeLinecap="round" />
        <path d="M-37 -4 L-24 -4" stroke="#1b1b1f" strokeWidth="9" strokeLinecap="round" />
        <g className="pk-kick-leg">
          <path d="M16 -58 L30 -14" stroke="#f5f5f5" strokeWidth="16" strokeLinecap="round" />
          <path d="M26 -36 L32 -12" stroke="#d61f26" strokeWidth="15" strokeLinecap="round" />
          <path d="M28 -8 L42 -10" stroke="#1b1b1f" strokeWidth="9" strokeLinecap="round" />
        </g>
        {/* short */}
        <path d="M-34 -96 L34 -96 L36 -56 L4 -52 L0 -62 L-4 -52 L-36 -56 Z" fill="#f5f5f5" stroke="#cfd3da" strokeWidth="1.5" />
        {/* bras */}
        <path d="M-36 -160 L-56 -116 L-50 -96" stroke="#1d2f6f" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M-52 -104 L-48 -94" stroke="#e0a77a" strokeWidth="12" strokeLinecap="round" />
        <path d="M36 -160 L58 -122 L56 -100" stroke="#1d2f6f" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M57 -108 L56 -98" stroke="#e0a77a" strokeWidth="12" strokeLinecap="round" />
        {/* maillot */}
        <path d="M-40 -168 Q0 -180 40 -168 L36 -94 L-36 -94 Z" fill="#1d2f6f" stroke="#13204d" strokeWidth="2" />
        <path d="M-40 -168 Q0 -180 40 -168" stroke="#d61f26" strokeWidth="4" fill="none" />
        <text x="0" y="-116" textAnchor="middle" className="pk-number">10</text>
        {/* tête (cheveux, de dos) */}
        <rect x="-9" y="-186" width="18" height="12" fill="#c98e63" />
        <ellipse cx="0" cy="-198" rx="20" ry="22" fill="#3b2414" />
        <path d="M-20 -200 Q-4 -224 18 -206 Q10 -214 -2 -214 Q-14 -212 -20 -200 Z" fill="#5a3820" />
        <ellipse cx="-20" cy="-196" rx="4" ry="6" fill="#c98e63" />
        <ellipse cx="20" cy="-196" rx="4" ry="6" fill="#c98e63" />
      </g>

      {/* flash du résultat */}
      {result && (
        <g className="pk-result">
          <rect x="0" y="0" width="380" height="440" fill={result === 'goal' ? 'rgba(255,210,74,.22)' : 'rgba(255,255,255,.16)'} />
          <text x="190" y="300" textAnchor="middle" className={result === 'goal' ? 'pk-result-text pk-goal-text' : 'pk-result-text pk-save-text'}>
            {result === 'goal' ? 'BUUUT !' : 'ARRÊT !'}
          </text>
        </g>
      )}
    </svg>
  )
}
