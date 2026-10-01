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
// But = 1 point, 2 points s'il est tiré hors de la surface (les passes ne
// rapportent rien). Chaque but relance une attaque
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
  run: RunKind
  runUntil: number // il change d'idée au bout d'un moment, même sans arriver
  vx: number; vy: number // vitesse mesurée (les défenseurs l'anticipent)
}

// types d'appels des coéquipiers
type RunKind = 'profondeur' | 'decrochage' | 'diagonale' | 'soutien'

interface Defender {
  x: number; y: number
  role: 'mark' | 'press' | 'zone'
  mark: number // index du coéquipier surveillé (réattribué en continu)
  // « personnalité » tirée au hasard : chaque défenseur joue un peu différemment
  antic: number // anticipation de la course de l'attaquant (s)
  gap: number // distance de marquage (m) côté porteur
  speedMul: number
  reactMul: number
}

interface Ball {
  x: number; y: number
  vx: number; vy: number
  target: P
  passedTarget: boolean
  decel: number // freinage une fois la cible dépassée
  shot: boolean
  fromOutside: boolean // frappé hors de la surface (but = 2 points)
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

// ---- hasard (tirage différent à chaque partie : jamais deux fois la même) ----
function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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
  reassignAt: number
}

function newEngine(seed: number): Engine {
  const e: Engine = {
    phase: 'idle', seed, attack: 0, lvl: level(0), rng: mulberry32(seed),
    mates: [], carrier: 0, hold: 0, defs: [], keeperX: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, target: { x: 0, y: 0 }, passedTarget: false, decel: 0, shot: false, fromOutside: false, trail: [] },
    flightT: 0, points: 0, passes: 0, attackPasses: 0, goals: 0, t: 0, msg: null, tap: null, pauseUntil: 0,
    camY: 0, viewH: 520, lastPasser: -1, reassignAt: 0,
  }
  setupAttack(e)
  return e
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

// Nouvel appel d'un coéquipier, selon la position du porteur : profondeur
// (dans le dos de la défense), décrochage (revient vers le ballon), diagonale
// (change de côté) ou soutien (en retrait, pour une passe en arrière). Deux
// coéquipiers ne visent jamais le même endroit.
function pickRun(e: Engine, m: Mate, c: P) {
  const r = e.rng
  const others = e.mates.filter((o) => o !== m)
  for (let tries = 0; tries < 8; tries++) {
    const k = r()
    let tx: number, ty: number, sp: number, run: RunKind
    if (k < 0.34) {
      run = 'profondeur'; tx = m.x + (r() - 0.5) * 10; ty = c.y + 10 + r() * 9; sp = 6.6 + r() * 0.8
      // appel dans le couloir (on écarte le jeu), pas dans l'axe
      if (Math.abs(tx) < 5) tx = (m.x >= 0 ? 1 : -1) * (5 + r() * 7)
    } else if (k < 0.6) {
      run = 'decrochage'; tx = m.x + (c.x - m.x) * (0.3 + r() * 0.3); ty = c.y + 2 + r() * 5; sp = 5.4 + r() * 0.6
      // il revient vers le ballon, mais pas dans les pieds du porteur
      const dc = Math.hypot(tx - c.x, ty - c.y)
      if (dc < 6) { const k2 = 6 / (dc || 1); tx = c.x + (tx - c.x) * k2; ty = c.y + (ty - c.y) * k2 }
    } else if (k < 0.8) {
      const side = m.x > 0 ? -1 : 1
      run = 'diagonale'; tx = side * (3 + r() * 9); ty = Math.max(m.y, c.y) + 3 + r() * 6; sp = 6.2 + r() * 0.8
    } else {
      const side = r() < 0.5 ? -1 : 1
      run = 'soutien'; tx = c.x + side * (5 + r() * 4); ty = c.y - 3 - r() * 4; sp = 4.6 + r() * 0.6
    }
    tx = clamp(tx, -13.5, 13.5)
    ty = clamp(ty, Math.max(-1, c.y - 8), GOAL_Y - 3)
    // espace libre : loin des coéquipiers et des défenseurs
    const crowded = others.some((o) => Math.hypot(o.tx - tx, o.ty - ty) < 6.5 || Math.hypot(o.x - tx, o.y - ty) < 5)
      || e.defs.some((d) => Math.hypot(d.x - tx, d.y - ty) < 3.5)
    if (crowded && tries < 7) continue
    m.tx = tx; m.ty = ty; m.speed = sp; m.run = run
    m.runUntil = e.t + 1.4 + r() * 1.8
    return
  }
}

function setupAttack(e: Engine) {
  e.lvl = level(e.attack)
  e.rng = mulberry32(e.seed + e.attack * 7919)
  const r = e.rng
  const cx = (r() - 0.5) * 8
  const mate = (x: number, y: number, num: number): Mate =>
    ({ x, y, tx: x, ty: y, speed: 6, num, lockUntil: 0, run: 'profondeur', runUntil: 0, vx: 0, vy: 0 })
  e.mates = [
    mate(cx, 2, 10),
    mate(-6 - r() * 6, 4 + r() * 8, 7),
    mate(6 + r() * 6, 4 + r() * 8, 11),
    mate((r() - 0.5) * 10, 12 + r() * 6, 9),
  ]
  e.carrier = 0
  e.hold = 0
  const k = e.attack
  const defs: Defender[] = []
  // jamais plus de 4 défenseurs (le terrain reste aéré) : ensuite, c'est
  // leur vitesse et leurs réflexes qui augmentent
  const markers = k >= 3 ? 2 : Math.min(3, 1 + k)
  const def = (x: number, y: number, role: Defender['role'], mark: number): Defender => ({
    x, y, role, mark,
    antic: 0.15 + r() * 0.5,
    gap: 1.6 + r() * 2.6,
    speedMul: 0.9 + r() * 0.2,
    reactMul: 0.8 + r() * 0.5,
  })
  for (let i = 0; i < markers; i++) {
    const mi = 1 + ((i + (k % 3)) % 3)
    const m = e.mates[mi]
    defs.push(def(m.x * 0.7, m.y + 3, 'mark', mi))
  }
  if (k >= 1) defs.push(def(cx + (cx > 0 ? -1.4 : 1.4), 0.6, 'press', 0))
  if (k >= 3) defs.push(def(0, BOX_Y + 2, 'zone', 0))
  e.reassignAt = 0
  e.defs = defs
  for (let i = 1; i < e.mates.length; i++) pickRun(e, e.mates[i], e.mates[0])
  e.keeperX = 0
  e.ball = { x: cx, y: 2.9, vx: 0, vy: 0, target: { x: cx, y: 2.9 }, passedTarget: false, decel: 0, shot: false, fromOutside: false, trail: [] }
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

// Premier point de la trajectoire du ballon (simulée pas à pas, freinage
// compris) que le défenseur peut atteindre avant lui. null s'il n'y arrive pas.
function interceptPoint(ball: Ball, d: P, speed: number, reach: number): P | null {
  let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy
  let passed = ball.passedTarget
  let decel = ball.decel
  const h = 0.04
  for (let t = h; t <= 1.8; t += h) {
    const v = Math.hypot(vx, vy)
    if (v < 0.3) break
    if (passed) {
      const nv = Math.max(0, v - decel * h)
      vx *= nv / v; vy *= nv / v
    }
    x += vx * h; y += vy * h
    if (!passed && (ball.target.x - x) * vx + (ball.target.y - y) * vy <= 0) {
      passed = true
      decel = (v * v) / (2 * BALL_ROLL)
    }
    if (Math.hypot(x - d.x, y - d.y) - reach <= speed * t) return { x, y }
  }
  return null
}

function goalPoints(fromOutside: boolean) {
  return fromOutside ? 2 : 1
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
  const engineRef = useRef<Engine>(newEngine((Math.random() * 4294967296) >>> 0))
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
    const e = newEngine((Math.random() * 4294967296) >>> 0)
    // tests automatisés : démarrer directement à une attaque avancée
    const startAt = (window as any).__oneTwoStartAttack
    if (startAt) { e.attack = startAt; setupAttack(e) }
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
    const before = e.mates.map((m) => ({ x: m.x, y: m.y }))
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
      if (arrived || e.t >= m.runUntil) pickRun(e, m, carrier ?? ball)
    })

    // les coéquipiers s'écartent les uns des autres (et du porteur) : le jeu
    // reste aéré, sauf pour celui qui va chercher le ballon
    for (let a = 0; a < e.mates.length; a++) for (let b = a + 1; b < e.mates.length; b++) {
      if (a === chaser || b === chaser) continue
      const A = e.mates[a], B = e.mates[b]
      const dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy)
      if (dd > 0.01 && dd < 5) {
        const push = (5 - dd) * 0.08
        if (a !== e.carrier) { A.x -= (dx / dd) * push; A.y -= (dy / dd) * push }
        if (b !== e.carrier) { B.x += (dx / dd) * push; B.y += (dy / dd) * push }
      }
    }
    e.mates.forEach((m) => { m.x = clamp(m.x, -14, 14) })

    // vitesse mesurée des coéquipiers (lissée)
    e.mates.forEach((m, i) => {
      if (dt <= 0) return
      m.vx += ((m.x - before[i].x) / dt - m.vx) * 0.2
      m.vy += ((m.y - before[i].y) / dt - m.vy) * 0.2
    })

    // --- défenseurs ---
    const ballFree = e.carrier < 0
    // répartition du marquage : les attaquants les plus dangereux (les plus
    // avancés, les plus libres) d'abord, chacun pris par le marqueur le plus proche
    if (!ballFree && e.t >= e.reassignAt) {
      e.reassignAt = e.t + 0.45
      const markers = e.defs.filter((d) => d.role === 'mark')
      const threats = e.mates
        .map((m, i) => ({ i, m }))
        .filter(({ i }) => i !== e.carrier)
        .map(({ i, m }) => {
          const near = Math.min(...e.defs.map((d) => Math.hypot(d.x - m.x, d.y - m.y)))
          return { i, m, danger: m.y + Math.min(near, 8) * 1.2 + (m.run === 'profondeur' ? 4 : 0) }
        })
        .sort((a, b) => b.danger - a.danger)
      const free = [...markers]
      for (const t of threats) {
        if (!free.length) break
        let bi = 0
        free.forEach((d, j) => { if (Math.hypot(d.x - t.m.x, d.y - t.m.y) < Math.hypot(free[bi].x - t.m.x, free[bi].y - t.m.y)) bi = j })
        free[bi].mark = t.i
        free.splice(bi, 1)
      }
    }
    const deepest = e.mates.reduce((a, m, i) => (i !== e.carrier && m.y > a.y ? m : a), { x: 0, y: -99 } as P)
    for (const d of e.defs) {
      let goal: P
      const sp = L.defSpeed * d.speedMul
      if (loose && d === defChaser) {
        moveTo(d, Math.hypot(ball.vx, ball.vy) < 2 ? ball : loose, sp * dt)
        continue
      }
      if (ballFree && !ball.shot && d.role !== 'press') {
        // passe partie : il est pris à contre-pied pendant son temps de
        // réaction, puis il calcule s'il peut couper la trajectoire
        const react = L.reaction * d.reactMul
        if (e.flightT < react) continue
        const cut = interceptPoint(ball, d, sp * 0.9, L.interceptR)
        if (cut) { moveTo(d, cut, sp * dt); continue }
        // trop loin : il revient se placer entre le ballon et le but
        moveTo(d, { x: d.x + (ball.x - d.x) * 0.3, y: Math.max(d.y, ball.y + 2) }, sp * 0.6 * dt)
        continue
      }
      if (ballFree && e.flightT < L.reaction * d.reactMul) continue
      const c = carrier ?? ball
      if (d.role === 'mark') {
        const m = e.mates[d.mark === e.carrier ? (d.mark % 3) + 1 : d.mark]
        // il anticipe la course et se place côté ballon et côté but
        const px = m.x + m.vx * d.antic, py = m.y + m.vy * d.antic
        const dx = c.x - px, dy = c.y - py
        const dl = Math.hypot(dx, dy) || 1
        // surtout côté but, un peu côté ballon (sinon tout le monde se
        // resserre autour du porteur)
        const g = Math.min(d.gap * 0.45, dl * 0.3)
        goal = { x: px + (dx / dl) * g, y: py + (dy / dl) * g + 0.6 + d.gap * 0.45 }
        // attaquant parti dans son dos : course de repli à fond
        const behind = m.y > d.y + 1.5
        moveTo(d, behind ? { x: px, y: py + 1 } : goal, sp * (behind ? 1.08 : 1) * dt)
        continue
      } else if (d.role === 'press') {
        // il colle le porteur dans son dos (côté du centre), de plus en plus
        // près à mesure que le porteur garde le ballon
        const side = c.x > 0 ? -1 : 1
        const close = 1 - Math.min(1, e.hold / L.holdTime) * 0.5
        goal = { x: c.x + side * 1.4 * close, y: c.y - 1.2 * close }
      } else {
        // couverture : entre le porteur et le but, au niveau de l'attaquant
        // le plus avancé (personne dans son dos)
        goal = {
          x: clamp((c.x + deepest.x) * 0.3, -8, 8),
          y: clamp(Math.max(c.y + 6, deepest.y + 1.5), 10, BOX_Y + 3),
        }
      }
      moveTo(d, goal, sp * dt)
    }
    // les défenseurs ne s'empilent pas
    for (let a = 0; a < e.defs.length; a++) for (let b = a + 1; b < e.defs.length; b++) {
      const A = e.defs[a], B = e.defs[b]
      const dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy)
      if (dd > 0.01 && dd < 3) {
        const push = (3 - dd) * 0.25
        A.x -= (dx / dd) * push; A.y -= (dy / dd) * push
        B.x += (dx / dd) * push; B.y += (dy / dd) * push
      }
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
          const pts = goalPoints(ball.fromOutside)
          e.points += pts
          e.phase = 'goal'
          e.pauseUntil = e.t + 1.6
          say(e, ball.fromOutside ? 'GOLAZO !' : 'BUT !', ball.fromOutside ? '+2 points (hors de la surface)' : '+1 point', '#E8B931')
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
          p.speed = 6.8
          p.run = 'profondeur'
          p.runUntil = e.t + 2.5
        }
        // les autres relisent le jeu autour du nouveau porteur
        e.mates.forEach((o, j) => { if (j !== i && j !== e.lastPasser) pickRun(e, o, m) })
        e.reassignAt = 0
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
    e.ball.fromOutside = !(e.ball.y >= BOX_Y && Math.abs(e.ball.x) <= BOX_HALF_W)
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
            autour du porteur, c'est ton temps ballon au pied avant d'être taclé. Tape dans le but pour frapper (de loin, le gardien a le temps de se placer : rapproche-toi). Un but vaut 1 point, 2 points s'il est tiré hors de la surface ; les passes ne rapportent rien. Chaque but relance une attaque plus dure. Au premier
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
