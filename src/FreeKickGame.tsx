import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from './supabaseClient'
import { previousGameWeek } from './minigameWeeks'
import { useAuth } from './AuthContext'
import { useWizzChannel } from './wizzChannel'
import plateSrc from './assets/freekick/fk_plate.jpg'
import wallSrc from './assets/freekick/fk_wall.png'
import keeperSrc from './assets/freekick/fk_keeper_anim.png'
import ballSrc from './assets/freekick/fk_ball.png'
import shooterSrc from './assets/freekick/fk_shooter_anim.png'

// ============================================================================
// Coup franc — mini-jeu hebdomadaire.
// Le décor est l'image de référence telle quelle (941 × 1672 px) : bandeau,
// stade, but, mur, tireur, et en bas le « Comment jouer ? » avec le gros
// ballon et le bouton TIRER. Le moteur est posé dessus :
//   1. on touche le gros ballon à l'endroit voulu = l'effet
//      (centre = droit, gauche = effet vers la droite, droite = effet vers la
//      gauche, bas + côté = enroulée, dessous = plus de hauteur) ;
//   2. on swipe vers le haut = puissance (court = doux, long / rapide = fort)
//      et direction ;
//   3. TIRER.
// 3 essais (un raté = un cœur en moins), combo quand on enchaîne les buts,
// et la distance augmente à chaque but (le gardien est de plus en plus vif).
// ============================================================================

interface Props {
  groupId: string
  groupName: string
  autoApplyAllLeagues: boolean
  onExit: () => void
}

interface BestScore { pseudo: string; score: number }
interface ScoreRow { profile_id: string; score: number; pseudo: string }

type Vec3 = { x: number; y: number; z: number }

// ---- constantes physiques (mètres, secondes) ----
const G = 9.81
const BALL_R = 0.11
const GOAL_HALF_W = 3.66
const GOAL_H = 2.44
const POST_R = 0.06
const WALL_DIST = 9.15
const WALL_PLAYER_HALF_W = 0.25
const WALL_HEIGHT = 1.9
const KEEPER_LINE_OFFSET = 0.3
const MAX_SCORE = 100000
const LIVES = 3
const BALL_X = -3 // position du ballon sur l'image d'origine (référence de l'affichage)
// positions de coup franc (m, 0 = face au but) : on en tire une au hasard à chaque tir
const SPOTS = [-4, -2.5, -1, 0.5, 2]
const SPOT_PX = 55   // décalage à l'écran du ballon et du tireur par mètre
const WALL_PX = 62   // décalage à l'écran du mur par mètre

// ---- l'image de référence (coordonnées en px de l'image) ----
const IW = 941, IH = 1672
const IMG = {
  ball: { x: 300, y: 870 },          // point de coup franc (au pied droit du tireur)
  wall: { x: 475, y: 616 },          // pieds du mur (centre)
  goal: { x: 637, y: 532 },          // milieu de la ligne de but
  bigBall: { x: 472, y: 1255, r: 172 }, // gros ballon du « Comment jouer ? »
  aimFrom: { x: 472, y: 1000 },      // pied de la flèche « Swipe = puissance »
}
const SX = [125, 109, 58.7]  // px par mètre (latéral) : ballon, mur, but
const SY = [100, 88, 63.5]   // px par mètre (hauteur)
const WALL_SPR = { cx: 124, feet: 188 } // découpe du mur (248 × 194) : milieu et pieds
// gardien animé (vidéo fond vert) : en place, pas chassé, appel, envol, plongeon (vers la droite ; miroir à gauche)
const KF_W = 322, KF_H = 265
// tireur animé (vidéo fond vert) : 9 images — debout, élan (1-4), frappe (5), accompagnement (6-8)
const SH_W = 345, SH_H = 510, SH_BALL = { x: 277.2, y: 465.2 }, SH_SCALE = 1.06
const ARROW_MAX = 420 // longueur (px d'image) de la flèche à 100 % de puissance
const RUN_UP = 0.6 // s entre TIRER et la frappe
const KF_SCALE = 107 / 211 // la pose « en place » fait 211 px sur la planche, 107 px sur l'image
// zones cliquables de l'image
const ZONE = {
  back: { x0: 22, y0: 18, x1: 104, y1: 90 },
  help: { x0: 836, y0: 18, x1: 918, y1: 90 },
  shoot: { x0: 236, y0: 1540, x1: 706, y1: 1645 },
}
const inZone = (z: { x0: number; y0: number; x1: number; y1: number }, p: { x: number; y: number }) =>
  p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1

function monday(): string {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- paliers : la distance augmente avec les buts, le gardien devient plus vif ----
const STAGES = [
  { from: 0, dMin: 17, dMax: 18, kSpeed: 2.0, kReact: 0.42, reach: 0.85 },
  { from: 3, dMin: 19, dMax: 21, kSpeed: 2.5, kReact: 0.36, reach: 0.9 },
  { from: 7, dMin: 22, dMax: 24, kSpeed: 3.0, kReact: 0.32, reach: 0.95 },
  { from: 11, dMin: 25, dMax: 27, kSpeed: 3.4, kReact: 0.29, reach: 1.0 },
  { from: 15, dMin: 28, dMax: 32, kSpeed: 3.8, kReact: 0.26, reach: 1.05 },
]
const stageOf = (goals: number) => { let k = 0; STAGES.forEach((st, i) => { if (goals >= st.from) k = i }); return k + 1 }

interface ShotConfig { dist: number; ballX: number; keeperSpeed: number; keeperReaction: number; keeperReach: number }
function shotConfig(seed: number, n: number): ShotConfig {
  const lv = stageOf(n)
  const st = STAGES[lv - 1], next = STAGES[lv]
  const r = mulberry32(seed + n * 7919)
  const span = next ? next.from - st.from : 16
  const u = Math.min(1, (n - st.from) / Math.max(1, span - 1))
  const dist = Math.max(st.dMin, Math.min(st.dMax, st.dMin + u * (st.dMax - st.dMin) + (r() - 0.5) * 0.6))
  // position au hasard, jamais deux fois la même d'affilée
  const prev = n > 0 ? Math.floor(mulberry32(seed + (n - 1) * 7919 + 1)() * SPOTS.length) : -1
  let i = Math.floor(mulberry32(seed + n * 7919 + 1)() * SPOTS.length)
  if (i === prev) i = (i + 1 + Math.floor(r() * (SPOTS.length - 1))) % SPOTS.length
  return { dist, ballX: SPOTS[i], keeperSpeed: st.kSpeed, keeperReaction: st.kReact, keeperReach: st.reach }
}

// ---- géométrie ----
interface Scene {
  cfg: ShotConfig
  ball0: Vec3
  hc: { x: number; z: number } // direction ballon -> poteau couvert par le mur
  w: { x: number; z: number }  // perpendiculaire
  wallLats: number[]
  wallC: Vec3                  // centre du mur (pour caler l'image)
  keeperX0: number
  ballSX: number // x à l'écran du ballon et du mur
  wallSX: number
}
// mur de 4 à 9,15 m sur la ligne ballon -> poteau le plus proche
function wallGeom(ballX: number, dist: number) {
  const near = ballX < -0.25 ? -1 : 1
  let hx = near * GOAL_HALF_W - ballX, hz = dist
  const hl = Math.hypot(hx, hz)
  hx /= hl; hz /= hl
  const w = { x: hz, z: -hx }
  const outward = Math.sign(w.x) * near || 1
  const wallLats = Array.from({ length: 4 }, (_, k) => outward * (0.35 - WALL_PLAYER_HALF_W - k * 0.55))
  const mean = wallLats.reduce((a, b) => a + b, 0) / 4
  const wallC = { x: ballX + hx * WALL_DIST + w.x * mean, y: 0, z: hz * WALL_DIST + w.z * mean }
  return { near, hc: { x: hx, z: hz }, w, wallLats, wallC }
}
function buildScene(cfg: ShotConfig): Scene {
  const ball0 = { x: cfg.ballX, y: BALL_R, z: 0 }
  const g = wallGeom(cfg.ballX, cfg.dist)
  const ref = wallGeom(BALL_X, cfg.dist) // disposition de l'image d'origine
  return {
    cfg, ball0, hc: g.hc, w: g.w, wallLats: g.wallLats, wallC: g.wallC,
    keeperX0: -g.near * 1.0,
    ballSX: IMG.ball.x + (cfg.ballX - BALL_X) * SPOT_PX,
    wallSX: IMG.wall.x + (g.wallC.x - ref.wallC.x) * WALL_PX,
  }
}

// projection sur l'image : interpolation ballon -> mur -> but (le mur et le but
// restent exactement où ils sont dessinés sur l'image, quelle que soit la distance)
// projection sur l'image : courbes douces (quadratiques) qui passent par le ballon, le mur et le
// but tels qu'ils sont dessinés -> une trajectoire droite reste lisse à l'écran (pas de cassure au mur)
function quad(u: number, uw: number, a: number, b: number, c: number) {
  // polynôme de Lagrange passant par (0,a), (uw,b), (1,c)
  return a * ((u - uw) * (u - 1)) / (uw * 1) + b * (u * (u - 1)) / (uw * (uw - 1)) + c * (u * (u - uw)) / (1 - uw)
}
function project(sc: Scene, p: Vec3) {
  const D = sc.cfg.dist
  const uw = Math.max(0.2, Math.min(0.8, sc.wallC.z / D))
  const u = Math.max(-0.3, Math.min(1.25, p.z / D))
  const X = quad(u, uw, sc.ballSX, sc.wallSX, IMG.goal.x)
  const Y = quad(u, uw, IMG.ball.y, IMG.wall.y, IMG.goal.y)
  const xr = quad(u, uw, sc.ball0.x, sc.wallC.x, 0)
  const sx = Math.max(30, quad(u, uw, SX[0], SX[1], SX[2]))
  const sy = Math.max(30, quad(u, uw, SY[0], SY[1], SY[2]))
  return { x: X + (p.x - xr) * sx, y: Y - p.y * sy, k: sy, u }
}

type Outcome = 'goal' | 'lucarne' | 'wall' | 'saved' | 'post' | 'bar' | 'wide' | 'over'
const OUTCOME_TEXT: Record<Outcome, string> = {
  goal: 'BUT !', lucarne: 'LUCARNE !', wall: 'Dans le mur !', saved: 'Arrêt du gardien !',
  post: 'Poteau !', bar: 'Transversale !', wide: 'À côté !', over: 'Au-dessus !',
}

// trajectoire : pos(t) = o + v t + ½ a t² + ⅙ j t³ (j = effet qui grandit en fin de course, comme un vrai ballon)
interface Flight { o: Vec3; v: Vec3; a: Vec3; j: Vec3; t: number; trail: Vec3[] }
interface Engine {
  phase: 'idle' | 'aim' | 'flight' | 'after' | 'over'
  seed: number
  goals: number
  points: number
  lives: number
  combo: number
  startAt: number
  endAt: number
  scene: Scene
  flight: Flight | null
  free: { p: Vec3; v: Vec3 } | null
  outcome: Outcome | null
  outcomeAt: number
  keeperX: number
  keeperJump: number
  pick: { i: number; prec: number; x: number; y: number } | null // point rouge choisi (étape 1) et précision du toucher
  pending: { i: number; prec: number; x: number; y: number } | null
  swipe: { x: number; y: number; t: number }[]
  swiping: boolean
  shot: { dirX: number; power: number } | null // swipe enregistré, prêt à TIRER
  runAt: number  // TIRER appuyé : élan du tireur
  kickAt: number // instant de la frappe
  hintAt: number
  help: boolean // aides affichées (bouton « ? »)
  msg: { text: string; sub: string; at: number; good: boolean } | null
  particles: { x: number; y: number; vx: number; vy: number; life: number; c: string }[]
  spin: number
  spinDir: number // effet du tir (-1..1) : sens de rotation du ballon
  audio: AudioContext | null
  view: { s: number; ox: number; oy: number } // image -> px du canvas
}

function newEngine(seed: number): Engine {
  const cfg = shotConfig(seed, 0)
  const scene = buildScene(cfg)
  return {
    phase: 'idle', seed, goals: 0, points: 0, lives: LIVES, combo: 1, startAt: 0, endAt: 0,
    scene, flight: null, free: null, outcome: null, outcomeAt: 0,
    keeperX: scene.keeperX0, keeperJump: 0, pick: null, pending: null,
    swipe: [], swiping: false, shot: null, runAt: 0, kickAt: 0, hintAt: -1e9, help: false, msg: null, particles: [], spin: 0, spinDir: 0, audio: null,
    view: { s: 1, ox: 0, oy: 0 },
  }
}

let imgCache: { plate: HTMLImageElement; wall: HTMLImageElement; keeper: HTMLImageElement; ball: HTMLImageElement; shooter: HTMLImageElement } | null = null
function fkImgs() {
  if (imgCache) return imgCache
  const load = (src: string) => { const im = new Image(); im.src = src; return im }
  imgCache = { plate: load(plateSrc), wall: load(wallSrc), keeper: load(keeperSrc), ball: load(ballSrc), shooter: load(shooterSrc) }
  return imgCache
}

export default function FreeKickGame({ groupId, groupName, autoApplyAllLeagues, onExit }: Props) {
  const { user } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine>(newEngine(1))

  const [phase, setPhase] = useState<'idle' | 'playing' | 'over'>('idle')
  const [finalPoints, setFinalPoints] = useState(0)
  const [finalGoals, setFinalGoals] = useState(0)
  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [lastWeekBest, setLastWeekBest] = useState<BestScore | null>(null)
  const [allTimeBest, setAllTimeBest] = useState<BestScore | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showBoard, setShowBoard] = useState(false)

  const sendOnWizzChannel = useWizzChannel(groupId)

  const loadScores = async () => {
    const { data: s } = await supabase.from('freekick_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', monday()).order('score', { ascending: false })
    const { data: lastWeekRows } = await supabase.from('freekick_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', await previousGameWeek('coup-franc', monday())).order('score', { ascending: false }).limit(1)
    const { data: allTimeRows } = await supabase.from('freekick_scores').select('profile_id, score')
      .eq('group_id', groupId).order('score', { ascending: false }).limit(1)
    const ids = new Set<string>()
    for (const r of [...(s ?? []), ...(lastWeekRows ?? []), ...(allTimeRows ?? [])]) ids.add(r.profile_id)
    let pseudos: Record<string, string> = {}
    if (ids.size > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', [...ids])
      pseudos = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
    }
    const best: Record<string, number> = {}
    for (const r of s ?? []) best[r.profile_id] = Math.max(best[r.profile_id] ?? 0, r.score)
    setScores(Object.entries(best)
      .map(([profile_id, sc]) => ({ profile_id, score: sc, pseudo: pseudos[profile_id] ?? '???' }))
      .sort((a, b) => b.score - a.score))
    setLastWeekBest(lastWeekRows?.[0] ? { pseudo: pseudos[lastWeekRows[0].profile_id] ?? '???', score: lastWeekRows[0].score } : null)
    setAllTimeBest(allTimeRows?.[0] ? { pseudo: pseudos[allTimeRows[0].profile_id] ?? '???', score: allTimeRows[0].score } : null)
  }

  useEffect(() => {
    loadScores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('pseudo').eq('id', user.id).maybeSingle()
      .then(({ data }) => setMyPseudo(data?.pseudo ?? null))
  }, [user])

  // partie interrompue (on quitte l'écran) : on prévient le groupe
  useEffect(() => {
    return () => {
      const ph = engineRef.current.phase
      if (user && (ph === 'aim' || ph === 'flight' || ph === 'after')) {
        sendOnWizzChannel('playing', { action: 'stop', profileId: user.id })
      }
      engineRef.current.audio?.close().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  // ---------------------------------------------------------------- son ----
  const ensureAudio = () => {
    const eng = engineRef.current
    try {
      if (!eng.audio) eng.audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      else if (eng.audio.state === 'suspended') eng.audio.resume()
    } catch { /* pas de son */ }
  }
  const tone = (freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) => {
    const ctx = engineRef.current.audio
    if (!ctx) return
    try {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0); osc.stop(t0 + dur + 0.02)
    } catch { /* ignore */ }
  }
  const noise = (dur: number, vol: number, freq: number, q = 0.7) => {
    const ctx = engineRef.current.audio
    if (!ctx) return
    try {
      const len = Math.floor(ctx.sampleRate * dur)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource(); src.buffer = buf
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q
      const gain = ctx.createGain(); const t0 = ctx.currentTime
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(vol, t0 + 0.05); gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      src.connect(filter).connect(gain).connect(ctx.destination)
      src.start(t0); src.stop(t0 + dur + 0.05)
    } catch { /* ignore */ }
  }
  const sfxWhistle = () => { tone(2300, 0.12, 'sine', 0.08); tone(2300, 0.22, 'sine', 0.08, 0.16) }
  const sfxKick = () => { tone(140, 0.12, 'sine', 0.35, 0, 60); noise(0.06, 0.2, 2200, 1.2) }
  const sfxNet = () => noise(0.35, 0.18, 3000, 0.5)
  const sfxRoar = () => noise(1.4, 0.32, 900, 0.5)
  const sfxClang = () => { tone(1250, 0.5, 'triangle', 0.18); tone(1870, 0.4, 'triangle', 0.1) }
  const sfxThud = () => tone(110, 0.18, 'sine', 0.3, 0, 70)
  const sfxGroan = () => { noise(0.7, 0.14, 500, 0.6); tone(220, 0.5, 'sawtooth', 0.05, 0, 150) }
  const sfxTick = () => tone(900, 0.05, 'square', 0.05)
  const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p) } catch { /* ignore */ } }

  // ----------------------------------------------------------- partie -----
  const setupShot = () => {
    const eng = engineRef.current
    eng.scene = buildScene(shotConfig(eng.seed, eng.goals))
    eng.flight = null
    eng.free = null
    eng.outcome = null
    eng.keeperX = eng.scene.keeperX0
    eng.keeperJump = 0
    eng.swipe = []
    eng.swiping = false
    eng.shot = null
    eng.pick = null
    eng.runAt = 0
    eng.msg = null
    eng.phase = 'aim'
    sfxWhistle()
  }

  const startGame = () => {
    ensureAudio()
    const eng = engineRef.current
    eng.seed = (Math.random() * 4294967296) >>> 0
    eng.goals = 0
    eng.points = 0
    eng.lives = LIVES
    eng.combo = 1
    eng.particles = []
    eng.startAt = performance.now()
    eng.endAt = 0
    setPhase('playing')
    setShowRules(false)
    setupShot()
    if (user) {
      sendOnWizzChannel('playing', { action: 'start', profileId: user.id, pseudo: myPseudo || 'Un coéquipier', game: 'coup-franc' })
      supabase.rpc('notify_freekick_start', { p_group_id: groupId }).then(() => {})
    }
  }

  const endGame = () => {
    const eng = engineRef.current
    if (eng.phase === 'over' || eng.phase === 'idle') return
    eng.phase = 'over'
    eng.msg = null
    eng.endAt = performance.now()
    const final = Math.min(eng.points, MAX_SCORE)
    setFinalPoints(final)
    setFinalGoals(eng.goals)
    setPhase('over')
    if (!user) return
    sendOnWizzChannel('playing', { action: 'stop', profileId: user.id })
    const save = autoApplyAllLeagues
      ? supabase.rpc('submit_freekick_score_all_leagues', { p_score: final })
      : supabase.from('freekick_scores').insert({ group_id: groupId, profile_id: user.id, week_start: monday(), score: final })
    save.then(() => loadScores())
  }

  // Frappe : direction (swipe), puissance (swipe), effet + hauteur (point touché sur le gros ballon)
  const shoot = () => {
    const eng = engineRef.current
    if (eng.phase !== 'aim' || !eng.shot) return
    if (!eng.pick) eng.pick = { i: 0, prec: 1, x: IMG.bigBall.x, y: IMG.bigBall.y } // sans point : tir sans effet
    const sc = eng.scene, b = sc.ball0
    const { dirX, power } = eng.shot
    // point d'impact (continu) : côté = effet, bas = le ballon monte, haut = il plonge
    const bb = IMG.bigBall
    const ix = Math.max(-1, Math.min(1, (eng.pick.x - bb.x) / bb.r)), iy = Math.max(-1, Math.min(1, (eng.pick.y - bb.y) / bb.r))
    // Le swipe donne la direction de DÉPART du ballon ; le point d'impact fait la trajectoire :
    //  - côté : effet, le ballon part tout droit puis tourne vers l'autre côté (pas compensé) ;
    //    plus on tape bas sur le côté, plus il tourne et monte (frappe enroulée) ;
    //  - bas (centre) : le ballon monte haut ; haut : frappe sèche et basse.
    const low = Math.max(0, iy), high = Math.max(0, -iy)
    const curl = Math.max(-1, Math.min(1, ix)) * (1 + 0.4 * low) // jusqu'à ±1,4
    // hauteur visée : la puissance, puis le point d'impact (bas = monte, haut = rase)
    const ty = Math.max(0.15, 0.45 + power * 1.6 + low * 0.9 - high * 0.6)
    const bs0 = project(sc, b)
    const want = dirX // pente à l'écran de la flèche (dx / dy)
    // construit le tir vers le point tx du but
    const build = (tx: number) => {
      const target = { x: tx, y: ty, z: sc.cfg.dist }
      const horiz = Math.hypot(target.x - b.x, target.z - b.z)
      const T = (0.42 + horiz * 0.017) * (1.2 - 0.4 * power) * (1 + 0.12 * low - 0.1 * high) // ≈ 25 m/s : trajectoire tendue
      const hx = (target.x - b.x) / horiz, hz = (target.z - b.z) / horiz
      // ballon frappé qui monte puis plonge (passe au-dessus du mur et retombe sous la barre)
      const a = { x: 0, y: -(G + 5), z: 0 }
      const v = { x: (target.x - b.x) / T, y: (target.y - b.y) / T - 0.5 * a.y * T, z: (target.z - b.z) / T }
      return { T, hx, hz, a, v }
    }
    // le ballon part EXACTEMENT dans le sens de la flèche à l'écran : on cherche le point du but
    // qui donne ce départ (pente mesurée sur le premier tiers du vol)
    const slope = (tx: number) => {
      const s0 = build(tx), t = s0.T * 0.3
      const q = project(sc, { x: b.x + s0.v.x * t, y: b.y + s0.v.y * t + 0.5 * s0.a.y * t * t, z: b.z + s0.v.z * t })
      return (q.x - bs0.x) / Math.max(1, bs0.y - q.y)
    }
    let lo = -14, hi = 14
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (slope(m) < want) lo = m; else hi = m }
    const { T, hx, hz, a, v } = build((lo + hi) / 2) // (a est une copie : on y ajoute l'effet)
    const nx = hz, nz = -hx
    // effet : le ballon part droit puis s'incurve de plus en plus (côté ≈ 3 m, bas + côté ≈ 4,5 m)
    const D = -curl * 3.2
    // courbe régulière (accélération constante sur le côté), un peu plus marquée en fin de course
    const am = (2 * D * 0.6) / (T * T), jm = (6 * D * 0.4) / (T * T * T)
    a.x += am * nx; a.z += am * nz
    const j = { x: jm * nx, y: 0, z: jm * nz }
    eng.spinDir = curl || 0.15
    eng.flight = { o: { ...b }, v, a, j, t: 0, trail: [] }
    eng.phase = 'flight'
    eng.shot = null
    eng.runAt = 0
    eng.kickAt = performance.now()
    sfxKick()
    vibrate(15)
  }

  const flightPos = (f: Flight, t: number): Vec3 => ({
    x: f.o.x + f.v.x * t + 0.5 * f.a.x * t * t + (f.j.x * t * t * t) / 6,
    y: f.o.y + f.v.y * t + 0.5 * f.a.y * t * t + (f.j.y * t * t * t) / 6,
    z: f.o.z + f.v.z * t + 0.5 * f.a.z * t * t + (f.j.z * t * t * t) / 6,
  })
  const flightVel = (f: Flight, t: number): Vec3 => ({ x: f.v.x + f.a.x * t + (f.j.x * t * t) / 2, y: f.v.y + f.a.y * t, z: f.v.z + f.a.z * t + (f.j.z * t * t) / 2 })

  const resolve = (outcome: Outcome, p: Vec3, v: Vec3) => {
    const eng = engineRef.current
    eng.outcome = outcome
    eng.outcomeAt = performance.now()
    eng.phase = 'after'
    let nv: Vec3
    switch (outcome) {
      case 'goal': case 'lucarne': nv = { x: v.x * 0.25, y: v.y * 0.2, z: v.z * 0.12 }; break
      case 'wall': nv = { x: v.x * 0.15 + (Math.random() - 0.5) * 2.4, y: 1.2 + Math.random(), z: -v.z * 0.08 }; break // retombe devant le mur
      case 'saved': nv = { x: (p.x - eng.keeperX) * 2.5 + v.x * 0.2, y: Math.abs(v.y) * 0.3 + 1.5, z: -v.z * 0.12 }; break // repoussé sur le côté
      case 'post': nv = { x: -v.x * 0.5 + Math.sign(p.x) * -2, y: v.y * 0.6, z: -v.z * 0.35 }; break
      case 'bar': nv = { x: v.x * 0.5, y: -Math.abs(v.y) * 0.3 + 3, z: -v.z * 0.35 }; break
      default: nv = { ...v }
    }
    eng.free = { p: { ...p }, v: nv }
    const isGoal = outcome === 'goal' || outcome === 'lucarne'
    if (isGoal) {
      const base = outcome === 'lucarne' ? 200 : 100
      const pts = base * eng.combo
      eng.goals += 1
      eng.points += pts
      eng.msg = { text: OUTCOME_TEXT[outcome], sub: `+${pts}${eng.combo > 1 ? `  (combo x${eng.combo})` : ''}`, at: performance.now(), good: true }
      eng.combo = Math.min(5, eng.combo + 1)
      sfxNet(); sfxRoar(); vibrate([30, 40, 60])
      const sp = project(eng.scene, p)
      const colors = ['#D4A22C', '#F4EFE2', '#2F8F5B', '#C1443C']
      for (let i = 0; i < 70; i++) {
        const ang = Math.random() * Math.PI * 2, spd = 150 + Math.random() * 500
        eng.particles.push({ x: sp.x, y: sp.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 300, life: 1.2 + Math.random() * 0.6, c: colors[i % colors.length] })
      }
    } else {
      eng.lives -= 1
      eng.combo = 1
      eng.msg = { text: OUTCOME_TEXT[outcome], sub: eng.lives > 0 ? `${eng.lives} essai${eng.lives > 1 ? 's' : ''} restant${eng.lives > 1 ? 's' : ''}` : 'Plus d\'essai !', at: performance.now(), good: false }
      if (outcome === 'post' || outcome === 'bar') sfxClang()
      else if (outcome === 'wall' || outcome === 'saved') sfxThud()
      sfxGroan()
      vibrate(80)
    }
  }

  // ------------------------------------------------------------ physique ----
  const step = (dt: number) => {
    const eng = engineRef.current
    const sc = eng.scene
    for (const p of eng.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.life -= dt }
    eng.particles = eng.particles.filter((p) => p.life > 0)
    // élan terminé : frappe
    if (eng.phase === 'aim' && eng.runAt && performance.now() - eng.runAt >= RUN_UP * 1000) shoot()

    if (eng.phase === 'flight' && eng.flight) {
      const f = eng.flight
      eng.spin += dt * (9 + Math.abs(eng.spinDir) * 16) * (eng.spinDir < 0 ? -1 : 1) // rotation selon l'effet
      const SUB = 8
      for (let i = 0; i < SUB && eng.phase === 'flight'; i++) {
        const t0 = f.t, t1 = t0 + dt / SUB
        const p0 = flightPos(f, t0), p1 = flightPos(f, t1)
        f.t = t1
        // gardien : réagit après son temps de réaction, sans lire l'effet restant
        if (t1 > sc.cfg.keeperReaction) {
          const v = flightVel(f, t1)
          const remain = Math.max(0.05, (sc.cfg.dist - p1.z) / Math.max(1, v.z))
          const px = p1.x + v.x * remain
          const py = p1.y + v.y * remain - 0.5 * G * remain * remain
          const target = Math.max(-GOAL_HALF_W, Math.min(GOAL_HALF_W, px))
          const maxMove = sc.cfg.keeperSpeed * (dt / SUB)
          eng.keeperX += Math.max(-maxMove, Math.min(maxMove, target - eng.keeperX))
          const wantJump = py > 1.7 ? Math.min(0.45, (py - 1.7) * 0.6) : 0
          eng.keeperJump += (wantJump - eng.keeperJump) * Math.min(1, (dt / SUB) * 6)
        }
        // mur
        const d0 = (p0.x - sc.ball0.x) * sc.hc.x + p0.z * sc.hc.z
        const d1 = (p1.x - sc.ball0.x) * sc.hc.x + p1.z * sc.hc.z
        if (d0 < WALL_DIST && d1 >= WALL_DIST) {
          const u = (WALL_DIST - d0) / (d1 - d0)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, z: p0.z + (p1.z - p0.z) * u }
          const lat = (pc.x - sc.ball0.x) * sc.w.x + pc.z * sc.w.z
          if (sc.wallLats.some((l) => Math.abs(lat - l) <= WALL_PLAYER_HALF_W + BALL_R) && pc.y <= WALL_HEIGHT + BALL_R) {
            resolve('wall', pc, flightVel(f, t1)); break
          }
        }
        // rebond avant le but
        if (p1.y < BALL_R && p1.z < sc.cfg.dist - 0.5) {
          const v = flightVel(f, t1)
          f.o = { x: p1.x, y: BALL_R, z: p1.z }
          f.v = { x: v.x * 0.78, y: Math.abs(v.y) * 0.45, z: v.z * 0.78 }
          f.a = { x: 0, y: -G, z: 0 }; f.j = { x: 0, y: 0, z: 0 }
          f.t = 0
          sfxThud()
          continue
        }
        // gardien
        const kz = sc.cfg.dist - KEEPER_LINE_OFFSET
        if (p0.z < kz && p1.z >= kz) {
          const u = (kz - p0.z) / (p1.z - p0.z)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, z: kz }
          const dx = pc.x - eng.keeperX
          const reachY = 2.35 + eng.keeperJump
          const ny = Math.max(0, pc.y - 0.9) / (reachY - 0.9)
          if ((dx / sc.cfg.keeperReach) ** 2 + ny * ny <= 1 && pc.y >= -0.1) { resolve('saved', pc, flightVel(f, t1)); break }
        }
        // ligne de but
        const gz = sc.cfg.dist
        if (p0.z < gz && p1.z >= gz) {
          const u = (gz - p0.z) / (p1.z - p0.z)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: Math.max(BALL_R, p0.y + (p1.y - p0.y) * u), z: gz }
          const v = flightVel(f, t1)
          const ax = Math.abs(pc.x)
          const nearPost = Math.abs(ax - GOAL_HALF_W) <= BALL_R + POST_R && pc.y <= GOAL_H + POST_R
          const nearBar = Math.abs(pc.y - GOAL_H) <= BALL_R + POST_R && ax <= GOAL_HALF_W + POST_R
          if (nearBar && !(ax < GOAL_HALF_W - BALL_R && pc.y < GOAL_H - BALL_R)) resolve('bar', pc, v)
          else if (nearPost && !(ax < GOAL_HALF_W - BALL_R)) resolve('post', pc, v)
          else if (ax < GOAL_HALF_W - BALL_R && pc.y < GOAL_H - BALL_R) resolve(ax > GOAL_HALF_W - 1.1 && pc.y > 1.6 ? 'lucarne' : 'goal', pc, v)
          else if (pc.y >= GOAL_H - BALL_R && ax < GOAL_HALF_W + 1.5) resolve('over', pc, v)
          else resolve('wide', pc, v)
          break
        }
        if (f.t > 4) { resolve('wide', p1, flightVel(f, t1)); break }
      }
      if (eng.flight && eng.phase === 'flight') {
        f.trail.push(flightPos(f, f.t))
        if (f.trail.length > 16) f.trail.shift()
      }
    } else if (eng.phase === 'after' && eng.free) {
      const fb = eng.free
      fb.v.y -= G * dt
      fb.p.x += fb.v.x * dt; fb.p.y += fb.v.y * dt; fb.p.z += fb.v.z * dt
      const isGoal = eng.outcome === 'goal' || eng.outcome === 'lucarne'
      if (isGoal && fb.p.z > sc.cfg.dist + 1.6) { fb.p.z = sc.cfg.dist + 1.6; fb.v.z = 0; fb.v.x *= 0.5 }
      if (fb.p.y < BALL_R) { fb.p.y = BALL_R; fb.v.y = Math.abs(fb.v.y) * 0.4; fb.v.x *= 0.7; fb.v.z *= 0.7 }
      // au sol : le ballon roule et ralentit
      if (fb.p.y <= BALL_R + 0.02) { const k = Math.max(0, 1 - dt * 2.5); fb.v.x *= k; fb.v.z *= k }
      if (fb.p.z < 2) { fb.p.z = 2; fb.v.z = Math.max(0, fb.v.z) }
      eng.spin += dt * Math.hypot(fb.v.x, fb.v.z) * 1.5
      eng.keeperJump *= Math.max(0, 1 - dt * 4)
      const elapsed = (performance.now() - eng.outcomeAt) / 1000
      if (elapsed > 1.8) {
        if (eng.lives <= 0) endGame()
        else setupShot()
      }
    }
  }

  // swipe -> direction (pente) et puissance (longueur + vitesse)
  const readSwipe = (a: { x: number; y: number; t: number }, b: { x: number; y: number; t: number }) => {
    const dy = a.y - b.y, dx = b.x - a.x
    if (dy < 30) return null
    const len = Math.hypot(dx, dy)
    const power = Math.max(0.05, Math.min(1, (len - 30) / (ARROW_MAX - 30)))
    return { dirX: Math.max(-1.5, Math.min(1.5, dx / dy)), power }
  }

  // ------------------------------------------------------------ dessin ------
  const draw = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const eng = engineRef.current
    const sc = eng.scene
    const now = performance.now()
    const im = fkImgs()
    const { s, ox, oy } = eng.view
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#123321'
    ctx.fillRect(0, 0, cw, ch)
    ctx.setTransform(s, 0, 0, s, ox, oy) // à partir d'ici : coordonnées de l'image
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (im.plate.complete && im.plate.naturalWidth) ctx.drawImage(im.plate, 0, 0, IW, IH)
    const P = (p: Vec3) => project(sc, p)

    // gardien (dessiné derrière le ballon) : la pose suit son déplacement
    {
      const kz = sc.cfg.dist - KEEPER_LINE_OFFSET
      const c = P({ x: eng.keeperX, y: eng.keeperJump + 0.84, z: kz }) // centre du corps
      const img = im.keeper
      if (img.complete && img.naturalWidth) {
        const d = eng.keeperX - sc.keeperX0
        const m = Math.abs(d) + eng.keeperJump * 1.2
        const f = m < 0.12 ? 0 : m < 0.45 ? 1 : m < 0.85 ? 2 : m < 1.3 ? 3 : 4
        const k = KF_SCALE * (c.k / SY[2])
        const w = KF_W * k, h = KF_H * k
        ctx.save()
        ctx.translate(c.x, c.y)
        if (d < 0 && f > 0) ctx.scale(-1, 1)
        ctx.drawImage(img, f * KF_W, 0, KF_W, KF_H, -w / 2, -h / 2, w, h)
        ctx.restore()
      }
    }

    // ballon
    let ballPos: Vec3 = sc.ball0
    if (eng.phase === 'flight' && eng.flight) ballPos = flightPos(eng.flight, eng.flight.t)
    else if ((eng.phase === 'after' || eng.phase === 'over') && eng.free) ballPos = eng.free.p
    const bp = P(ballPos)
    const behindWall = ballPos.z > sc.wallC.z + 0.2
    const drawBall = () => {
      const sh = P({ ...ballPos, y: 0 })
      const r = Math.max(6, bp.k * BALL_R * (4.2 - 2.2 * Math.max(0, Math.min(1, bp.u))))
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0.1, 0.35 - (ballPos.y - BALL_R) * 0.06)})`
      ctx.beginPath(); ctx.ellipse(sh.x, sh.y, r * 1.1, r * 0.35, 0, 0, Math.PI * 2); ctx.fill()
      if (eng.phase === 'flight' && eng.flight && eng.flight.trail.length > 1) {
        ctx.beginPath()
        eng.flight.trail.forEach((p, i) => { const q = P(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y) })
        ctx.strokeStyle = 'rgba(255,245,220,0.35)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke()
      }
      if (im.ball.complete && im.ball.naturalWidth) {
        ctx.save(); ctx.translate(bp.x, bp.y); ctx.rotate(eng.spin)
        ctx.drawImage(im.ball, -r, -r, r * 2, r * 2); ctx.restore()
      }
    }
    // le mur repasse devant le ballon quand le ballon est derrière lui
    const drawWall = () => {
      if (!im.wall.complete || !im.wall.naturalWidth) return
      const wc = P(sc.wallC)
      ctx.drawImage(im.wall, Math.round(wc.x - WALL_SPR.cx), Math.round(wc.y - WALL_SPR.feet))
    }
    if (behindWall) { drawBall(); drawWall() } else { drawWall(); drawBall() }

    // tireur n°10 animé : son pied droit tombe sur le ballon à la frappe
    if (im.shooter.complete && im.shooter.naturalWidth) {
      const t = now
      let f = 0
      if (eng.phase === 'aim' && eng.runAt) f = Math.min(5, 1 + Math.floor(((t - eng.runAt) / 1000 / RUN_UP) * 5))
      else if (eng.kickAt && t - eng.kickAt < 450 && eng.phase !== 'aim') f = Math.min(8, 5 + Math.floor((t - eng.kickAt) / 110))
      const w = SH_W * SH_SCALE, h = SH_H * SH_SCALE
      const b0 = P(sc.ball0)
      const x = b0.x - SH_BALL.x * SH_SCALE, y = b0.y - SH_BALL.y * SH_SCALE
      ctx.drawImage(im.shooter, f * SH_W, 0, SH_W, SH_H, x, y, w, h)
    }

    // ---- bandeau : score, essais, temps, combo ----
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = '700 34px Oswald, sans-serif'; ctx.fillStyle = '#f5e7c4'
    ctx.fillText(eng.points.toLocaleString('fr-FR'), 182, 239)
    for (let i = 0; i < LIVES; i++) drawHeart(ctx, 330 + i * 46, 239, 19, i < eng.lives)
    const tEnd = eng.phase === 'over' ? eng.endAt : now
    const secs = eng.startAt ? Math.max(0, Math.floor((tEnd - eng.startAt) / 1000)) : 0
    ctx.fillText(`${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`, 621, 239)
    ctx.fillStyle = '#f2b544'; ctx.font = '700 36px Oswald, sans-serif'
    ctx.fillText('x' + eng.combo, 826, 239)

    // « ? » allumé quand les aides sont affichées
    if (eng.help) {
      const z = ZONE.help
      ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 5
      roundRect(ctx, z.x0 + 4, z.y0 + 4, z.x1 - z.x0 - 8, z.y1 - z.y0 - 8, 12); ctx.stroke()
    }

    // ---- point d'impact choisi sur le gros ballon ----
    if (eng.pick) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180)
      ctx.fillStyle = '#d8262c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5
      ctx.beginPath(); ctx.arc(eng.pick.x, eng.pick.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = `rgba(255,214,90,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 5
      ctx.beginPath(); ctx.arc(eng.pick.x, eng.pick.y, 26 + pulse * 5, 0, Math.PI * 2); ctx.stroke()
    }
    // ---- guide des 3 étapes (sur la pelouse) ----
    if (eng.phase === 'aim' && !eng.runAt && eng.help) {
      const step = !eng.pick ? 1 : !eng.shot ? 2 : 3
      const l1 = step === 1 ? '① Touche le gros ballon : l\'effet' : step === 2 ? '② Tire la flèche depuis le ballon' : '③ Appuie sur TIRER'
      const l3 = eng.pick ? `${SHOT_NAME[shotKind((eng.pick.x - IMG.bigBall.x) / IMG.bigBall.r, (eng.pick.y - IMG.bigBall.y) / IMG.bigBall.r)]}${eng.shot ? ` · ${Math.round(eng.shot.power * 100)} %` : ''}` : 'là où tu frappes le ballon'
      const lines = [l1, l3]
      ctx.font = '700 30px Oswald, sans-serif'
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 44, h = 20 + lines.length * 36
      const x = Math.min(IW - w - 12, IW / 2 - w / 2 + 60), y = 644
      ctx.fillStyle = 'rgba(16,40,26,0.88)'; roundRect(ctx, x, y, w, h, 18); ctx.fill()
      ctx.strokeStyle = '#d9b25a'; ctx.lineWidth = 3; ctx.stroke()
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      lines.forEach((t, i) => {
        ctx.font = i === 0 ? '700 30px Oswald, sans-serif' : '600 25px Oswald, sans-serif'
        ctx.fillStyle = i === 0 ? '#ffd84a' : '#f5e7c4'
        ctx.fillText(t, x + w / 2, y + 28 + i * 36)
      })
      ctx.textBaseline = 'alphabetic'
    }

    // ---- swipe en cours / enregistré : flèche dans la direction, longueur = puissance ----
    const arrow = (dirX: number, power: number, alpha: number) => {
      const len = 30 + power * (ARROW_MAX - 30)
      const ang = Math.atan2(dirX, 1) // même angle que le départ du ballon
      ctx.save()
      const bs = project(sc, sc.ball0)
      ctx.translate(bs.x, bs.y)
      ctx.rotate(ang)
      const g = ctx.createLinearGradient(0, 0, 0, -len)
      g.addColorStop(0, `rgba(255,200,60,${0.15 * alpha})`); g.addColorStop(1, `rgba(255,220,90,${0.95 * alpha})`)
      ctx.fillStyle = g
      ctx.beginPath()
      const hd = Math.min(50, len * 0.45)
      ctx.moveTo(-14, 0); ctx.lineTo(-20, -len + hd); ctx.lineTo(-46, -len + hd); ctx.lineTo(0, -len)
      ctx.lineTo(46, -len + hd); ctx.lineTo(20, -len + hd); ctx.lineTo(14, 0); ctx.closePath(); ctx.fill()
      ctx.strokeStyle = `rgba(255,240,190,${alpha})`; ctx.lineWidth = 4; ctx.stroke()
      ctx.restore()
    }
    if (eng.phase === 'aim') {
      if (eng.swiping && eng.swipe.length > 1) {
        const r = readSwipe(eng.swipe[0], eng.swipe[eng.swipe.length - 1])
        if (r) arrow(r.dirX, r.power, 0.85)
      } else if (eng.shot) {
        arrow(eng.shot.dirX, eng.shot.power, 1)
        // bouton TIRER qui pulse
        const z = ZONE.shoot, pulse = 0.5 + 0.5 * Math.sin(now / 150)
        ctx.strokeStyle = `rgba(255,214,90,${0.4 + 0.6 * pulse})`; ctx.lineWidth = 7
        roundRect(ctx, z.x0 + 4, z.y0 + 6, z.x1 - z.x0 - 8, z.y1 - z.y0 - 12, 30); ctx.stroke()

      }
      if (eng.help && now - eng.hintAt < 1600) {
        ctx.textAlign = 'center'; ctx.font = '700 34px Oswald, sans-serif'
        ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(40,10,10,.85)'; ctx.fillStyle = '#ffd84a'
        const t = !eng.pick ? 'Touche d\'abord le ballon !' : 'Swipe vers le haut d\'abord !'
        ctx.strokeText(t, IW / 2, 1505); ctx.fillText(t, IW / 2, 1505)
      }
    }

    // confettis
    for (const p of eng.particles) {
      ctx.globalAlpha = Math.min(1, p.life); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 8, 12)
    }
    ctx.globalAlpha = 1

    // message d'issue (sur la pelouse)
    if (eng.msg) {
      const age = (now - eng.msg.at) / 1000
      const k = age < 0.18 ? 0.6 + (age / 0.18) * 0.5 : age < 0.3 ? 1.1 - ((age - 0.18) / 0.12) * 0.1 : 1
      ctx.save(); ctx.translate(IW / 2, 700); ctx.scale(k, k)
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.font = eng.msg.good ? 'italic 700 120px Oswald, sans-serif' : '700 88px Oswald, sans-serif'
      ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(40,10,10,0.9)'
      ctx.strokeText(eng.msg.text, 0, 0)
      ctx.fillStyle = eng.msg.good ? '#ffd84a' : '#f5e7c4'; ctx.fillText(eng.msg.text, 0, 0)
      if (eng.msg.sub) {
        ctx.font = '700 46px Oswald, sans-serif'; ctx.lineWidth = 8
        ctx.strokeText(eng.msg.sub, 0, 56); ctx.fillStyle = '#fff'; ctx.fillText(eng.msg.sub, 0, 56)
      }
      ctx.restore()
    }
    ctx.textBaseline = 'alphabetic'
  }

  // ------------------------------------------------------------ boucle ------
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let dpr = 1
    const resize = () => {
      const rect = stage.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 3)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      // l'image entière tient dans l'écran (centrée)
      const s = Math.min(rect.width / IW, rect.height / IH)
      engineRef.current.view = { s: s * dpr, ox: ((rect.width - IW * s) / 2) * dpr, oy: ((rect.height - IH * s) / 2) * dpr }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(stage)
    let raf = 0
    let last = performance.now()
    const loop = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      step(dt)
      draw(ctx, canvas.width, canvas.height)
      const eng = engineRef.current
      canvas.dataset.phase = eng.phase
      canvas.dataset.outcome = eng.outcome ?? ''
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ entrées -----
  // px de l'écran -> px de l'image
  const toImg = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const { s, ox, oy } = engineRef.current.view
    return { x: ((e.clientX - rect.left) * dpr - ox) / s, y: ((e.clientY - rect.top) * dpr - oy) / s, t: performance.now() }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    const p = toImg(e)
    if (inZone(ZONE.back, p)) {
      if (eng.phase === 'idle' || eng.phase === 'over') onExit()
      else endGame()
      return
    }
    // « ? » : en partie, affiche / cache les aides ; sinon, les règles
    if (inZone(ZONE.help, p)) { if (eng.phase === 'idle' || eng.phase === 'over') setShowRules((v) => !v); else eng.help = !eng.help; return }
    if (eng.phase !== 'aim') return
    if (inZone(ZONE.shoot, p)) {
      if (eng.shot) { if (!eng.runAt) eng.runAt = performance.now() }
      else eng.hintAt = performance.now()
      return
    }
    // le gros ballon : le point touché = l'effet
    const bb = IMG.bigBall
    const dB = Math.hypot(p.x - bb.x, p.y - bb.y)
    if (dB <= bb.r * 1.05) {
      const k = dB > bb.r * 0.9 ? (bb.r * 0.9) / dB : 1
      eng.pick = { i: 0, prec: 1, x: bb.x + (p.x - bb.x) * k, y: bb.y + (p.y - bb.y) * k }
      sfxTick()
      return
    }
    // la flèche part toujours du ballon (au pied du tireur) : on pose le doigt dessus et on tire
    const bs = project(eng.scene, eng.scene.ball0)
    if (Math.hypot(p.x - bs.x, p.y - bs.y) <= 90) {
      e.currentTarget.setPointerCapture(e.pointerId)
      eng.swiping = true
      eng.swipe = [{ x: bs.x, y: bs.y, t: p.t }, p]
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    if (!eng.swiping) return
    const p = toImg(e)
    const lastP = eng.swipe[eng.swipe.length - 1]
    if (Math.hypot(p.x - lastP.x, p.y - lastP.y) >= 4) eng.swipe.push(p)
  }
  const onPointerUp = () => {
    const eng = engineRef.current
    if (!eng.swiping) return
    eng.swiping = false
    const pts = eng.swipe
    eng.swipe = []
    if (eng.phase !== 'aim') return
    const r = pts.length >= 2 ? readSwipe(pts[0], pts[pts.length - 1]) : null
    if (r) eng.shot = r
  }

  // tests automatiques (?debug)
  useEffect(() => {
    if (!location.search.includes('debug')) return
    const w = window as unknown as Record<string, unknown>
    w.__fkBall = () => project(engineRef.current.scene, engineRef.current.scene.ball0)
    w.__fk = {
      start: (goals = 0) => { startGame(); engineRef.current.goals = goals; setupShot() },
      shot: (cx: number, cy: number, dirX: number, power: number) => {
        const eng = engineRef.current; eng.pick = { i: 0, prec: 1, x: IMG.bigBall.x + cx * IMG.bigBall.r, y: IMG.bigBall.y + cy * IMG.bigBall.r }; eng.shot = { dirX, power }; shoot()
      },
      // simulation sans affichage (réglage de la difficulté)
      sim: (goals: number, cx: number, cy: number, dirX: number, power: number) => {
        const eng = engineRef.current
        eng.goals = goals; eng.lives = 99; setupShot()
        eng.pick = { i: 0, prec: 1, x: IMG.bigBall.x + cx * IMG.bigBall.r, y: IMG.bigBall.y + cy * IMG.bigBall.r }; eng.shot = { dirX, power }; shoot()
        for (let i = 0; i < 600 && eng.phase === 'flight'; i++) step(1 / 120)
        return { o: eng.outcome, spot: eng.scene.cfg.ballX }
      },
      path: (cx: number, cy: number, dirX: number, power: number, seed = 3) => {
        const eng = engineRef.current
        eng.lives = 99; eng.seed = seed; eng.goals = 0; setupShot()
        eng.pick = { i: 0, prec: 1, x: IMG.bigBall.x + cx * IMG.bigBall.r, y: IMG.bigBall.y + cy * IMG.bigBall.r }; eng.shot = { dirX, power }; shoot()
        const pts: number[][] = []
        for (let i = 0; i < 600 && eng.phase === 'flight' && eng.flight; i++) { const q = project(eng.scene, flightPos(eng.flight, eng.flight.t)); pts.push([q.x, q.y]); step(1 / 120) }
        return { pts, o: eng.outcome }
      },
      state: () => { const e = engineRef.current; return { phase: e.phase, outcome: e.outcome, goals: e.goals, points: e.points, lives: e.lives, combo: e.combo } },
    }
  })

  const playing = phase === 'playing'
  return (
    <div className={'predictions-screen fk2' + (playing ? ' fk2-fs' : '')}>
      <div className="fk2-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="fk2-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {phase === 'idle' && (
          <div className="fk2-card">
            <p className="fk2-card-title">Coup franc</p>
            <p className="fk2-card-sub">{groupName} · 3 essais · enchaîne les buts pour le combo</p>
            <button className="fk2-cta" onClick={startGame}>▶ JOUER</button>
          </div>
        )}
        {phase === 'over' && (
          <div className="fk2-card">
            <p className="fk2-card-title">{finalPoints.toLocaleString('fr-FR')} pts</p>
            <p className="fk2-card-sub">{finalGoals === 0 ? 'Aucun but cette fois.' : `${finalGoals} but${finalGoals > 1 ? 's' : ''} marqué${finalGoals > 1 ? 's' : ''}`}</p>
            <button className="fk2-cta" onClick={startGame}>▶ REJOUER</button>
            <button className="fk2-link" onClick={onExit}>Retour à l'accueil</button>
          </div>
        )}
        {showRules && (
          <div className="fk2-rules" onClick={() => setShowRules(false)}>
            <div className="fk2-rules-box">
              <p className="fk2-card-title">Comment jouer ?</p>
              <p>1. Touche le gros ballon là où tu veux le frapper : au centre = tir droit, sur le côté = effet (le ballon tourne vers l'autre côté), en bas = il monte, en bas sur le côté = frappe enroulée.</p>
              <p>2. Swipe vers le haut : la direction du swipe = là où le ballon finit ; swipe court = frappe douce et basse, long ou rapide = frappe forte et haute (vers 75 % c'est la lucarne, au-delà de 85 % c'est au-dessus).</p>
              <p>3. Appuie sur TIRER.</p>
              <p>But = 100 pts, lucarne = 200, multipliés par le combo (buts d'affilée, jusqu'à x5). 3 essais : chaque raté coûte un cœur. À chaque but, le tir recule et le gardien devient plus vif.</p>
              <button className="fk2-cta" onClick={() => setShowRules(false)}>OK</button>
            </div>
          </div>
        )}
      </div>

      {!playing && (allTimeBest || lastWeekBest || scores.length > 0) && (
        <button type="button" className="dribble-rules-toggle fk2-board-toggle" onClick={() => setShowBoard((v) => !v)}>
          {showBoard ? 'Masquer le classement ▲' : '🏆 Voir le classement ▼'}
        </button>
      )}
      {!playing && showBoard && (allTimeBest || lastWeekBest) && (
        <div className="juggle-palmares">
          <p className="predictions-period">🏆 Palmarès</p>
          {allTimeBest && <p className="juggle-palmares-row">Record du groupe : <b>{allTimeBest.score}</b> ({allTimeBest.pseudo})</p>}
          {lastWeekBest && <p className="juggle-palmares-row">Édition précédente : <b>{lastWeekBest.score}</b> ({lastWeekBest.pseudo})</p>}
        </div>
      )}
      {!playing && showBoard && scores.length > 0 && (
        <div className="roulette-teammates">
          <p className="predictions-period">Meilleurs scores de la semaine :</p>
          <ul className="matches-list">
            {scores.map((s, i) => (
              <li className="match-card roulette-teammate-card" key={s.profile_id}>
                <span>{i + 1}. {s.pseudo}</span>
                <span className="roulette-teammate-team">{s.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// type de frappe selon le point touché sur le gros ballon
type ShotKind = 'straight' | 'side' | 'curler' | 'lob'
const SHOT_NAME: Record<ShotKind, string> = { straight: 'Tir droit', side: 'Effet', curler: 'Frappe enroulée', lob: 'Ballon piqué' }
export function shotKind(cx: number, cy: number): ShotKind {
  if (cy > 0.5 && Math.abs(cx) < 0.4) return 'lob'
  if (cy > 0.25 && Math.abs(cx) >= 0.4) return 'curler'
  if (Math.abs(cx) >= 0.25) return 'side'
  return 'straight'
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}

// cœur (plein = essai restant, contour doré = essai perdu), comme sur l'image
function drawHeart(c: CanvasRenderingContext2D, x: number, y: number, r: number, full: boolean) {
  c.save(); c.translate(x, y)
  c.beginPath()
  c.moveTo(0, r * 0.95)
  c.bezierCurveTo(-r * 1.25, r * 0.15, -r * 1.05, -r * 0.95, 0, -r * 0.4)
  c.bezierCurveTo(r * 1.05, -r * 0.95, r * 1.25, r * 0.15, 0, r * 0.95)
  c.closePath()
  if (full) {
    const g = c.createLinearGradient(0, -r, 0, r)
    g.addColorStop(0, '#ff5b5b'); g.addColorStop(1, '#b3121c')
    c.fillStyle = g; c.fill()
    c.strokeStyle = '#5a0a0a'; c.lineWidth = 2; c.stroke()
  } else {
    c.strokeStyle = '#e2b860'; c.lineWidth = 3; c.stroke()
  }
  c.restore()
}
