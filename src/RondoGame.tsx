import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// ============================================================================
// Le toro (taureau / rondo) — PROTOTYPE de mini-jeu (visible par
// l'administrateur seulement, score non enregistré).
//
// Tes 6 joueurs (jaunes) sont en cercle et bougent un peu ; un taureau (rouge)
// est au milieu. Tape un coéquipier pour lui passer le ballon. Le taureau
// presse le porteur en fermant une ligne de passe et coupe les passes qu'il
// peut atteindre ; s'il touche le porteur ou intercepte, c'est fini.
// 1 point par passe réussie. Toutes les 6 passes le taureau accélère ; à 12
// passes un 2e taureau entre. Passe entre les deux taureaux (petit pont) : +2.
// Chaque partie est différente (tirage au hasard).
// ============================================================================

interface Props {
  onExit: () => void
}

type P = { x: number; y: number }

const LW = 360 // largeur logique de l'écran
const SCALE = LW / 27 // px logiques par mètre
const RADIUS = 9.5 // rayon du cercle des joueurs (m)
const N_PLAYERS = 6
const BALL_V = 14
const BULL_ACCEL = 16 // les taureaux ont de l'élan : pas d'arrêt ni de demi-tour instantané
const PLAYER_R = 0.85
const RECEIVE_R = 1.4
const TACKLE_R = 1.2
const CONTROL_TIME = 0.45 // le temps du contrôle, personne ne peut tacler
const SECOND_BULL_AT = 12
const LEVEL_EVERY = 6 // le taureau accélère toutes les 6 passes

interface Player {
  x: number; y: number
  angle: number // position de base sur le cercle
  wobble: number; freq: number; phase: number // petit déplacement autour de sa place
  radial: number
}

interface Bull {
  x: number; y: number
  vx: number; vy: number
  goal: P // là où il veut aller (il continue d'y courir pendant son temps de réaction)
  speedMul: number
  reactMul: number
}

interface Ball {
  x: number; y: number
  vx: number; vy: number
  to: number // index du destinataire
  crossedGap: boolean // petit pont déjà compté sur cette passe
}

type Phase = 'idle' | 'play' | 'lost' | 'over'

interface Engine {
  phase: Phase
  t: number
  rng: () => number
  players: Player[]
  bulls: Bull[]
  carrier: number // -1 : ballon en l'air
  from: number // passeur de la passe en cours
  queued: number // passe anticipée : jouée en une touche dès la réception (-1 : aucune)
  rotDir: number // sens de la dernière passe autour du cercle (+1 / -1, 0 : en travers)
  rotStreak: number // nombre de passes d'affilée dans ce sens (les taureaux le repèrent)
  guessDir: number // sens de la prochaine passe que les taureaux anticipent
  cycle: number // temps moyen entre deux réceptions (pour les embuscades)
  lastRecvT: number
  hold: number
  ball: Ball
  flightT: number
  passes: number
  points: number
  msg: { text: string; sub: string; color: string; at: number } | null
  pauseUntil: number
  viewH: number
}

function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// difficulté selon le nombre de passes réussies
function level(passes: number) {
  const k = Math.floor(passes / LEVEL_EVERY)
  return {
    bullSpeed: Math.min(7.2, 4.7 + k * 0.45),
    reaction: Math.max(0.08, 0.25 - k * 0.03),
    reach: Math.min(1.15, 0.85 + k * 0.05),
  }
}

function newBull(rng: () => number): Bull {
  return { x: 0, y: 0, vx: 0, vy: 0, goal: { x: 0, y: 0 }, speedMul: 0.95 + rng() * 0.1, reactMul: 0.9 + rng() * 0.3 }
}

// course avec élan vers b.goal (accélération limitée, freinage à l'arrivée)
// Embuscade contre une tournante : parmi les prochaines passes dans le même
// sens, la première ligne de passe que le taureau peut atteindre avant le
// ballon (il coupe en avance au lieu de courir derrière).
function ambush(e: Engine, b: Bull, speed: number): P | null {
  const n = N_PLAYERS, dir = e.rotDir
  if (!dir) return null
  const base = e.carrier >= 0 ? e.carrier : e.ball.to
  const chordT = (2 * RADIUS * Math.sin(Math.PI / n)) / BALL_V
  const toBase = e.carrier >= 0 ? 0 : Math.hypot(e.players[base].x - e.ball.x, e.players[base].y - e.ball.y) / BALL_V
  const holdT = Math.max(0.15, e.cycle - chordT - (e.carrier >= 0 ? e.hold : 0))
  for (let k = 1; k <= 4; k++) {
    const a = e.players[(base + (k - 1) * dir + n * 4) % n]
    const c = e.players[(base + k * dir + n * 4) % n]
    const pt = { x: (a.x + c.x) * 0.47, y: (a.y + c.y) * 0.47 }
    const tBall = toBase + holdT + (k - 1) * e.cycle + chordT * 0.5
    if (Math.hypot(pt.x - b.x, pt.y - b.y) / speed + 0.1 < tBall) return pt
  }
  return null
}

function steer(b: Bull, maxSpeed: number, dt: number) {
  const dx = b.goal.x - b.x, dy = b.goal.y - b.y
  const d = Math.hypot(dx, dy)
  const want = Math.min(maxSpeed, d * 3)
  const tvx = d > 0.01 ? (dx / d) * want : 0, tvy = d > 0.01 ? (dy / d) * want : 0
  let ax = tvx - b.vx, ay = tvy - b.vy
  const al = Math.hypot(ax, ay), maxA = BULL_ACCEL * dt
  if (al > maxA) { ax *= maxA / al; ay *= maxA / al }
  b.vx += ax; b.vy += ay
  b.x += b.vx * dt; b.y += b.vy * dt
}

function newEngine(seed: number): Engine {
  const rng = mulberry32(seed)
  const start = rng() * Math.PI * 2
  const players: Player[] = Array.from({ length: N_PLAYERS }, (_, i) => ({
    x: 0, y: 0,
    angle: start + (i * Math.PI * 2) / N_PLAYERS,
    wobble: 0.12 + rng() * 0.12,
    freq: 0.5 + rng() * 0.7,
    phase: rng() * Math.PI * 2,
    radial: (rng() - 0.5) * 2,
  }))
  const e: Engine = {
    phase: 'idle', t: 0, rng, players,
    bulls: [newBull(rng)],
    carrier: Math.floor(rng() * N_PLAYERS), from: -1, queued: -1, rotDir: 0, rotStreak: 0, guessDir: 1, cycle: 1.3, lastRecvT: -1, hold: -1, // 1,5 s de répit au départ
    ball: { x: 0, y: 0, vx: 0, vy: 0, to: -1, crossedGap: false },
    flightT: 0, passes: 0, points: 0, msg: null, pauseUntil: 0, viewH: 480,
  }
  placePlayers(e, true)
  const c = e.players[e.carrier]
  e.ball.x = c.x * 0.92; e.ball.y = c.y * 0.92
  return e
}

function placePlayers(e: Engine, all = false) {
  e.players.forEach((p, i) => {
    if (i === e.carrier && !all) return // le porteur ne bouge pas : il contrôle
    const a = p.angle + p.wobble * Math.sin(e.t * p.freq + p.phase)
    const r = RADIUS + p.radial * Math.sin(e.t * p.freq * 0.7 + p.phase * 1.3)
    p.x = Math.cos(a) * r
    p.y = Math.sin(a) * r
  })
}

function segDist(p: P, a: P, b: P) {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// les segments [a,b] et [c,d] se coupent-ils ?
function crosses(a: P, b: P, c: P, d: P) {
  const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

// premier point de la trajectoire que le taureau peut atteindre avant le ballon
function interceptPoint(ball: Ball, b: P, speed: number, reach: number): P | null {
  for (let t = 0.04; t <= 2; t += 0.04) {
    const x = ball.x + ball.vx * t, y = ball.y + ball.vy * t
    if (Math.hypot(x, y) > RADIUS + 1) break
    if (Math.hypot(x - b.x, y - b.y) - reach <= speed * t) return { x, y }
  }
  return null
}

// passe du porteur vers le joueur `to`
function kick(e: Engine, to: number) {
  const target = e.players[to]
  const dx = target.x - e.ball.x, dy = target.y - e.ball.y
  const d = Math.hypot(dx, dy) || 1
  e.ball.vx = (dx / d) * BALL_V
  e.ball.vy = (dy / d) * BALL_V
  e.ball.to = to
  e.ball.crossedGap = false
  e.from = e.carrier
  e.carrier = -1
  e.flightT = 0
  e.queued = -1
  // sens de rotation de la passe : les taureaux repèrent les tournantes
  const n = N_PLAYERS
  const diff = (to - e.from + n) % n
  const dir = diff === 1 ? 1 : diff === n - 1 ? -1 : 0
  e.rotStreak = dir !== 0 && dir === e.rotDir ? e.rotStreak + 1 : dir !== 0 ? 1 : 0
  e.rotDir = dir
  e.guessDir = dir !== 0 ? dir : (e.rng() < 0.5 ? 1 : -1)
}

export default function RondoGame({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Engine>(newEngine((Math.random() * 4294967296) >>> 0))
  const [phase, setPhase] = useState<Phase>('idle')
  const [points, setPoints] = useState(0)
  const [passes, setPasses] = useState(0)
  const [bulls, setBulls] = useState(1)
  const [best, setBest] = useState(0)
  const [showRules, setShowRules] = useState(false)

  const sync = () => {
    const e = engineRef.current
    setPoints(e.points); setPasses(e.passes); setBulls(e.bulls.length)
  }

  const startGame = () => {
    const e = newEngine((Math.random() * 4294967296) >>> 0)
    e.phase = 'play'
    e.msg = { text: 'Toro !', sub: 'Tape un coéquipier pour lui passer le ballon', color: '#F4EFE2', at: 0 }
    engineRef.current = e
    setPhase('play')
    sync()
  }

  const say = (e: Engine, text: string, sub: string, color: string) => {
    e.msg = { text, sub, color, at: e.t }
  }

  const lose = (e: Engine, text: string, sub: string) => {
    if (e.phase !== 'play') return
    e.phase = 'lost'
    e.pauseUntil = e.t + 1.3
    say(e, text, sub, '#E8705F')
    if (navigator.vibrate) try { navigator.vibrate(120) } catch { /* rien */ }
  }

  // ------------------------------------------------------ simulation -----
  const step = (dt: number) => {
    const e = engineRef.current
    e.t += dt
    if (e.phase === 'idle' || e.phase === 'over') { placePlayers(e); return }
    if (e.phase === 'lost') {
      if (e.t >= e.pauseUntil) {
        e.phase = 'over'
        setBest((b) => Math.max(b, e.points))
        setPhase('over')
      }
      return
    }
    const L = level(e.passes)
    const ball = e.ball
    placePlayers(e)

    // --- receveur : il va au-devant du ballon ---
    if (e.carrier < 0) {
      const r = e.players[ball.to]
      const v = Math.hypot(ball.vx, ball.vy) || 1
      const ux = ball.vx / v, uy = ball.vy / v
      const along = (r.x - ball.x) * ux + (r.y - ball.y) * uy
      if (along > 0) {
        const px = ball.x + ux * along, py = ball.y + uy * along
        if (Math.hypot(r.x - px, r.y - py) < 2.5) { r.x += (px - r.x) * 0.6; r.y += (py - r.y) * 0.6 }
      }
    }

    // --- taureaux ---
    const n = N_PLAYERS
    const carrier = e.carrier >= 0 ? e.players[e.carrier] : null
    const shutLane = (from: P, to: P, k: number): P => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })
    e.bulls.forEach((b, bi) => {
      const sp = L.bullSpeed * b.speedMul
      if (!carrier) {
        // passe partie : pendant son temps de réaction il continue sur sa
        // lancée, puis il coupe la trajectoire s'il peut l'atteindre ; sinon il
        // anticipe la passe suivante (il a repéré dans quel sens ça tourne)
        if (e.flightT >= L.reaction * b.reactMul) {
          const cut = interceptPoint(ball, b, sp * 0.95, L.reach)
          const amb = !cut && bi === 0 && e.rotStreak >= 1 ? ambush(e, b, sp) : null
          if (cut) b.goal = cut
          else if (amb) b.goal = amb
          else {
            const r = e.players[ball.to]
            const next = e.players[(ball.to + (bi === 0 ? e.guessDir : -e.guessDir) + n) % n]
            b.goal = bi === 0 ? shutLane(r, next, 0.3) : shutLane(r, next, 0.55)
          }
        }
        steer(b, sp, dt)
        return
      }
      // voisins du porteur = passes les plus probables
      const ahead = e.players[(e.carrier + e.guessDir + n) % n]
      const behind = e.players[(e.carrier - e.guessDir + n) % n]
      if (bi === 0) {
        // 1er taureau : il presse le porteur en fermant la passe attendue
        // (celle qui continue la tournante), sinon la plus proche de lui
        const shut = e.rotStreak >= 1 ? ahead
          : Math.hypot(b.x - ahead.x, b.y - ahead.y) < Math.hypot(b.x - behind.x, b.y - behind.y) ? ahead : behind
        const dx = shut.x - carrier.x, dy = shut.y - carrier.y, dl = Math.hypot(dx, dy) || 1
        const dc = Math.hypot(b.x - carrier.x, b.y - carrier.y)
        const off = Math.min(1.6, dc * 0.4)
        b.goal = { x: carrier.x + (dx / dl) * off, y: carrier.y + (dy / dl) * off }
        // tournante repérée : il coupe en avance plutôt que de courir derrière
        if (e.rotStreak >= 2) {
          const amb = ambush(e, b, sp)
          if (amb) b.goal = amb
        }
      } else {
        // 2e taureau : il ferme l'autre voisin et les passes en travers
        const first = e.bulls[0]
        const other = Math.hypot(first.x - ahead.x, first.y - ahead.y) < Math.hypot(first.x - behind.x, first.y - behind.y) ? behind : ahead
        b.goal = { x: carrier.x * 0.2 + other.x * 0.4, y: carrier.y * 0.2 + other.y * 0.4 }
      }
      steer(b, sp, dt)
    })
    // les taureaux ne se superposent pas
    if (e.bulls.length === 2) {
      const [A, B] = e.bulls
      const dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy)
      if (dd > 0.01 && dd < 1.8) {
        const push = (1.8 - dd) * 0.5
        A.x -= (dx / dd) * push; A.y -= (dy / dd) * push
        B.x += (dx / dd) * push; B.y += (dy / dd) * push
      }
    }

    // --- porteur ---
    if (carrier) {
      e.hold += dt
      const toC = Math.hypot(carrier.x, carrier.y) || 1
      ball.x = carrier.x - (carrier.x / toC) * 0.9
      ball.y = carrier.y - (carrier.y / toC) * 0.9
      if (e.hold > CONTROL_TIME) {
        for (const b of e.bulls) {
          if (Math.hypot(b.x - carrier.x, b.y - carrier.y) < TACKLE_R) {
            lose(e, 'Taclé !', 'Passe plus vite, en une touche')
            return
          }
        }
      }
      return
    }

    // --- ballon en l'air ---
    e.flightT += dt
    const prev = { x: ball.x, y: ball.y }
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    for (const b of e.bulls) {
      if (segDist(b, prev, ball) < L.reach) { lose(e, 'Intercepté !', 'Le taureau a coupé la passe'); return }
    }
    // petit pont : le ballon passe entre les deux taureaux
    if (e.bulls.length === 2 && !ball.crossedGap) {
      const [A, B] = e.bulls
      if (Math.hypot(A.x - B.x, A.y - B.y) < 6 && crosses(prev, ball, A, B)) {
        ball.crossedGap = true
        e.points += 2
        say(e, 'Petit pont !', '+2 points', '#E8B931')
        sync()
      }
    }
    const r = e.players[ball.to]
    if (segDist(r, prev, ball) < RECEIVE_R) {
      e.carrier = ball.to
      e.hold = 0
      if (e.lastRecvT >= 0) e.cycle = e.cycle * 0.7 + (e.t - e.lastRecvT) * 0.3
      e.lastRecvT = e.t
      e.passes += 1
      e.points += 1
      if (e.passes === SECOND_BULL_AT) {
        e.bulls.push(newBull(e.rng))
        say(e, '2e taureau !', 'Ça se complique…', '#E8B931')
      } else if (e.passes % LEVEL_EVERY === 0) {
        say(e, `${e.passes} passes !`, 'Le taureau accélère', '#E8B931')
      }
      if (navigator.vibrate) try { navigator.vibrate(15) } catch { /* rien */ }
      // passe anticipée : remise en une touche, sans arrêt
      if (e.queued >= 0 && e.queued !== e.carrier) kick(e, e.queued)
      e.queued = -1
      sync()
      return
    }
    if (Math.hypot(ball.x, ball.y) > RADIUS + 4) lose(e, 'Sortie !', 'Le ballon a quitté le cercle')
  }

  // ---------------------------------------------------------- dessin -----
  const draw = (ctx: CanvasRenderingContext2D) => {
    const e = engineRef.current
    const H = e.viewH
    const X = (x: number) => LW / 2 + x * SCALE
    const Y = (y: number) => H / 2 - y * SCALE

    ctx.fillStyle = '#1d6b45'
    ctx.fillRect(0, 0, LW, H)
    for (let s = -20; s < 20; s += 2.5) {
      if (((s / 2.5) | 0) % 2 === 0) { ctx.fillStyle = '#227a4f'; ctx.fillRect(0, Y(s + 2.5), LW, 2.5 * SCALE) }
    }
    // cercle de l'exercice + plots
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 6])
    ctx.beginPath(); ctx.arc(X(0), Y(0), RADIUS * SCALE, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI * 2) / 12 + 0.26
      const cx = X(Math.cos(a) * (RADIUS + 2.2)), cy = Y(Math.sin(a) * (RADIUS + 2.2))
      ctx.fillStyle = '#E8833A'
      ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx - 4, cy + 3); ctx.lineTo(cx + 4, cy + 3); ctx.closePath(); ctx.fill()
    }

    const r = PLAYER_R * SCALE
    const disc = (x: number, y: number, fill: string, ring?: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath(); ctx.ellipse(X(x) + 2, Y(y) + 3, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = fill
      ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = ring ?? 'rgba(0,0,0,0.35)'
      ctx.lineWidth = ring ? 2.6 : 1
      ctx.stroke()
    }

    e.players.forEach((p, i) => disc(p.x, p.y, '#E8B931', i === e.carrier ? '#fff' : undefined))
    // passe anticipée : flèche du receveur vers le prochain joueur
    if (e.queued >= 0 && e.carrier < 0) {
      const a = e.players[e.ball.to], q = e.players[e.queued]
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), r + 5, 0, Math.PI * 2); ctx.stroke()
    }

    // taureaux : disque rouge avec deux cornes
    for (const b of e.bulls) {
      const bx = X(b.x), by = Y(b.y)
      ctx.strokeStyle = '#F4EFE2'
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(bx - r * 0.6, by - r * 0.6); ctx.quadraticCurveTo(bx - r * 1.4, by - r * 1.0, bx - r * 1.1, by - r * 1.7); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(bx + r * 0.6, by - r * 0.6); ctx.quadraticCurveTo(bx + r * 1.4, by - r * 1.0, bx + r * 1.1, by - r * 1.7); ctx.stroke()
      ctx.lineCap = 'butt'
      disc(b.x, b.y, '#C8443C')
    }

    // ballon
    const b = e.ball
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.arc(X(b.x) + 1.5, Y(b.y) + 2, 4.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), 4.5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1B1B1F'
    ctx.lineWidth = 0.8
    ctx.stroke()

    if (e.msg && e.t - e.msg.at < 1.6) {
      const a = Math.min(1, (1.6 - (e.t - e.msg.at)) / 0.4)
      ctx.globalAlpha = a
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(12,44,34,0.75)'
      // en haut de l'écran : le centre du cercle reste visible
      const my = Math.max(36, H / 2 - (RADIUS + 3.5) * SCALE)
      ctx.fillRect(LW / 2 - 130, my - 29, 260, 58)
      ctx.fillStyle = e.msg.color
      ctx.font = 'bold 24px Oswald, sans-serif'
      ctx.fillText(e.msg.text, LW / 2, my - 7)
      ctx.fillStyle = '#F4EFE2'
      ctx.font = '12px sans-serif'
      ctx.fillText(e.msg.sub, LW / 2, my + 16)
      ctx.globalAlpha = 1
    }
  }

  // ------------------------------------------------ boucle d'animation -----
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const resize = () => {
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      engineRef.current.viewH = (rect.height / rect.width) * LW
      const k = (rect.width / LW) * dpr
      ctx.setTransform(k, 0, 0, k, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(stage)
    let raf = 0
    let last = performance.now()
    const loop = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      engineRef.current.viewH = (canvas.height / canvas.width) * LW
      for (let i = 0; i < 3; i++) step(dt / 3)
      draw(ctx)
      // état lisible par les tests automatisés (bot), seulement s'ils le demandent
      if ((window as any).__toroDebug) (window as any).__toro = engineRef.current
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ tap ------
  const onPointerDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const e = engineRef.current
    if (e.phase !== 'play') return
    const rect = ev.currentTarget.getBoundingClientRect()
    const lx = ((ev.clientX - rect.left) / rect.width) * LW
    const ly = ((ev.clientY - rect.top) / rect.width) * LW
    const p = { x: (lx - LW / 2) / SCALE, y: (e.viewH / 2 - ly) / SCALE }
    // le coéquipier le plus proche du doigt (tap généreux)
    // ballon en l'air : on prépare la remise en une touche du receveur
    const holder = e.carrier >= 0 ? e.carrier : e.ball.to
    let to = -1, bestD = 4.5
    e.players.forEach((pl, i) => {
      if (i === holder) return
      const d = Math.hypot(pl.x - p.x, pl.y - p.y)
      if (d < bestD) { bestD = d; to = i }
    })
    if (to < 0) return
    if (e.carrier < 0) { e.queued = to; return }
    kick(e, to)
  }

  return (
    <div className="predictions-screen dribble-page">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Profil</button>
        <h2>🐂 Le toro (test)</h2>
      </div>

      <div className="dribble-app">
        <button type="button" className="dribble-rules-toggle" onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Masquer les règles ▲' : 'Voir les règles ▼'}
        </button>
        {showRules && (
          <p className="dribble-intro">
            Tes 6 joueurs jaunes sont en cercle, le taureau rouge est au milieu. Tape un coéquipier pour lui passer
            le ballon. Tape le suivant pendant que le ballon roule : le receveur le remet en une touche. Le taureau presse le porteur en fermant une passe et coupe celles qu'il peut atteindre : s'il
            touche le porteur ou intercepte le ballon, c'est fini. Il repère quand tu fais tourner le ballon toujours dans le même sens : varie ! Joue vite, en une touche ! 1 point par passe
            réussie. Toutes les 6 passes le taureau accélère, et à 12 passes un 2e taureau entre. Une passe entre les
            deux taureaux (petit pont) rapporte 2 points de plus.
          </p>
        )}

        <div className="dribble-stat-row">
          <div className="dribble-stat"><b>{points}</b><span>Points</span></div>
          <div className="dribble-stat"><b>{passes}</b><span>Passes</span></div>
          <div className="dribble-stat"><b>{bulls}</b><span>Taureau{bulls > 1 ? 'x' : ''}</span></div>
        </div>

        <div className="dribble-stage freekick-stage onetwo-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="freekick-canvas" onPointerDown={onPointerDown} />
          {phase === 'idle' && (
            <div className="dribble-idle-msg">
              <span style={{ fontSize: 30 }}>🐂</span>
              <p className="dribble-sub">Fais tourner le ballon sans te faire prendre par le taureau. Mode test : score non enregistré.</p>
              <button className="dribble-cta" onClick={startGame}>Commencer</button>
            </div>
          )}
          {phase === 'over' && (
            <div className="dribble-end-msg">
              <span className="dribble-big">{points}</span>
              <p className="dribble-sub">
                point{points > 1 ? 's' : ''} ({passes} passe{passes > 1 ? 's' : ''}).
                {best > 0 && <><br />Ton meilleur : {best}</>}
              </p>
              <button className="dribble-cta" onClick={startGame}>Rejouer</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
