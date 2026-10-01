import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// ============================================================================
// Une-deux — PROTOTYPE de mini-jeu (visible par l'administrateur seulement,
// score non enregistré).
//
// Vue de dessus, on attaque vers le haut. Tes coéquipiers (jaunes) courent ;
// tu tapes l'endroit où tu veux envoyer le ballon : il part en ligne droite
// vers ce point. Un coéquipier qui passe près du ballon le contrôle. Les
// défenseurs (rouges) coupent les lignes de passe : il faut viser DEVANT le
// coéquipier, dans l'espace. Tu n'as que quelques secondes ballon au pied
// avant d'être taclé. Arrivé dans la surface, tape dans le but pour frapper.
// But = 10 points moins 1 par passe de l'action (minimum 2) : on construit
// vite plutôt que de faire tourner le ballon. Chaque but relance une attaque
// plus difficile ; la partie s'arrête au premier ballon perdu.
// ============================================================================

interface Props {
  onExit: () => void
}

// ---- terrain (mètres) : x ∈ [-15, 15], on attaque vers y = GOAL_Y ----
// (terrain resserré par rapport au vrai : les joueurs restent lisibles sur
// un téléphone)
const HALF_W = 15
const GOAL_Y = 48
const BOX_Y = GOAL_Y - 14
const SIX_Y = GOAL_Y - 5
const BOX_HALF_W = 12
const SIX_HALF_W = 6
const GOAL_HALF_W = 3.66
const LW = 360 // largeur logique de l'écran
const SCALE = LW / 32 // px logiques par mètre (1 m de marge de chaque côté)

const BALL_V = 17 // vitesse de passe (m/s)
const SHOT_V = 24
const BALL_ROLL = 2.5 // le ballon s'arrête ~2,5 m après l'endroit visé
const RECEIVE_R = 1.3
const PLAYER_R = 0.85

type P = { x: number; y: number }

interface Mate {
  x: number; y: number
  tx: number; ty: number // point vers lequel il court
  speed: number
  num: number
  lockUntil: number // le passeur ne peut pas récupérer sa propre passe tout de suite
}

interface Defender {
  x: number; y: number
  role: 'mark' | 'press' | 'zone'
  mark: number // index du coéquipier surveillé
  lane: number // position sur la ligne de passe (0 = porteur, 1 = coéquipier)
}

interface Ball {
  x: number; y: number
  vx: number; vy: number
  target: P
  passedTarget: boolean
  decel: number // freinage une fois la cible dépassée
  shot: boolean
  trail: P[]
}

interface Level {
  defSpeed: number
  holdTime: number
  interceptR: number
  keeperSpeed: number
  reaction: number
}

function level(k: number): Level {
  return {
    defSpeed: Math.min(6.4, 4.1 + k * 0.32),
    holdTime: Math.max(1.7, 3.2 - k * 0.2),
    interceptR: Math.min(1.15, 0.8 + k * 0.05),
    keeperSpeed: Math.min(6.5, 3.6 + k * 0.4),
    reaction: Math.max(0.15, 0.32 - k * 0.025),
  }
}

// ---- hasard déterministe (même série pour tout le monde la même semaine) ----
function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function monday(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff)).toISOString().slice(0, 10)
}

type Phase = 'idle' | 'play' | 'goal' | 'lost' | 'over'

interface Engine {
  phase: Phase
  seed: number
  attack: number
  lvl: Level
  rng: () => number
  mates: Mate[]
  carrier: number // index du porteur, -1 si ballon en l'air
  hold: number // temps ballon au pied
  defs: Defender[]
  keeperX: number
  ball: Ball
  flightT: number
  points: number
  passes: number
  attackPasses: number // passes de l'attaque en cours
  goals: number
  t: number
  msg: { text: string; sub: string; color: string; at: number } | null
  tap: { p: P; at: number } | null
  pauseUntil: number
  camY: number
  viewH: number // hauteur visible (en unités logiques)
  lastPasser: number
}

function newEngine(seed: number): Engine {
  const e: Engine = {
    phase: 'idle', seed, attack: 0, lvl: level(0), rng: mulberry32(seed),
    mates: [], carrier: 0, hold: 0, defs: [], keeperX: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, target: { x: 0, y: 0 }, passedTarget: false, decel: 0, shot: false, trail: [] },
    flightT: 0, points: 0, passes: 0, attackPasses: 0, goals: 0, t: 0, msg: null, tap: null, pauseUntil: 0,
    camY: 0, viewH: 520, lastPasser: -1,
  }
  setupAttack(e)
  return e
}

function pickRun(e: Engine, m: Mate, fromCarrier: P) {
  const r = e.rng
  // course vers l'avant, à hauteur ou devant le porteur, jamais collée à la touche
  const ahead = 4 + r() * 14
  m.tx = Math.max(-13, Math.min(13, m.x + (r() - 0.5) * 18))
  m.ty = Math.min(GOAL_Y - 3, Math.max(fromCarrier.y - 2, m.y) + ahead * 0.6)
}

function setupAttack(e: Engine) {
  e.lvl = level(e.attack)
  e.rng = mulberry32(e.seed + e.attack * 7919)
  const r = e.rng
  const cx = (r() - 0.5) * 8
  e.mates = [
    { x: cx, y: 2, tx: cx, ty: 6, speed: 2.4, num: 10, lockUntil: 0 },
    { x: -8 - r() * 4, y: 6 + r() * 5, tx: 0, ty: 0, speed: 6 + r(), num: 7, lockUntil: 0 },
    { x: 8 + r() * 4, y: 6 + r() * 5, tx: 0, ty: 0, speed: 6 + r(), num: 11, lockUntil: 0 },
    { x: (r() - 0.5) * 8, y: 14 + r() * 4, tx: 0, ty: 0, speed: 5.6 + r(), num: 9, lockUntil: 0 },
  ]
  e.carrier = 0
  e.hold = 0
  for (let i = 1; i < e.mates.length; i++) pickRun(e, e.mates[i], e.mates[0])
  const k = e.attack
  const defs: Defender[] = []
  const markers = Math.min(3, 1 + k)
  for (let i = 0; i < markers; i++) {
    const mi = 1 + ((i + (k % 3)) % 3)
    const m = e.mates[mi]
    defs.push({ x: m.x * 0.7, y: m.y + 3, role: 'mark', mark: mi, lane: 0.55 + r() * 0.2 })
  }
  if (k >= 1) defs.push({ x: cx + (cx > 0 ? -1.4 : 1.4), y: 0.6, role: 'press', mark: 0, lane: 0 })
  if (k >= 3) defs.push({ x: 0, y: BOX_Y + 2, role: 'zone', mark: 0, lane: 0 })
  if (k >= 5) defs.push({ x: (r() - 0.5) * 16, y: 26, role: 'zone', mark: 0, lane: 0 })
  e.defs = defs
  e.keeperX = 0
  e.ball = { x: cx, y: 2.9, vx: 0, vy: 0, target: { x: cx, y: 2.9 }, passedTarget: false, decel: 0, shot: false, trail: [] }
  e.camY = 0
  e.lastPasser = -1
  e.attackPasses = 0
}

// distance d'un point au segment [a, b]
function segDist(p: P, a: P, b: P) {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function goalPoints(passes: number) {
  return Math.max(2, 10 - passes)
}

function moveTo(o: P, t: P, maxStep: number) {
  const dx = t.x - o.x, dy = t.y - o.y
  const d = Math.hypot(dx, dy)
  if (d <= maxStep || d < 1e-6) { o.x = t.x; o.y = t.y; return true }
  o.x += (dx / d) * maxStep
  o.y += (dy / d) * maxStep
  return false
}

export default function OneTwoGame({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Engine>(newEngine(hashString('une-deux:' + monday())))
  const [phase, setPhase] = useState<Phase>('idle')
  const [points, setPoints] = useState(0)
  const [passes, setPasses] = useState(0)
  const [goals, setGoals] = useState(0)
  const [showRules, setShowRules] = useState(false)
  const [best, setBest] = useState(0)

  const sync = () => {
    const e = engineRef.current
    setPoints(e.points); setPasses(e.passes); setGoals(e.goals)
  }

  const startGame = () => {
    const e = newEngine(hashString('une-deux:' + monday()))
    e.phase = 'play'
    e.msg = { text: 'À toi !', sub: 'Tape devant un coéquipier jaune', color: '#F4EFE2', at: 0 }
    engineRef.current = e
    setPhase('play')
    sync()
  }

  const say = (e: Engine, text: string, sub: string, color: string) => {
    e.msg = { text, sub, color, at: e.t }
  }

  const loseBall = (e: Engine, text: string, sub: string) => {
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
    if (e.phase === 'idle' || e.phase === 'over') return
    if (e.phase === 'lost' || e.phase === 'goal') {
      if (e.t >= e.pauseUntil) {
        if (e.phase === 'lost') {
          e.phase = 'over'
          setBest((b) => Math.max(b, e.points))
          setPhase('over')
        } else {
          e.attack += 1
          setupAttack(e)
          e.phase = 'play'
          say(e, `Attaque ${e.attack + 1}`, 'Ça se corse…', '#F4EFE2')
        }
      }
      if (e.phase === 'goal') return
    }
    const L = e.lvl
    const ball = e.ball
    const carrier = e.carrier >= 0 ? e.mates[e.carrier] : null

    // ballon qui roule librement (cible dépassée) : le coéquipier et le
    // défenseur les plus proches de l'endroit où il va s'arrêter foncent dessus
    let loose: P | null = null
    let chaser = -1
    let defChaser: Defender | null = null
    if (e.carrier < 0 && !ball.shot && ball.passedTarget) {
      const v = Math.hypot(ball.vx, ball.vy)
      const roll = v > 0.01 ? (v * v) / (2 * (ball.decel || 1)) : 0
      loose = { x: ball.x + (v > 0.01 ? (ball.vx / v) * roll : 0), y: ball.y + (v > 0.01 ? (ball.vy / v) * roll : 0) }
      let best = Infinity
      e.mates.forEach((m, i) => {
        const d = Math.hypot(m.x - loose!.x, m.y - loose!.y)
        if (e.t >= m.lockUntil && d < best) { best = d; chaser = i }
      })
      best = Infinity
      for (const d of e.defs) {
        const dd = Math.hypot(d.x - loose.x, d.y - loose.y)
        if (dd < best) { best = dd; defChaser = d }
      }
    }

    // --- coéquipiers ---
    e.mates.forEach((m, i) => {
      if (loose && i === chaser) {
        moveTo(m, Math.hypot(ball.vx, ball.vy) < 2 ? ball : loose, m.speed * dt)
        return
      }
      if (i === e.carrier) {
        // le porteur avance doucement vers le but
        m.y = Math.min(GOAL_Y - 6, m.y + 2.4 * dt)
        return
      }
      // ballon passé à sa portée : il ajuste sa course pour aller le chercher
      if (e.carrier < 0 && !ball.shot && e.t >= m.lockUntil) {
        const v = Math.hypot(ball.vx, ball.vy)
        if (v > 0.5) {
          const ux = ball.vx / v, uy = ball.vy / v
          const along = (m.x - ball.x) * ux + (m.y - ball.y) * uy
          if (along > -0.5) {
            const px = ball.x + ux * along, py = ball.y + uy * along
            if (Math.hypot(m.x - px, m.y - py) < 4) { moveTo(m, { x: px, y: py }, m.speed * dt); return }
          }
        }
      }
      const arrived = moveTo(m, { x: m.tx, y: m.ty }, m.speed * dt)
      if (arrived) pickRun(e, m, carrier ?? ball)
    })

    // --- défenseurs ---
    const ballFree = e.carrier < 0
    for (const d of e.defs) {
      let goal: P
      const sp = L.defSpeed
      if (loose && d === defChaser) {
        moveTo(d, Math.hypot(ball.vx, ball.vy) < 2 ? ball : loose, sp * dt)
        continue
      }
      if (ballFree && e.flightT > L.reaction && d.role !== 'press') {
        // en l'air : il se jette vers la trajectoire du ballon
        const v = Math.hypot(ball.vx, ball.vy) || 1
        const ux = ball.vx / v, uy = ball.vy / v
        const along = Math.max(0, (d.x - ball.x) * ux + (d.y - ball.y) * uy)
        goal = { x: ball.x + ux * along, y: ball.y + uy * along }
        moveTo(d, goal, sp * 0.85 * dt)
        continue
      }
      // passe partie, temps de réaction pas écoulé : il est pris à contre-pied
      if (ballFree) continue
      const c = carrier ?? ball
      if (d.role === 'mark') {
        const m = e.mates[d.mark === e.carrier ? (d.mark % 3) + 1 : d.mark]
        goal = { x: c.x + (m.x - c.x) * d.lane, y: c.y + (m.y - c.y) * d.lane + 1 }
      } else if (d.role === 'press') {
        // il colle le porteur dans son dos (côté du centre) : il met la
        // pression sans boucher les passes vers l'avant
        const side = c.x > 0 ? -1 : 1
        goal = { x: c.x + side * 1.4, y: c.y - 1.2 }
      } else {
        goal = { x: c.x * 0.5, y: Math.max(c.y + 7, d.y > BOX_Y - 4 ? BOX_Y + 1 : 26) }
      }
      moveTo(d, goal, sp * dt)
    }

    // --- gardien : suit le ballon sur sa ligne ---
    {
      const aim = ball.shot && e.flightT > L.reaction ? ball.target.x : ball.x * 0.35
      const kx = Math.max(-GOAL_HALF_W + 0.4, Math.min(GOAL_HALF_W - 0.4, aim))
      const p = { x: e.keeperX, y: 0 }
      moveTo(p, { x: kx, y: 0 }, L.keeperSpeed * dt)
      e.keeperX = p.x
    }

    if (e.phase !== 'play') return

    // --- porteur : chrono ---
    if (carrier) {
      e.hold += dt
      ball.x = carrier.x
      ball.y = carrier.y + 0.9
      if (e.hold >= L.holdTime) {
        loseBall(e, 'Taclé !', 'Trop long ballon au pied')
        return
      }
      return
    }

    // --- ballon en l'air ---
    e.flightT += dt
    const prev = { x: ball.x, y: ball.y }
    if (ball.passedTarget || ball.shot) {
      const v = Math.hypot(ball.vx, ball.vy)
      if (!ball.shot) {
        const nv = Math.max(0, v - ball.decel * dt)
        if (v > 0) { ball.vx *= nv / v; ball.vy *= nv / v }
      }
    }
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    if (!ball.passedTarget && (ball.target.x - ball.x) * ball.vx + (ball.target.y - ball.y) * ball.vy <= 0) {
      ball.passedTarget = true
      const v = Math.hypot(ball.vx, ball.vy)
      ball.decel = (v * v) / (2 * BALL_ROLL)
    }
    ball.trail.push({ x: ball.x, y: ball.y })
    if (ball.trail.length > 14) ball.trail.shift()

    // interception (testée le long du déplacement, pas seulement à la fin)
    for (const d of e.defs) {
      if (segDist(d, prev, ball) < (d.role === 'press' ? 0.6 : L.interceptR)) {
        loseBall(e, 'Intercepté !', ball.shot ? 'Frappe contrée' : 'Vise plus loin devant ton coéquipier')
        return
      }
    }

    // un ballon qui arrive dans le but (même sur une passe) est une frappe
    if (!ball.shot && ball.y >= GOAL_Y - 0.6 && Math.abs(ball.x) <= GOAL_HALF_W + 0.5) {
      ball.shot = true
      ball.target = { x: ball.x, y: GOAL_Y }
    }
    if (ball.shot) {
      if (ball.y >= GOAL_Y - 0.6 && prev.y < GOAL_Y - 0.6) {
        const xAtLine = ball.x
        if (Math.abs(xAtLine - e.keeperX) < 1.0) { loseBall(e, 'Arrêt du gardien !', 'Vise un côté'); return }
      }
      if (ball.y >= GOAL_Y) {
        if (Math.abs(ball.x) <= GOAL_HALF_W - 0.1) {
          e.goals += 1
          const pts = goalPoints(e.attackPasses)
          e.points += pts
          e.phase = 'goal'
          e.pauseUntil = e.t + 1.6
          say(e, 'BUT !', `+${pts} points (${e.attackPasses} passe${e.attackPasses > 1 ? 's' : ''})`, '#E8B931')
          if (navigator.vibrate) try { navigator.vibrate([40, 40, 80]) } catch { /* rien */ }
          sync()
        } else {
          loseBall(e, 'À côté !', 'Le but fait 7,32 m de large')
        }
      }
      return
    }

    // réception
    for (let i = 0; i < e.mates.length; i++) {
      const m = e.mates[i]
      if (e.t < m.lockUntil) continue
      if (segDist(m, prev, ball) < RECEIVE_R) {
        e.carrier = i
        e.hold = 0
        e.passes += 1
        e.attackPasses += 1
        // une-deux : le passeur file vers l'avant pour se proposer
        if (e.lastPasser >= 0) {
          const p = e.mates[e.lastPasser]
          p.tx = Math.max(-13, Math.min(13, p.x + (m.x > p.x ? 4 : -4)))
          p.ty = Math.min(GOAL_Y - 3, m.y + 9)
        }
        if (m.y >= BOX_Y - 2) say(e, 'Dans la surface !', 'Tape dans le but pour frapper', '#E8B931')
        sync()
        return
      }
    }

    const v = Math.hypot(ball.vx, ball.vy)
    if (Math.abs(ball.x) > HALF_W || ball.y < -3 || ball.y > GOAL_Y) { loseBall(e, 'Sortie !', 'Le ballon est sorti'); return }
    if (v < 0.4 && e.flightT > 6) loseBall(e, 'Ballon perdu', 'Personne n\'était là pour le prendre')
  }

  // ---------------------------------------------------------- dessin -----
  const draw = (ctx: CanvasRenderingContext2D) => {
    const e = engineRef.current
    const H = e.viewH
    // caméra : le ballon aux 2/3 bas de l'écran, sans dépasser le but
    const wantBottom = Math.min(e.ball.y - (H / SCALE) * 0.3, GOAL_Y + 3 - H / SCALE)
    e.camY += (Math.max(-2, wantBottom) - e.camY) * 0.08
    const X = (x: number) => LW / 2 + x * SCALE
    const Y = (y: number) => H - (y - e.camY) * SCALE

    // pelouse à bandes
    ctx.fillStyle = '#1d6b45'
    ctx.fillRect(0, 0, LW, H)
    for (let s = Math.floor(e.camY / 5) * 5; s < e.camY + H / SCALE + 5; s += 5) {
      if (((s / 5) | 0) % 2 === 0) {
        ctx.fillStyle = '#227a4f'
        ctx.fillRect(0, Y(s + 5), LW, 5 * SCALE)
      }
    }
    // lignes
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 1.6
    ctx.strokeRect(X(-HALF_W), Y(GOAL_Y), HALF_W * 2 * SCALE, (GOAL_Y + 30) * SCALE)
    ctx.strokeRect(X(-BOX_HALF_W), Y(GOAL_Y), BOX_HALF_W * 2 * SCALE, (GOAL_Y - BOX_Y) * SCALE)
    ctx.strokeRect(X(-SIX_HALF_W), Y(GOAL_Y), SIX_HALF_W * 2 * SCALE, (GOAL_Y - SIX_Y) * SCALE)
    ctx.beginPath(); ctx.arc(X(0), Y(GOAL_Y - 11), 6 * SCALE, 0.22 * Math.PI, 0.78 * Math.PI); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath(); ctx.arc(X(0), Y(GOAL_Y - 11), 2, 0, Math.PI * 2); ctx.fill()
    // rond central (bas du terrain)
    ctx.beginPath(); ctx.arc(X(0), Y(-3), 7 * SCALE, 1.1 * Math.PI, 1.9 * Math.PI); ctx.stroke()
    // but + filet
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(X(-GOAL_HALF_W), Y(GOAL_Y + 2), GOAL_HALF_W * 2 * SCALE, 2 * SCALE)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 0.7
    for (let gx = -GOAL_HALF_W; gx <= GOAL_HALF_W + 0.01; gx += 0.6) {
      ctx.beginPath(); ctx.moveTo(X(gx), Y(GOAL_Y)); ctx.lineTo(X(gx), Y(GOAL_Y + 2)); ctx.stroke()
    }
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(X(-GOAL_HALF_W), Y(GOAL_Y)); ctx.lineTo(X(-GOAL_HALF_W), Y(GOAL_Y + 2))
    ctx.lineTo(X(GOAL_HALF_W), Y(GOAL_Y + 2)); ctx.lineTo(X(GOAL_HALF_W), Y(GOAL_Y))
    ctx.stroke()

    const r = PLAYER_R * SCALE
    const disc = (x: number, y: number, fill: string, ring?: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath(); ctx.ellipse(X(x) + 2, Y(y) + 3, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = fill
      ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = ring ?? 'rgba(0,0,0,0.35)'
      ctx.lineWidth = ring ? 2.4 : 1
      ctx.stroke()
    }

    // gardien
    disc(e.keeperX, GOAL_Y - 0.6, '#3FA7D6')

    // coéquipiers : flèche de course pour anticiper la passe
    e.mates.forEach((m, i) => {
      if (i !== e.carrier && e.phase === 'play') {
        const dx = m.tx - m.x, dy = m.ty - m.y
        const d = Math.hypot(dx, dy)
        if (d > 0.5) {
          const len = Math.min(d, m.speed * 0.7)
          const ex = m.x + (dx / d) * len, ey = m.y + (dy / d) * len
          ctx.strokeStyle = 'rgba(232,185,49,0.55)'
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.beginPath(); ctx.moveTo(X(m.x), Y(m.y)); ctx.lineTo(X(ex), Y(ey)); ctx.stroke()
          ctx.setLineDash([])
        }
      }
      disc(m.x, m.y, '#E8B931', i === e.carrier ? '#fff' : undefined)
      ctx.fillStyle = '#1B1B1F'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(m.num), X(m.x), Y(m.y) + 0.5)
    })

    // défenseurs
    for (const d of e.defs) disc(d.x, d.y, '#C8443C')

    // chrono du porteur
    if (e.carrier >= 0 && e.phase === 'play') {
      const m = e.mates[e.carrier]
      const left = Math.max(0, 1 - e.hold / e.lvl.holdTime)
      ctx.strokeStyle = left > 0.35 ? 'rgba(255,255,255,0.9)' : '#E8705F'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(X(m.x), Y(m.y), r + 5, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2)
      ctx.stroke()
    }

    // ballon + traînée
    const b = e.ball
    b.trail.forEach((p, i) => {
      ctx.fillStyle = `rgba(255,255,255,${(i / b.trail.length) * 0.35})`
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.2, 0, Math.PI * 2); ctx.fill()
    })
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.arc(X(b.x) + 1.5, Y(b.y) + 2, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), 4, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1B1B1F'
    ctx.lineWidth = 0.8
    ctx.stroke()

    // repère du dernier tap
    if (e.tap && e.t - e.tap.at < 0.5) {
      const a = 1 - (e.t - e.tap.at) / 0.5
      ctx.strokeStyle = `rgba(255,255,255,${a})`
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(X(e.tap.p.x), Y(e.tap.p.y), 6 + (1 - a) * 10, 0, Math.PI * 2); ctx.stroke()
    }

    // message
    if (e.msg && e.t - e.msg.at < 1.6) {
      const a = Math.min(1, (1.6 - (e.t - e.msg.at)) / 0.4)
      ctx.globalAlpha = a
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(12,44,34,0.75)'
      ctx.fillRect(LW / 2 - 130, H * 0.36 - 30, 260, 58)
      ctx.fillStyle = e.msg.color
      ctx.font = 'bold 24px Oswald, sans-serif'
      ctx.fillText(e.msg.text, LW / 2, H * 0.36 - 8)
      ctx.fillStyle = '#F4EFE2'
      ctx.font = '12px sans-serif'
      ctx.fillText(e.msg.sub, LW / 2, H * 0.36 + 15)
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
      // petits pas : un ballon rapide ne « traverse » pas un joueur
      for (let i = 0; i < 3; i++) step(dt / 3)
      // l'écran suit la nouvelle attaque même si engineRef a changé
      if (engineRef.current.viewH !== (canvas.height / canvas.width) * LW) {
        engineRef.current.viewH = (canvas.height / canvas.width) * LW
      }
      draw(ctx)
      canvas.dataset.phase = engineRef.current.phase
      // état lisible par les tests automatisés (bot), seulement s'ils le demandent
      if ((window as any).__oneTwoDebug) (window as any).__oneTwo = engineRef.current
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ tap ------
  const onPointerDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const e = engineRef.current
    if (e.phase !== 'play' || e.carrier < 0) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const lx = ((ev.clientX - rect.left) / rect.width) * LW
    const ly = ((ev.clientY - rect.top) / rect.width) * LW
    const p = { x: (lx - LW / 2) / SCALE, y: e.camY + (e.viewH - ly) / SCALE }
    const from = e.mates[e.carrier]
    const dx = p.x - e.ball.x, dy = p.y - e.ball.y
    const d = Math.hypot(dx, dy)
    if (d < 1.5) return
    e.tap = { p, at: e.t }
    // frappe : depuis la surface (tap dans les 6 m), ou de n'importe où en
    // tapant dans le but (de loin, le gardien a le temps de se placer)
    const inGoal = p.y >= GOAL_Y - 2.5 && Math.abs(p.x) <= GOAL_HALF_W + 1.5
    const shot = inGoal || (from.y >= BOX_Y - 2 && p.y >= SIX_Y - 1)
    let target = p
    if (shot) {
      // frappe : vers la ligne de but, à l'endroit visé
      const k = (GOAL_Y - e.ball.y) / Math.max(0.5, dy)
      target = { x: e.ball.x + dx * k, y: GOAL_Y }
    }
    const tx = target.x - e.ball.x, ty = target.y - e.ball.y
    const td = Math.hypot(tx, ty) || 1
    const v = shot ? SHOT_V : BALL_V
    e.ball.vx = (tx / td) * v
    e.ball.vy = (ty / td) * v
    e.ball.target = target
    e.ball.passedTarget = false
    e.ball.shot = shot
    e.ball.trail = []
    from.lockUntil = e.t + 0.35
    from.speed = Math.max(from.speed, 6.2)
    e.lastPasser = e.carrier
    e.carrier = -1
    e.flightT = 0
  }

  return (
    <div className="predictions-screen dribble-page">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Profil</button>
        <h2>🧪 Une-deux (test)</h2>
      </div>

      <div className="dribble-app">
        <button type="button" className="dribble-rules-toggle" onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Masquer les règles ▲' : 'Voir les règles ▼'}
        </button>
        {showRules && (
          <p className="dribble-intro">
            Tu attaques vers le haut. Tape l'endroit où tu veux envoyer le ballon : il part droit vers ce point.
            Un coéquipier jaune qui passe près du ballon le contrôle (les pointillés montrent où il court). Les
            défenseurs rouges coupent les lignes de passe : vise devant ton coéquipier, dans l'espace. Le cercle
            autour du porteur, c'est ton temps ballon au pied avant d'être taclé. Tape dans le but pour frapper (de loin, le gardien a le temps de se placer : rapproche-toi). Un but vaut 10 points moins 1 par passe de l'action (minimum 2) : construis vite ! Chaque but relance une attaque plus dure. Au premier
            ballon perdu, c'est fini.
          </p>
        )}

        <div className="dribble-stat-row">
          <div className="dribble-stat"><b>{points}</b><span>Points</span></div>
          <div className="dribble-stat"><b>{passes}</b><span>Passes</span></div>
          <div className="dribble-stat"><b>{goals}</b><span>Buts</span></div>
        </div>

        <div className="dribble-stage freekick-stage onetwo-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="freekick-canvas" onPointerDown={onPointerDown} />
          {phase === 'idle' && (
            <div className="dribble-idle-msg">
              <span style={{ fontSize: 30 }}>⚡</span>
              <p className="dribble-sub">Tape devant tes coéquipiers pour enchaîner les passes jusqu'au but. Mode test : score non enregistré.</p>
              <button className="dribble-cta" onClick={startGame}>Commencer</button>
            </div>
          )}
          {phase === 'over' && (
            <div className="dribble-end-msg">
              <span className="dribble-big">{points}</span>
              <p className="dribble-sub">
                points ({passes} passe{passes > 1 ? 's' : ''}, {goals} but{goals > 1 ? 's' : ''}).
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
