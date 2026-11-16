import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from './supabaseClient'
import { previousGameWeek } from './minigameWeeks'
import { useAuth } from './AuthContext'
import { useWizzChannel } from './wizzChannel'
import { dribbleSpriteVars } from './dribblePixel'
import './dribble-pixel.css'
import plateSrc from './assets/freekick/plate.png'
import shooterSrc from './assets/freekick/shooter.png'
import wallSrc from './assets/freekick/wall.png'
import keeperSrc from './assets/freekick/keeper.png'
import ballSrc from './assets/freekick/ball.png'

// images en pixels (tribunes, tireur n°10, joueur du mur, gardien, ballon), découpés dans la vidéo de référence
const fkImgs = (() => {
  let c: { plate: HTMLImageElement; shooter: HTMLImageElement; wall: HTMLImageElement; keeper: HTMLImageElement; ball: HTMLImageElement } | null = null
  return () => {
    if (c) return c
    const load = (src: string) => { const im = new Image(); im.src = src; return im }
    c = { plate: load(plateSrc), shooter: load(shooterSrc), wall: load(wallSrc), keeper: load(keeperSrc), ball: load(ballSrc) }
    return c
  }
})()
function fkRound(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}
// planches découpées dans la vidéo de référence (px de l'image 720 de large = 2 px logiques)
const SHOOT_FW = 177, SHOOT_FH = 205   // tireur : debout, élan, frappe, joie (pieds en bas du cadre)
const WALL_FW = 52, WALL_FH = 114       // 4 joueurs du mur
const PLATE_W = 720, PLATE_H = 710      // l'image de la vidéo (décor sans joueurs ni ballon)

// ============================================================================
// Coup franc — mini-jeu hebdomadaire.
//
// Vue en perspective derrière le ballon. Un seul geste : on glisse du ballon
// vers l'endroit du but où l'on veut envoyer la balle.
//  - le point où le doigt se lève = la cible dans le plan du but (x, hauteur)
//  - la courbure du geste = l'effet : un geste en arc vers la droite fait
//    partir le ballon à droite puis revenir (il contourne le mur)
// La trajectoire est calculée pour arriver EXACTEMENT sur la cible visée
// (gravité + effet compris) : ce qui compte, c'est la précision du geste, pas
// le hasard. Le mur (qui saute plus tard dans la partie) et le gardien (de
// plus en plus vif) font le reste. La série de coups francs est la même pour
// tout le monde pendant la semaine (tirage déterministe), pour un classement
// équitable.
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
const WALL_HEIGHT = 2.0 // (joueurs dessinés un peu plus grands que nature, comme la vidéo)
const WALL_JUMP = 0.38
const KEEPER_LINE_OFFSET = 0.3 // le gardien se tient 30 cm devant sa ligne
const MAX_CURL_ACCEL = 5.5 // m/s², effet maximal
const MAX_SCORE = 2000

// ---- caméra / écran (unités logiques : largeur fixe 360) ----
const LW = 360
// cadrage repris de la vidéo de référence : caméra haute et reculée, but au centre
// caméra (orientation de la frappe ; l'affichage suit l'image de la vidéo, voir imgMap)
const CAM_BACK = 40
const CAM_H = 6.5
const TOUCH_RADIUS = 75 // px logiques autour du ballon pour lancer le geste

function monday(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return d.toISOString().slice(0, 10)
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

interface ShotConfig {
  ballX: number // position latérale du ballon (centre du but = 0)
  dist: number // distance à la ligne de but
  nearSide: number // -1 / +1 : côté du poteau couvert par le mur
  wallCount: number
  wallJumps: boolean
  keeperSpeed: number
  keeperReaction: number
  keeperReach: number
}

// ---- paliers : la distance monte avec les buts, chaque palier ajoute une difficulté ----
//  1. 17-18 m : mur de 3, gardien lent (apprentissage)
//  2. 19-21 m : mur de 4, gardien normal, on peut contourner le mur
//  3. 22-24 m : le mur saute, gardien plus rapide
//  4. 25-27 m : ballon décalé à gauche ou à droite
//  5. 28 m+   : très difficile (gros mur, gardien vif qui couvre plus) : il faut une grosse courbe dans les lucarnes
// Simulation (tous les tirs cible x hauteur x effet x puissance) : ~18 %, ~11,5 %, ~6 %, ~3 %, ~1,3 % de tirs possibles.
const STAGES = [
  { from: 0, dMin: 17, dMax: 18, walls: 3, jump: 0, kSpeed: 1.4, kReact: 0.55, lat: [0, 1.5], reach: 1.0, info: 'Apprentissage' },
  { from: 3, dMin: 19, dMax: 21, walls: 4, jump: 0, kSpeed: 2.0, kReact: 0.45, lat: [0, 2.5], reach: 1.0, info: 'Mur de 4 : contourne-le' },
  { from: 7, dMin: 22, dMax: 24, walls: 4, jump: 1, kSpeed: 2.5, kReact: 0.37, lat: [0, 2.5], reach: 1.05, info: 'Le mur saute, gardien plus vif' },
  { from: 11, dMin: 25, dMax: 27, walls: 4, jump: 0.7, kSpeed: 2.8, kReact: 0.33, lat: [4, 8], reach: 1.05, info: 'Ballon décalé sur le côté' },
  { from: 15, dMin: 28, dMax: 32, walls: 5, jump: 1, kSpeed: 3.2, kReact: 0.29, lat: [0, 8], reach: 1.12, info: 'Grosse courbe et lucarnes !' },
]
const stageOf = (goals: number) => { let k = 0; STAGES.forEach((st, i) => { if (goals >= st.from) k = i }); return k + 1 }

function shotConfig(weekSeed: number, n: number): ShotConfig {
  const lv = stageOf(n)
  const st = STAGES[lv - 1]
  const next = STAGES[lv]
  const r = mulberry32(weekSeed + n * 7919)
  const side = r() < 0.5 ? -1 : 1
  const lateral = st.lat[0] + r() * (st.lat[1] - st.lat[0])
  const ballX = side * lateral
  // la distance avance dans le palier (dernier palier : +0,25 m par but, jusqu'à 32 m)
  const span = next ? next.from - st.from : 16
  const u = Math.min(1, (n - st.from) / Math.max(1, span - 1))
  const dist = Math.min(st.dMax, st.dMin + u * (st.dMax - st.dMin) + (r() - 0.5) * 0.6)
  return {
    ballX,
    dist: Math.max(st.dMin, dist),
    nearSide: lateral < 1 ? side : Math.sign(ballX),
    wallCount: st.walls,
    wallJumps: r() < st.jump,
    keeperSpeed: st.kSpeed,
    keeperReaction: st.kReact,
    keeperReach: st.reach,
  }
}

const levelOf = stageOf
// jauge de puissance : monte en ~1 s puis redescend (aller-retour tant qu'on garde le doigt posé)
const GAUGE_UP = 1.3
const gaugeAt = (heldMs: number) => { const u = (heldMs / 1000 / GAUGE_UP) % 2; return u < 1 ? u : 2 - u }
// réglages « extra » du tir : la cible bonus (+3), plus petite aux paliers élevés
function extrasFor(level: number, r: () => number) {
  return {
    target: { x: (r() * 2 - 1) * (GOAL_HALF_W - 0.7), y: 0.55 + r() * (GOAL_H - 1.0), r: Math.max(0.32, 0.55 - level * 0.04) },
    keeperDance: 0,
    danceFreq: 0,
    wind: 0,
    wallSlide: false,
    shotClock: 0,
    dancePhase: 0,
  }
}
type Extras = ReturnType<typeof extrasFor>

// ---- géométrie d'un coup franc (dérivée de la config) ----
interface Scene {
  cfg: ShotConfig
  ball0: Vec3
  cam: { x: number; y: number; z: number; sin: number; cos: number }
  hc: { x: number; z: number } // direction ballon -> poteau couvert
  w: { x: number; z: number } // perpendiculaire (droite)
  wallLats: number[] // positions latérales des joueurs du mur (le long de w)
  keeperX0: number
}

function buildScene(cfg: ShotConfig): Scene {
  const ball0 = { x: cfg.ballX, y: BALL_R, z: 0 } // centre du ballon
  // caméra derrière le ballon, orientée vers le centre du but
  let fx = -cfg.ballX, fz = cfg.dist
  const fl = Math.hypot(fx, fz)
  fx /= fl; fz /= fl
  const cam = { x: ball0.x - fx * CAM_BACK, y: CAM_H, z: -fz * CAM_BACK, sin: fx, cos: fz }
  // mur : à 9,15 m sur la ligne ballon -> poteau couvert, bord extérieur
  // 35 cm au-delà de cette ligne, puis les joueurs vers l'intérieur
  let hx = cfg.nearSide * GOAL_HALF_W - ball0.x, hz = cfg.dist
  const hl = Math.hypot(hx, hz)
  hx /= hl; hz /= hl
  const w = { x: hz, z: -hx }
  const outward = Math.sign(w.x) * cfg.nearSide || 1
  const wallLats = Array.from({ length: cfg.wallCount }, (_, k) => outward * (0.35 - WALL_PLAYER_HALF_W - k * 0.55))
  return { cfg, ball0, cam, hc: { x: hx, z: hz }, w, wallLats, keeperX0: -cfg.nearSide * 0.6 }
}

// ---- projection sur l'image de la vidéo (coordonnées de l'image 720 px, puis /2) ----
// Repères mesurés sur l'image : ballon (345, 591), pieds du mur y = 487, ligne de but
// y = 395, poteaux x = 210 et 556 (but de 346 px), transversale y = 278.
// u = avancement ballon -> but (0..1) ; le mur est toujours à la même place à l'écran.
const IMG = { ballX: 345, ballY: 599, wallY: 487, goalY: 395, goalX: 383 }
const SX = [95, 82, 47.3]   // px d'image par mètre (latéral) : ballon, mur, but
const SY = [65, 57, 48]     // px d'image par mètre (hauteur)
function imgMap(sc: Scene, z: number) {
  const D = sc.cfg.dist
  const u = Math.max(-0.5, Math.min(1.3, z / D))
  const uw = WALL_DIST / D
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  let yg: number, sx: number, sy: number
  if (u <= uw) { const t = u / uw; yg = lerp(IMG.ballY, IMG.wallY, t); sx = lerp(SX[0], SX[1], t); sy = lerp(SY[0], SY[1], t) }
  else { const t = (u - uw) / (1 - uw); yg = lerp(IMG.wallY, IMG.goalY, t); sx = lerp(SX[1], SX[2], t); sy = lerp(SY[1], SY[2], t) }
  // ballon décalé sur le côté (palier 4) : il se décale un peu à l'écran
  const xb = IMG.ballX + sc.cfg.ballX * 12
  return { u, yg, sx, sy, xc: lerp(xb, IMG.goalX, u), xRef: lerp(sc.cfg.ballX, 0, u) }
}
// oy = haut de l'image dans le canvas (px logiques) ; k = px logiques par mètre (hauteur)
function project(sc: Scene, p: Vec3, _cx: number, oy: number) {
  const m = imgMap(sc, p.z)
  return { x: (m.xc + (p.x - m.xRef) * m.sx) / 2, y: oy + (m.yg - p.y * m.sy) / 2, depth: 50 + m.u * 30, k: m.sy / 2 }
}

// point de l'écran -> point visé dans le plan du but
function unprojectToGoalPlane(sc: Scene, sx: number, sy: number, _cx: number, oy: number): Vec3 {
  const ix = sx * 2, iy = (sy - oy) * 2
  // y < 0 : le doigt est levé sous la ligne de but -> tir à ras de terre
  return { x: (ix - IMG.goalX) / SX[2], y: Math.max(-2, Math.min(6, (IMG.goalY - iy) / SY[2])), z: sc.cfg.dist }
}

type Outcome = 'goal' | 'lucarne' | 'cible' | 'wall' | 'saved' | 'post' | 'bar' | 'wide' | 'over' | 'late'

interface Flight {
  // trajectoire analytique : pos(t) = o + v t + ½ a t²
  o: Vec3; v: Vec3; a: Vec3; t: number
  prevDepth: number // distance le long de hc au pas précédent (passage du mur)
  trail: Vec3[]
}

interface FreeBall {
  p: Vec3; v: Vec3; t: number
}

interface Engine {
  phase: 'idle' | 'aim' | 'flight' | 'after' | 'next' | 'over'
  weekSeed: number
  goals: number
  points: number
  scene: Scene
  flight: Flight | null
  free: FreeBall | null
  outcome: Outcome | null
  outcomeAt: number
  keeperX: number
  keeperJump: number
  wallJumpT: number // temps depuis la frappe (pour l'animation du saut)
  netHit: Vec3 | null
  swipe: { x: number; y: number; t: number }[]
  swiping: boolean
  chargeAt: number // début du défilement de la barre de puissance
  power: number | null // puissance choisie (barre arrêtée) : le tireur prend son élan
  // tir tracé (étape 1) : cible + effet, et le tracé du doigt affiché pendant la puissance
  aimShot: { target: Vec3; curl: number; path: { x: number; y: number }[] } | null
  runAt: number // début de l'élan (la frappe part 0,35 s après)
  particles: { x: number; y: number; vx: number; vy: number; life: number; c: string }[]
  msg: { text: string; sub: string; color: string; at: number; ribbon?: string } | null
  spin: number
  crowd: { x: number; y: number; c: string }[]
  lastW: number
  lastH: number
  audio: AudioContext | null
  level: number
  ex: Extras
  aimAt: number
  wallShift: number
  bannerAt: number
  kickAt: number
}

function newEngine(seed: number): Engine {
  const cfg = shotConfig(seed, 0)
  return {
    phase: 'idle', weekSeed: seed, goals: 0, points: 0,
    scene: buildScene(cfg), flight: null, free: null, outcome: null, outcomeAt: 0,
    keeperX: -cfg.nearSide * 0.6, keeperJump: 0, wallJumpT: -1, netHit: null,
    swipe: [], swiping: false, chargeAt: 0, power: null, aimShot: null, runAt: 0, particles: [], msg: null, spin: 0,
    crowd: [], lastW: 0, lastH: 0, audio: null,
    level: 1, ex: extrasFor(1, mulberry32(seed)), aimAt: 0, wallShift: 0, bannerAt: -1e9, kickAt: -1e9,
  }
}

const OUTCOME_TEXT: Record<Outcome, { text: string; color: string }> = {
  goal: { text: 'BUT !', color: '#D4A22C' },
  cible: { text: 'DANS LA CIBLE !', color: '#ffd84a' },
  late: { text: 'Trop tard !', color: '#F4EFE2' },
  lucarne: { text: 'LUCARNE !', color: '#D4A22C' },
  wall: { text: 'Dans le mur !', color: '#F4EFE2' },
  saved: { text: 'Arrêt du gardien !', color: '#F4EFE2' },
  post: { text: 'Poteau !', color: '#F4EFE2' },
  bar: { text: 'Transversale !', color: '#F4EFE2' },
  wide: { text: 'À côté !', color: '#F4EFE2' },
  over: { text: 'Au-dessus !', color: '#F4EFE2' },
}

export default function FreeKickGame({ groupId, groupName, autoApplyAllLeagues, onExit }: Props) {
  const { user } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine>(newEngine(hashString('coup-franc:' + monday())))

  const [phase, setPhase] = useState<'idle' | 'playing' | 'over'>('idle')
  const [nextCard, setNextCard] = useState<{ dist: number; level: number; info: string } | null>(null)
  const [points, setPoints] = useState(0)
  const [goals, setGoals] = useState(0)
  const [distance, setDistance] = useState(Math.round(engineRef.current.scene.cfg.dist))
  const [finalPoints, setFinalPoints] = useState(0)
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
      if (!eng.audio) eng.audio = new (window.AudioContext || (window as any).webkitAudioContext)()
      else if (eng.audio.state === 'suspended') eng.audio.resume()
    } catch { /* pas de son */ }
  }
  const tone = (freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) => {
    const ctx = engineRef.current.audio
    if (!ctx) return
    try {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
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
      const src = ctx.createBufferSource()
      src.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = freq
      filter.Q.value = q
      const gain = ctx.createGain()
      const t0 = ctx.currentTime
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      src.connect(filter).connect(gain).connect(ctx.destination)
      src.start(t0)
      src.stop(t0 + dur + 0.05)
    } catch { /* ignore */ }
  }
  const sfxWhistle = () => { tone(2300, 0.12, 'sine', 0.08); tone(2300, 0.22, 'sine', 0.08, 0.16) }
  const sfxKick = () => { tone(140, 0.12, 'sine', 0.35, 0, 60); noise(0.06, 0.2, 2200, 1.2) }
  const sfxNet = () => noise(0.35, 0.18, 3000, 0.5)
  const sfxRoar = () => noise(1.4, 0.32, 900, 0.5)
  const sfxClang = () => { tone(1250, 0.5, 'triangle', 0.18); tone(1870, 0.4, 'triangle', 0.1) }
  const sfxThud = () => tone(110, 0.18, 'sine', 0.3, 0, 70)
  const sfxGroan = () => { noise(0.7, 0.14, 500, 0.6); tone(220, 0.5, 'sawtooth', 0.05, 0, 150) }
  const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p) } catch { /* ignore */ } }

  // ------------------------------------------------------- mise en page ----
  const layout = () => {
    const eng = engineRef.current
    const lh = eng.lastH || 540
    // l'image de la vidéo (370 px logiques de haut) un peu au-dessus du centre ;
    // au-dessus le ciel du stade, en dessous la pelouse continue
    const hy = Math.max(0, Math.round((lh - PLATE_H / 2) * 0.45))
    return { cx: LW / 2, hy, lh }
  }

  const ballScreen = () => {
    const eng = engineRef.current
    const { cx, hy } = layout()
    return project(eng.scene, eng.scene.ball0, cx, hy)
  }

  // ----------------------------------------------------------- partie -----
  const setupShot = () => {
    const eng = engineRef.current
    const cfg = shotConfig(eng.weekSeed, eng.goals)
    eng.scene = buildScene(cfg)
    eng.flight = null
    eng.free = null
    eng.outcome = null
    eng.netHit = null
    eng.keeperX = eng.scene.keeperX0
    eng.keeperJump = 0
    eng.wallJumpT = -1
    eng.swipe = []
    eng.swiping = false
    eng.power = null
    eng.aimShot = null
    eng.msg = null
    eng.phase = 'aim'
    const lv = levelOf(eng.goals)
    if (eng.goals === 0) eng.bannerAt = performance.now()
    eng.level = lv
    eng.ex = extrasFor(lv, mulberry32(eng.weekSeed + eng.goals * 104729 + 17))
    // la cible n'est jamais collée au gardien au départ (sinon elle est injouable)
    {
      const tg = eng.ex.target, kx = eng.scene.keeperX0
      if (Math.abs(tg.x - kx) < 1.3) tg.x = Math.max(-(GOAL_HALF_W - 0.7), Math.min(GOAL_HALF_W - 0.7, kx + (tg.x >= kx ? 1 : -1) * 1.3))
      if (Math.abs(tg.x - kx) < 1.3) tg.x = kx + (kx > 0 ? -1.6 : 1.6)
    }
    eng.aimAt = performance.now()
    eng.wallShift = 0
    eng.keeperX = eng.scene.keeperX0
    setDistance(Math.round(cfg.dist))
    sfxWhistle()
  }

  const startGame = () => {
    ensureAudio()
    const eng = engineRef.current
    // chaque partie est différente (même difficulté pour tous à chaque niveau)
    eng.weekSeed = (Math.random() * 4294967296) >>> 0
    eng.level = 1
    eng.goals = 0
    eng.points = 0
    eng.particles = []
    setPoints(0)
    setGoals(0)
    setPhase('playing')
    setNextCard(null)
    wrapperRef.current?.classList.add('dribble-locked')
    setupShot()
    if (user) {
      sendOnWizzChannel('playing', { action: 'start', profileId: user.id, pseudo: myPseudo || 'Un coéquipier', game: 'coup-franc' })
      supabase.rpc('notify_freekick_start', { p_group_id: groupId }).then(() => {})
    }
  }

  const endGame = () => {
    const eng = engineRef.current
    eng.phase = 'over'
    eng.msg = null
    wrapperRef.current?.classList.remove('dribble-locked')
    const final = Math.min(eng.points, MAX_SCORE)
    setFinalPoints(final)
    setPhase('over')
    if (!user) return
    sendOnWizzChannel('playing', { action: 'stop', profileId: user.id })
    const save = autoApplyAllLeagues
      ? supabase.rpc('submit_freekick_score_all_leagues', { p_score: final })
      : supabase.from('freekick_scores').insert({ group_id: groupId, profile_id: user.id, week_start: monday(), score: final })
    save.then(() => loadScores())
  }

  // Frappe : cible = point visé dans le plan du but ; effet = courbure du geste
  const shoot = (aimed: Vec3, curl: number, power: number) => {
    let target = aimed
    const eng = engineRef.current
    const sc = eng.scene
    const b = sc.ball0
    const horiz = Math.hypot(target.x - b.x, target.z - b.z)
    // viser sous la ligne de but = frappe à ras de terre, plus rapide : elle
    // ne passe pas au-dessus du mur, mais passe DESSOUS quand il saute
    const grounder = target.y < BALL_R * 0.5
    const T = grounder ? 0.45 + horiz * 0.014 : 0.55 + horiz * 0.018
    if (grounder) target = { ...target, y: BALL_R }
    // effet : accélération latérale perpendiculaire à la direction de frappe
    const hx = (target.x - b.x) / horiz, hz = (target.z - b.z) / horiz
    const nx = hz, nz = -hx
    const a = { x: -curl * MAX_CURL_ACCEL * nx, y: grounder ? 0 : -G, z: -curl * MAX_CURL_ACCEL * nz }
    // on vise une zone : l'effet n'est compensé qu'à 70 %, le reste fait dévier
    // le ballon (jusqu'à ~1 m) ; la puissance de la jauge change un peu la
    // vitesse : fort = arrive plus tôt donc plus haut, faible = plus bas
    const CURL_COMP = 0.7
    const s = 0.92 + 0.16 * power
    const v = {
      x: ((target.x - b.x) / T - 0.5 * a.x * T * CURL_COMP) * s,
      y: (target.y - b.y) / T - 0.5 * a.y * T,
      z: ((target.z - b.z) / T - 0.5 * a.z * T * CURL_COMP) * s,
    }
    a.x += eng.ex.wind                       // le vent pousse le ballon (à toi de compenser)
    eng.flight = { o: { ...b }, v, a, t: 0, prevDepth: 0, trail: [] }
    eng.phase = 'flight'
    eng.wallJumpT = 0
    eng.kickAt = performance.now()
    sfxKick()
    vibrate(15)
  }

  const flightPos = (f: Flight, t: number): Vec3 => ({
    x: f.o.x + f.v.x * t + 0.5 * f.a.x * t * t,
    y: f.o.y + f.v.y * t + 0.5 * f.a.y * t * t,
    z: f.o.z + f.v.z * t + 0.5 * f.a.z * t * t,
  })
  const flightVel = (f: Flight, t: number): Vec3 => ({
    x: f.v.x + f.a.x * t, y: f.v.y + f.a.y * t, z: f.v.z + f.a.z * t,
  })

  // hauteur des pieds du mur (0 au sol, jusqu'à WALL_JUMP en plein saut)
  const wallLift = (t: number) => {
    const eng = engineRef.current
    if (!eng.scene.cfg.wallJumps || t < 0.16) return 0
    const u = (t - 0.16) / 0.55
    return u >= 1 ? 0 : WALL_JUMP * Math.sin(Math.PI * u)
  }
  const wallTop = (t: number) => WALL_HEIGHT + wallLift(t)

  const resolve = (outcome: Outcome, p: Vec3, v: Vec3) => {
    const eng = engineRef.current
    eng.outcome = outcome
    eng.outcomeAt = performance.now()
    eng.phase = 'after'
    let nv: Vec3
    switch (outcome) {
      case 'goal':
      case 'lucarne':
      case 'cible':
        nv = { x: v.x * 0.25, y: v.y * 0.2, z: v.z * 0.12 }
        eng.netHit = { ...p }
        break
      case 'wall':
        nv = { x: v.x * 0.3 + (Math.random() - 0.5) * 2, y: 2.2, z: -v.z * 0.22 }
        break
      case 'saved':
        nv = { x: (p.x - eng.keeperX) * 3 + v.x * 0.2, y: Math.abs(v.y) * 0.3 + 1.5, z: -v.z * 0.25 }
        break
      case 'post':
        nv = { x: -v.x * 0.5 + Math.sign(p.x) * -2, y: v.y * 0.6, z: -v.z * 0.35 }
        break
      case 'bar':
        nv = { x: v.x * 0.5, y: -Math.abs(v.y) * 0.3 + 3, z: -v.z * 0.35 }
        break
      default:
        nv = { ...v }
    }
    eng.free = { p: { ...p }, v: nv, t: 0 }

    const txt = OUTCOME_TEXT[outcome]
    const isGoal = outcome === 'goal' || outcome === 'lucarne' || outcome === 'cible'
    if (isGoal) {
      const pts = outcome === 'cible' ? 3 : outcome === 'lucarne' ? 2 : 1
      eng.goals += 1
      eng.points += pts
      setGoals(eng.goals)
      setPoints(eng.points)
      eng.msg = { text: 'BUT !', ribbon: outcome === 'goal' ? '' : txt.text, sub: `+${pts} PT${pts > 1 ? 'S' : ''}`, color: '#ffd84a', at: performance.now() }
      sfxNet(); sfxRoar(); vibrate([30, 40, 60])
      // confettis
      const { cx, hy } = layout()
      const sp = project(eng.scene, p, cx, hy)
      const colors = ['#D4A22C', '#F4EFE2', '#2F8F5B', '#C1443C']
      for (let i = 0; i < 70; i++) {
        const ang = Math.random() * Math.PI * 2
        const spd = 60 + Math.random() * 220
        eng.particles.push({ x: sp.x, y: sp.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 120, life: 1.2 + Math.random() * 0.6, c: colors[i % colors.length] })
      }
    } else {
      eng.msg = { text: txt.text, sub: '', color: txt.color, at: performance.now() }
      if (outcome === 'post' || outcome === 'bar') sfxClang()
      else if (outcome === 'wall' || outcome === 'saved') sfxThud()
      sfxGroan()
      vibrate(80)
    }
  }

  // --------------------------------------------------------- simulation ---
  const step = (dt: number) => {
    const eng = engineRef.current
    const sc = eng.scene
    eng.spin += dt * (eng.phase === 'flight' ? 22 : 4)

    // particules
    for (const p of eng.particles) {
      p.vy += 420 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.life -= dt
    }
    eng.particles = eng.particles.filter((p) => p.life > 0)

    // puissance choisie : petit élan du tireur, puis frappe
    if (eng.phase === 'aim' && eng.aimShot && eng.power !== null && performance.now() - eng.runAt > 350) {
      const a = eng.aimShot
      shoot(a.target, a.curl, eng.power)
      return
    }
    // avant la frappe : le gardien bouge (niveau 3+) ; chrono de tir (niveau 6+)
    if (eng.phase === 'aim') {
      const tAim = (performance.now() - eng.aimAt) / 1000
      if (eng.ex.keeperDance) eng.keeperX = sc.keeperX0 + Math.sin(tAim * eng.ex.danceFreq + eng.ex.dancePhase) * eng.ex.keeperDance
      if (eng.ex.shotClock && tAim > eng.ex.shotClock && !eng.swiping) { resolve('late', sc.ball0, { x: 0, y: 0, z: 0 }); return }
    }
    if (eng.phase === 'flight' && eng.flight) {
      const f = eng.flight
      // le mur se décale vers le côté où part le ballon (niveau 5+)
      if (eng.ex.wallSlide && f.t > 0.08) {
        const v0 = f.v.x * sc.w.x + f.v.z * sc.w.z
        const want = Math.sign(v0) * 0.45
        eng.wallShift += (want - eng.wallShift) * Math.min(1, dt * 7)
      }
      const SUB = 8
      for (let i = 0; i < SUB && eng.phase === 'flight'; i++) {
        const t0 = f.t
        const t1 = t0 + dt / SUB
        const p0 = flightPos(f, t0)
        const p1 = flightPos(f, t1)
        f.t = t1
        eng.wallJumpT = t1

        // --- gardien : réagit après son temps de réaction, anticipe sans
        // tenir compte de l'effet restant (c'est ce qui rend l'enroulé dur à lire)
        if (t1 > sc.cfg.keeperReaction) {
          const v = flightVel(f, t1)
          const remain = Math.max(0.05, (sc.cfg.dist - p1.z) / Math.max(1, v.z))
          const px = p1.x + v.x * remain
          const py = p1.y + v.y * remain - 0.5 * G * remain * remain
          const target = Math.max(-GOAL_HALF_W, Math.min(GOAL_HALF_W, px))
          const dx = target - eng.keeperX
          const maxMove = sc.cfg.keeperSpeed * (dt / SUB)
          eng.keeperX += Math.max(-maxMove, Math.min(maxMove, dx))
          const wantJump = py > 1.7 ? Math.min(0.45, (py - 1.7) * 0.6) : 0
          eng.keeperJump += (wantJump - eng.keeperJump) * Math.min(1, (dt / SUB) * 6)
        }

        // --- mur : passage du plan du mur (distance le long de hc)
        const d0 = (p0.x - sc.ball0.x) * sc.hc.x + (p0.z - sc.ball0.z) * sc.hc.z
        const d1 = (p1.x - sc.ball0.x) * sc.hc.x + (p1.z - sc.ball0.z) * sc.hc.z
        if (d0 < WALL_DIST && d1 >= WALL_DIST) {
          const u = (WALL_DIST - d0) / (d1 - d0)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, z: p0.z + (p1.z - p0.z) * u }
          const lat = (pc.x - sc.ball0.x) * sc.w.x + (pc.z - sc.ball0.z) * sc.w.z
          const top = wallTop(t1)
          const inWall = sc.wallLats.some((l) => Math.abs(lat - (l + eng.wallShift)) <= WALL_PLAYER_HALF_W + BALL_R)
          const under = pc.y + BALL_R < wallLift(t1) // passe sous le mur qui saute
          if (inWall && pc.y <= top + BALL_R && !under) {
            resolve('wall', pc, flightVel(f, t1))
            break
          }
        }

        // --- sol avant le but : rebond (le tir rasant existe, mais il faut
        // passer à côté du mur)
        if (p1.y < BALL_R && p1.z < sc.cfg.dist - 0.5) {
          const v = flightVel(f, t1)
          f.o = { x: p1.x, y: BALL_R, z: p1.z }
          f.v = { x: v.x * 0.78, y: Math.abs(v.y) * 0.45, z: v.z * 0.78 }
          f.a = { x: f.a.x * 0.4, y: -G, z: f.a.z * 0.4 }
          f.t = 0
          sfxThud()
          continue
        }

        // --- plan du gardien
        const kz = sc.cfg.dist - KEEPER_LINE_OFFSET
        if (p0.z < kz && p1.z >= kz) {
          const u = (kz - p0.z) / (p1.z - p0.z)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, z: kz }
          const dx = pc.x - eng.keeperX
          const reachX = sc.cfg.keeperReach
          const reachY = 2.35 + eng.keeperJump
          const ny = Math.max(0, pc.y - 0.9) / (reachY - 0.9)
          if ((dx / reachX) ** 2 + ny * ny <= 1 && pc.y >= -0.1) {
            resolve('saved', pc, flightVel(f, t1))
            break
          }
        }

        // --- ligne de but
        const gz = sc.cfg.dist
        if (p0.z < gz && p1.z >= gz) {
          const u = (gz - p0.z) / (p1.z - p0.z)
          const pc = { x: p0.x + (p1.x - p0.x) * u, y: Math.max(BALL_R, p0.y + (p1.y - p0.y) * u), z: gz }
          const v = flightVel(f, t1)
          const ax = Math.abs(pc.x)
          const nearPost = Math.abs(ax - GOAL_HALF_W) <= BALL_R + POST_R && pc.y <= GOAL_H + POST_R
          const nearBar = Math.abs(pc.y - GOAL_H) <= BALL_R + POST_R && ax <= GOAL_HALF_W + POST_R
          if (nearBar && !(ax < GOAL_HALF_W - BALL_R && pc.y < GOAL_H - BALL_R)) {
            resolve('bar', pc, v)
          } else if (nearPost && !(ax < GOAL_HALF_W - BALL_R)) {
            resolve('post', pc, v)
          } else if (ax < GOAL_HALF_W - BALL_R && pc.y < GOAL_H - BALL_R) {
            const tg = eng.ex.target
            const inTarget = Math.hypot(pc.x - tg.x, pc.y - tg.y) <= tg.r
            const lucarne = ax > GOAL_HALF_W - 1.1 && pc.y > 1.6
            resolve(inTarget ? 'cible' : lucarne ? 'lucarne' : 'goal', pc, v)
          } else if (pc.y >= GOAL_H - BALL_R && ax < GOAL_HALF_W + 1.5) {
            resolve('over', pc, v)
          } else {
            resolve('wide', pc, v)
          }
          break
        }

        if (f.t > 4) { resolve('wide', p1, flightVel(f, t1)); break }
      }
      if (eng.flight && eng.phase === 'flight') {
        const p = flightPos(f, f.t)
        f.trail.push(p)
        if (f.trail.length > 18) f.trail.shift()
      }
    } else if (eng.phase === 'after' && eng.free) {
      // balle libre après l'issue : gravité, filet, rebonds
      const fb = eng.free
      fb.t += dt
      fb.v.y -= G * dt
      fb.p.x += fb.v.x * dt
      fb.p.y += fb.v.y * dt
      fb.p.z += fb.v.z * dt
      const isGoal = eng.outcome === 'goal' || eng.outcome === 'lucarne' || eng.outcome === 'cible'
      if (isGoal && fb.p.z > sc.cfg.dist + 1.6) { fb.p.z = sc.cfg.dist + 1.6; fb.v.z = 0; fb.v.x *= 0.5 }
      if (fb.p.y < BALL_R) { fb.p.y = BALL_R; fb.v.y = Math.abs(fb.v.y) * 0.4; fb.v.x *= 0.7; fb.v.z *= 0.7 }
      // le gardien retombe
      eng.keeperJump *= Math.max(0, 1 - dt * 4)

      const elapsed = (performance.now() - eng.outcomeAt) / 1000
      if (elapsed > (isGoal ? 1.7 : 1.5)) {
        if (isGoal) {
          eng.phase = 'next'
          eng.msg = null
          const cfgN = shotConfig(eng.weekSeed, eng.goals)
          const lvN = stageOf(eng.goals)
          setNextCard({ dist: Math.round(cfgN.dist), level: lvN, info: lvN > eng.level ? STAGES[lvN - 1].info : '' })
        } else endGame()
      }
    }
  }

  // ------------------------------------------------------------ rendu ------
  // world = décor + joueurs (dessiné en basse résolution => pixel art) ; ui = textes, geste, bandeaux (net)
  const drawScene = (world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D, flush: () => void) => {
    let ctx = world
    const eng = engineRef.current
    const sc = eng.scene
    const { cx, hy, lh } = layout()
    const P = (p: Vec3) => project(sc, p, cx, hy)
    const now = performance.now()

    const D = sc.cfg.dist
    // décor = l'image de la vidéo telle quelle (sans joueurs ni ballon)
    const plate = fkImgs().plate
    ctx.fillStyle = '#0a1622'; ctx.fillRect(0, 0, LW, lh)
    if (plate.complete && plate.naturalWidth) {
      const ph = PLATE_H / 2
      // ciel au-dessus : la 1re rangée de l'image étirée ; pelouse en dessous : les dernières bandes répétées
      if (hy > 0) {
        const g = ctx.createLinearGradient(0, 0, 0, hy)
        g.addColorStop(0, '#03070d'); g.addColorStop(1, '#0b1a2a')
        ctx.fillStyle = g; ctx.fillRect(0, 0, LW, hy)
      }
      ctx.drawImage(plate, 0, 0, PLATE_W, PLATE_H, 0, hy, LW, ph)
      for (let y = hy + ph; y < lh; y += 50) ctx.drawImage(plate, 0, PLATE_H - 100, PLATE_W, 100, 0, y, LW, 50)
    }

    // ---- objets triés par profondeur (du plus loin au plus proche) ----
    type Drawable = { depth: number; draw: () => void }
    const items: Drawable[] = []

    // cible bonus (+3) dans le but
    if (eng.phase === 'aim' || eng.phase === 'flight') items.push({ depth: P({ x: 0, y: 0, z: D }).depth + 0.5, draw: () => {
      const tg = eng.ex.target, c = P({ x: tg.x, y: tg.y, z: D }), rr = tg.r * c.k
      const pulse = 0.75 + 0.25 * Math.sin(now / 160)
      ctx.save()
      ctx.globalAlpha = 0.9 * pulse
      ctx.lineWidth = 2.5
      for (const [k, col] of [[1, '#ffd84a'], [0.62, '#ffffff'], [0.28, '#ffd84a']] as const) {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(c.x, c.y, rr * k, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,216,74,.18)'; ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
      ctx.font = '700 10px Oswald, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd84a'
      ctx.fillText('+3', c.x, c.y - rr - 5)
      ctx.restore()
    } })
    // gardien
    const kz = D - KEEPER_LINE_OFFSET
    items.push({ depth: P({ x: eng.keeperX, y: 0, z: kz }).depth, draw: () => drawKeeper(ctx, P, eng, kz) })
    // mur
    const top = eng.phase === 'flight' || eng.phase === 'after' ? wallTop(eng.wallJumpT) : WALL_HEIGHT
    const jump = top - WALL_HEIGHT
    for (const [wi, lat0] of sc.wallLats.entries()) {
      const lat = lat0 + eng.wallShift
      const wx = sc.ball0.x + sc.hc.x * WALL_DIST + sc.w.x * lat
      const wz = sc.ball0.z + sc.hc.z * WALL_DIST + sc.w.z * lat
      items.push({ depth: P({ x: wx, y: 0, z: wz }).depth, draw: () => drawWallPlayer(ctx, P, wx, wz, jump, wi) })
    }
    // ballon
    let ballPos: Vec3 = sc.ball0
    if (eng.phase === 'flight' && eng.flight) ballPos = flightPos(eng.flight, eng.flight.t)
    else if ((eng.phase === 'after' || eng.phase === 'next') && eng.free) ballPos = eng.free.p
    items.push({ depth: P(ballPos).depth - 0.01, draw: () => drawBall(ctx, P, ballPos, eng) })

    // le tireur n°10, devant à gauche du ballon (comme dans la vidéo : pieds 137 px à gauche, 62 px plus bas)
    {
      const bs0 = P(sc.ball0)
      items.push({ depth: 0, draw: () => {
        const im = fkImgs().shooter
        if (!im.complete || !im.naturalWidth) return
        const tk = (now - eng.kickAt) / 1000
        const isGoal = eng.outcome === 'goal' || eng.outcome === 'lucarne' || eng.outcome === 'cible'
        let f = 0                                                  // debout
        if (eng.phase === 'aim' && eng.power !== null) f = 1             // élan
        else if (tk >= 0 && tk < 0.45 && eng.phase !== 'aim') f = 2 // frappe
        else if ((eng.phase === 'after' || eng.phase === 'next') && isGoal) f = 3 // joie
        const w = SHOOT_FW / 2, h = SHOOT_FH / 2
        const fx = bs0.x - 68, fy = bs0.y + 31
        ctx.drawImage(im, f * SHOOT_FW, 0, SHOOT_FW, SHOOT_FH, Math.round(fx - w / 2), Math.round(fy - h), w, h)
      } })
    }
    items.sort((a, b) => b.depth - a.depth)
    for (const it of items) it.draw()

    // traînée du ballon en vol
    if (eng.phase === 'flight' && eng.flight && eng.flight.trail.length > 1) {
      ctx.beginPath()
      eng.flight.trail.forEach((p, i) => { const s = P(p); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y) })
      ctx.strokeStyle = 'rgba(244,239,226,0.25)'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // ---- au-dessus : interface nette (pas pixelisée)
    flush()
    ctx = ui
    // bandeau de l'image : buts, score, palier et distance écrits dans les cases de la vidéo
    if (eng.phase !== 'idle') {
      const Y = (v: number) => hy + v / 2
      ctx.textBaseline = 'middle'
      ctx.font = '700 15px Oswald, sans-serif'; ctx.fillStyle = '#1b1b1f'; ctx.textAlign = 'center'
      ctx.fillText('BUTS : ' + eng.goals, 70, Y(201))
      ctx.textAlign = 'left'; ctx.font = '700 17px Oswald, sans-serif'
      ctx.fillText(String(eng.points), 205, Y(201))
      ctx.textAlign = 'center'; ctx.font = '700 13px Oswald, sans-serif'; ctx.fillStyle = '#f5d98b'
      ctx.fillText('PALIER ' + eng.level, 291.5, Y(201))
      ctx.textAlign = 'left'; ctx.fillStyle = '#F4EFE2'; ctx.font = '700 20px Oswald, sans-serif'
      const dTxt = String(Math.round(sc.cfg.dist))
      ctx.fillText(dTxt, 44, Y(274))
      const dw = ctx.measureText(dTxt).width
      ctx.font = '700 13px Oswald, sans-serif'; ctx.fillText('m', 46 + dw, Y(278))
      ctx.textBaseline = 'alphabetic'
    }
    // tir tracé : trait jaune du doigt + viseur au bout
    const drawAim = (path: { x: number; y: number }[], alpha: number) => {
      if (path.length < 2) return
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.strokeStyle = `rgba(120,80,0,${0.5 * alpha})`; ctx.lineWidth = 7
      ctx.beginPath(); path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke()
      ctx.strokeStyle = `rgba(255,205,60,${alpha})`; ctx.lineWidth = 4
      ctx.beginPath(); path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke()
      const e = path[path.length - 1]
      ctx.strokeStyle = `rgba(255,216,74,${alpha})`; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(e.x, e.y, 9, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(e.x - 14, e.y); ctx.lineTo(e.x - 6, e.y); ctx.moveTo(e.x + 6, e.y); ctx.lineTo(e.x + 14, e.y)
      ctx.moveTo(e.x, e.y - 14); ctx.lineTo(e.x, e.y - 6); ctx.moveTo(e.x, e.y + 6); ctx.lineTo(e.x, e.y + 14); ctx.stroke()
    }
    // encadré en bas de l'écran
    const bottomBox = (l1: string, l2: string) => {
      const bw = Math.min(LW - 40, 270), bh = 40, bx = (LW - bw) / 2, by = Math.min(lh, hy + PLATE_H / 2) - bh - 8
      fkRound(ctx, bx, by, bw, bh, 9); ctx.fillStyle = 'rgba(10,26,18,0.9)'; ctx.fill()
      ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☝️', bx + 22, by + 29)
      ctx.fillStyle = '#F4EFE2'; ctx.font = '700 12px Oswald, sans-serif'
      ctx.fillText(l1, bx + bw / 2 + 12, by + 17); ctx.fillText(l2, bx + bw / 2 + 12, by + 32)
      ctx.textAlign = 'left'
    }
    if (eng.phase === 'aim') {
      const bs = ballScreen()
      if (!eng.swiping && !eng.aimShot) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 220)
        ctx.strokeStyle = `rgba(255,216,74,${0.35 + pulse * 0.5})`
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(bs.x, bs.y, bs.k * BALL_R + 8 + pulse * 5, 0, Math.PI * 2); ctx.stroke()
        bottomBox('Trace ton tir', "pour viser et donner de l'effet !")
      }
      if (eng.swiping) drawAim(eng.swipe, 1)
      if (eng.aimShot) {
        drawAim(eng.aimShot.path, eng.power === null ? 1 : 0.6)
        // barre de puissance horizontale (le curseur va et vient, on appuie pour l'arrêter)
        const g = eng.power ?? gaugeAt(now - eng.chargeAt)
        const bw = Math.min(LW - 70, 240), bh = 14, bx = (LW - bw) / 2, by = Math.min(lh, hy + PLATE_H / 2) - 40
        fkRound(ctx, bx - 4, by - 4, bw + 8, bh + 8, 11); ctx.fillStyle = 'rgba(10,26,18,0.9)'; ctx.fill()
        ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 1.5; ctx.stroke()
        const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0)
        grad.addColorStop(0, '#2fae4f'); grad.addColorStop(0.5, '#ffd84a'); grad.addColorStop(1, '#e8382c')
        fkRound(ctx, bx, by, bw, bh, 7); ctx.fillStyle = grad; ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(bx + bw / 2 - 1, by - 3, 2, bh + 6) // puissance normale
        const mx = bx + bw * g
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b1f'; ctx.lineWidth = 1.5
        fkRound(ctx, mx - 3.5, by - 6, 7, bh + 12, 3); ctx.fill(); ctx.stroke()
        ctx.textAlign = 'center'; ctx.font = '700 11px Oswald, sans-serif'; ctx.fillStyle = '#F4EFE2'
        ctx.fillText(eng.power === null ? 'PUISSANCE · APPUIE POUR FRAPPER' : 'PUISSANCE', LW / 2, by + bh + 17)
        ctx.textAlign = 'left'
      }
    }

    // confettis
    for (const p of eng.particles) {
      ctx.globalAlpha = Math.min(1, p.life)
      ctx.fillStyle = p.c
      ctx.fillRect(p.x, p.y, 3, 5)
    }
    ctx.globalAlpha = 1

    // message d'issue (BUT ! + ruban LUCARNE / CIBLE + points)
    if (eng.msg) {
      const age = (now - eng.msg.at) / 1000
      const s = age < 0.18 ? 0.6 + (age / 0.18) * 0.5 : age < 0.3 ? 1.1 - ((age - 0.18) / 0.12) * 0.1 : 1
      ctx.save()
      ctx.translate(cx, hy + 200) // devant le but de l'image
      ctx.scale(s, s)
      ctx.textAlign = 'center'
      const big = eng.msg.text === 'BUT !'
      if (big) {
        const glow = ctx.createRadialGradient(0, 4, 4, 0, 4, 95)
        glow.addColorStop(0, 'rgba(255,214,90,0.55)'); glow.addColorStop(1, 'rgba(255,214,90,0)')
        ctx.fillStyle = glow; ctx.fillRect(-100, -90, 200, 190)
        ctx.fillStyle = '#ffd84a'; ctx.font = '26px sans-serif'; ctx.fillText('👑', 0, -44)
      }
      ctx.font = big ? 'italic 700 50px Oswald, sans-serif' : '700 36px Oswald, sans-serif'
      ctx.lineWidth = 6
      ctx.strokeStyle = 'rgba(7,19,15,0.9)'
      ctx.strokeText(eng.msg.text, 0, 0)
      ctx.fillStyle = eng.msg.color
      ctx.fillText(eng.msg.text, 0, 0)
      let y = 26
      if (eng.msg.ribbon) {
        ctx.font = '700 14px Oswald, sans-serif'
        const rw = ctx.measureText(eng.msg.ribbon).width + 28
        fkRound(ctx, -rw / 2, y - 14, rw, 22, 5); ctx.fillStyle = '#5b3a00'; ctx.fill()
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.fillStyle = '#ffd84a'; ctx.fillText(eng.msg.ribbon, 0, y + 2)
        y += 30
      }
      if (eng.msg.sub) {
        ctx.font = '700 22px Oswald, sans-serif'
        ctx.lineWidth = 4; ctx.strokeText(eng.msg.sub, 0, y)
        ctx.fillStyle = '#F4EFE2'; ctx.fillText(eng.msg.sub, 0, y)
      }
      ctx.restore()
    }

    // infos du coup franc : mur qui saute, vent, chrono
    if (eng.phase === 'aim') {
      ctx.textAlign = 'center'
      const tags: string[] = []
      if (sc.cfg.wallJumps) tags.push('⚠ Le mur saute')
      if (eng.ex.wallSlide) tags.push('⚠ Le mur se décale')
      if (tags.length) {
        ctx.fillStyle = 'rgba(255,120,100,0.95)'
        ctx.font = '700 11px "Space Mono", monospace'
        ctx.fillText(tags.join(' · '), cx, 18)
      }
      if (eng.ex.wind) {
        // flèche de vent (taille = force)
        const w = eng.ex.wind, len = 14 + Math.abs(w) * 12, y = 36, dir = Math.sign(w)
        ctx.strokeStyle = '#cfe8ff'; ctx.fillStyle = '#cfe8ff'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(cx - dir * len / 2, y); ctx.lineTo(cx + dir * len / 2, y); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(cx + dir * (len / 2 + 7), y); ctx.lineTo(cx + dir * len / 2, y - 6); ctx.lineTo(cx + dir * len / 2, y + 6); ctx.fill()
        ctx.font = '700 10px "Space Mono", monospace'
        ctx.fillText('VENT ' + Math.abs(w).toFixed(1), cx, y + 18)
      }
      if (eng.ex.shotClock) {
        const left = Math.max(0, eng.ex.shotClock - (now - eng.aimAt) / 1000), k = left / eng.ex.shotClock
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(20, lh - 10, LW - 40, 5)
        ctx.fillStyle = k > 0.35 ? '#ffd84a' : '#ff5a4e'; ctx.fillRect(20, lh - 10, (LW - 40) * k, 5)
      }
      ctx.textAlign = 'left'
    }
    // bandeau NIVEAU
    const ba = (now - eng.bannerAt) / 1000
    if (ba >= 0 && ba < 1.8 && eng.phase !== 'over' && eng.phase !== 'idle') {
      const a = Math.min(1, ba * 5, (1.8 - ba) * 4)
      ctx.save(); ctx.globalAlpha = a
      const by = hy + 160
      ctx.fillStyle = 'rgba(21,19,15,.88)'; ctx.fillRect(0, by - 30, LW, 56)
      ctx.fillStyle = '#e9c46a'; ctx.fillRect(0, by - 30, LW, 3); ctx.fillRect(0, by + 23, LW, 3)
      ctx.textAlign = 'center'; ctx.font = '700 28px Oswald, sans-serif'; ctx.fillStyle = '#ffd84a'
      ctx.fillText('PALIER ' + eng.level + ' · ' + Math.round(sc.cfg.dist) + ' M', cx, by + 2)
      ctx.font = '600 12px Oswald, sans-serif'; ctx.fillStyle = '#f4ecd4'
      ctx.fillText(STAGES[eng.level - 1].info.toUpperCase(), cx, by + 18)
      ctx.restore()
    }
  }

  // -- dessin : un joueur du mur
  function drawWallPlayer(ctx: CanvasRenderingContext2D, P: (p: Vec3) => ReturnType<typeof project>, x: number, z: number, jump: number, idx: number) {
    const feet = P({ x, y: jump, z })
    const k = feet.k
    if (feet.depth < 0.5) return
    const g = P({ x, y: 0, z })
    ctx.fillStyle = 'rgba(0,20,6,0.35)'
    ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.4 * k, 0.1 * k, 0, 0, Math.PI * 2); ctx.fill()
    // les 4 joueurs du mur de la vidéo (taille de l'image au niveau du mur)
    const img = fkImgs().wall
    const h = 2.0 * k, w = h * WALL_FW / WALL_FH
    if (img.complete && img.naturalWidth) ctx.drawImage(img, (idx % 4) * WALL_FW, 0, WALL_FW, WALL_FH, feet.x - w / 2, feet.y - h, w, h)
  }

  // -- dessin : gardien (plonge en tournant vers le côté où il va)
  function drawKeeper(ctx: CanvasRenderingContext2D, P: (p: Vec3) => ReturnType<typeof project>, eng: Engine, kz: number) {
    const x = eng.keeperX
    const feet = P({ x, y: eng.keeperJump, z: kz })
    const k = feet.k
    const g = P({ x, y: 0, z: kz })
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.35 * k, 0.09 * k, 0, 0, Math.PI * 2); ctx.fill()
    const dive = Math.max(-1, Math.min(1, (x - eng.scene.keeperX0) / 1.6))
    // gardien : le joueur de la vidéo en tenue bleue, qui plonge en tournant
    const img = fkImgs().keeper
    if (!img.complete || !img.naturalWidth) return
    const h = 2.0 * k, w = h * img.naturalWidth / img.naturalHeight
    ctx.save()
    ctx.translate(feet.x, feet.y - h * 0.5)
    ctx.rotate(dive * 1.05)
    ctx.drawImage(img, -w / 2, -h * 0.5, w, h)
    ctx.restore()
  }

  // -- dessin : ballon + ombre
  function drawBall(ctx: CanvasRenderingContext2D, P: (p: Vec3) => ReturnType<typeof project>, pos: Vec3, eng: Engine) {
    const shadow = P({ x: pos.x, y: 0, z: pos.z })
    const s = P(pos)
    if (s.depth < 0.5) return
    const r = Math.max(1.5, s.k * BALL_R)
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.35 - (pos.y - BALL_R) * 0.06)})`
    ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, r * 1.1, r * 0.35, 0, 0, Math.PI * 2); ctx.fill()
    // ballon en pixels de la vidéo
    const img = fkImgs().ball
    if (img.complete && img.naturalWidth) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.round(eng.spin / (Math.PI / 2)) * (Math.PI / 2))
      ctx.drawImage(img, -r * 3.9, -r * 3.9, r * 7.8, r * 7.8); ctx.restore()
    }
  }

  // ------------------------------------------------ boucle d'animation -----
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // finesse du décor : ~1,4 pixel de jeu par px logique (avant 0,5 = trop pixelisé) ;
    // les personnages restent en pixel art (sprites agrandis sans lissage)
    const PIX = 2 // l'image de la vidéo est à 2 px par px logique
    const off = document.createElement('canvas')
    const octx = off.getContext('2d')
    if (!octx) return
    const resize = () => {
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const eng = engineRef.current
      eng.lastW = rect.width
      eng.lastH = (rect.height / rect.width) * LW
      const k = (rect.width / LW) * dpr
      ctx.setTransform(k, 0, 0, k, 0, 0)
      // décor en basse résolution (≈ 1 pixel de jeu = 2 px logiques) -> rendu pixel art
      off.width = Math.round(LW * PIX); off.height = Math.round(eng.lastH * PIX)
      octx.setTransform(PIX, 0, 0, PIX, 0, 0)
      octx.imageSmoothingEnabled = false
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
      octx.clearRect(0, 0, LW, engineRef.current.lastH)
      // l'interface est dessinée après le décor : on dessine d'abord le décor pixelisé
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore()
      drawScene(octx, ctx, () => {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(off, 0, 0, LW, engineRef.current.lastH)
      })
      // repères lisibles de l'extérieur (tests automatisés du geste)
      const eng = engineRef.current
      const bs = ballScreen()
      canvas.dataset.ball = `${bs.x.toFixed(1)},${bs.y.toFixed(1)}`
      canvas.dataset.phase = eng.phase
      canvas.dataset.outcome = eng.outcome ?? ''
      {
        const { cx, hy } = layout()
        const gl = project(eng.scene, { x: -GOAL_HALF_W, y: 0, z: eng.scene.cfg.dist }, cx, hy)
        const gr = project(eng.scene, { x: GOAL_HALF_W, y: GOAL_H, z: eng.scene.cfg.dist }, cx, hy)
        canvas.dataset.goal = `${gl.x.toFixed(1)},${gl.y.toFixed(1)},${gr.x.toFixed(1)},${gr.y.toFixed(1)}`
        canvas.dataset.near = String(eng.scene.cfg.nearSide)
        canvas.dataset.jumps = eng.scene.cfg.wallJumps ? '1' : '0'
        const tp = project(eng.scene, { x: eng.ex.target.x, y: eng.ex.target.y, z: eng.scene.cfg.dist }, cx, hy)
        canvas.dataset.target = `${tp.x.toFixed(1)},${tp.y.toFixed(1)}`
        canvas.dataset.level = String(eng.level)
      }
      raf = requestAnimationFrame(loop)
    }
    // tests automatiques (?debug) : choisir le nombre de buts de départ
    if (location.search.includes('debug')) (window as unknown as Record<string, unknown>).__fkStart = (goals: number) => {
      const eng = engineRef.current; eng.goals = goals; eng.points = goals; eng.level = levelOf(goals) - 1; setupShot()
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------- geste --------
  const toLogical = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * LW, y: ((e.clientY - rect.top) / rect.width) * LW }
  }

  // 1) on trace le tir depuis le ballon (cible + effet) ; 2) la barre de
  // puissance défile, on appuie pour l'arrêter ; 3) élan et frappe
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    const p = { ...toLogical(e), t: performance.now() }
    // « ← Accueil » de l'image : on arrête la partie (la série est enregistrée)
    {
      const { hy } = layout()
      if (eng.phase !== 'idle' && eng.phase !== 'over' && p.x < 95 && p.y > hy + 45 && p.y < hy + 83) { endGame(); return }
    }
    if (eng.phase !== 'aim') return
    if (eng.aimShot) {
      // étape puissance : un appui n'importe où arrête la barre
      if (eng.power === null) {
        eng.power = gaugeAt(p.t - eng.chargeAt)
        eng.runAt = p.t
        sfxWhistle()
      }
      return
    }
    const bs = ballScreen()
    if (Math.hypot(p.x - bs.x, p.y - bs.y) > TOUCH_RADIUS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    eng.swiping = true
    eng.swipe = [p]
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    if (!eng.swiping) return
    const p = { ...toLogical(e), t: performance.now() }
    const lastP = eng.swipe[eng.swipe.length - 1]
    if (Math.hypot(p.x - lastP.x, p.y - lastP.y) >= 2) eng.swipe.push(p)
  }

  const onPointerUp = () => {
    const eng = engineRef.current
    if (!eng.swiping) return
    eng.swiping = false
    const pts = eng.swipe
    eng.swipe = []
    if (pts.length < 3 || eng.phase !== 'aim') return
    const a = pts[0], b = pts[pts.length - 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (a.y - b.y < 30 || len < 36) return // geste trop court / pas vers le but
    // courbure : écart maximal (signé) du tracé par rapport à la corde
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    let bow = 0
    for (const p of pts) {
      const d = ux * (p.y - a.y) - uy * (p.x - a.x)
      if (Math.abs(d) > Math.abs(bow)) bow = d
    }
    // bow > 0 : le tracé s'écarte vers la droite de la corde -> le ballon part
    // à droite puis revient vers la gauche (curl > 0 = accélération à gauche)
    let curl = bow / len / 0.22
    if (Math.abs(bow / len) < 0.03) curl = 0
    curl = Math.max(-1, Math.min(1, curl))
    const { cx, hy } = layout()
    const target = unprojectToGoalPlane(eng.scene, b.x, b.y, cx, hy)
    // le tir est tracé : place à la barre de puissance
    eng.aimShot = { target, curl, path: pts.map((q) => ({ x: q.x, y: q.y })) }
    eng.power = null
    eng.chargeAt = performance.now()
  }

  const continueNext = () => {
    setNextCard(null)
    setupShot()
  }

  return (
    <div className={"predictions-screen dribble-page dribble-px freekick-px" + (phase === 'playing' ? ' fk-fs' : '')} ref={wrapperRef} style={dribbleSpriteVars() as React.CSSProperties}>
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Accueil</button>
        <h2>Coup franc — {groupName}</h2>
      </div>

      <div className="dribble-app">
        <button type="button" className="dribble-rules-toggle" onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Masquer les règles ▲' : 'Voir les règles ▼'}
        </button>
        {showRules && (
          <p className="dribble-intro">
            1. Trace ton tir : pose le doigt sur le ballon et glisse jusqu'à l'endroit du but visé. Un tracé en
            arc donne de l'effet pour contourner le mur (le ballon dévie un peu de ta visée).
            2. La barre de puissance défile : appuie pour l'arrêter. Le trait blanc = puissance normale ; trop
            fort, le ballon monte (attention à la barre), pas assez, il retombe. Le tireur s'élance et frappe.
            Termine ton tracé sous la ligne de but pour une frappe à ras de terre (elle passe sous le mur qui saute).
            But = 1 point, lucarne = 2, dans la cible jaune = 3. Au premier raté, la série s'arrête.
            Chaque partie est différente, et ça recule à chaque but : 17-18 m (mur de 3, gardien lent),
            19-21 m (mur de 4), 22-24 m (le mur saute, gardien plus vif), 25-27 m (ballon décalé sur le côté),
            puis 28 m et plus : grosse courbe obligatoire et lucarnes.
          </p>
        )}

        <div className="dribble-stat-row">
          <div className="dribble-stat"><b>{points}</b><span>Points</span></div>
          <div className="dribble-stat"><b>{goals}</b><span>Buts</span></div>
          <div className="dribble-stat"><b>{distance} m</b><span>Distance</span></div>
        </div>

        <div className="dribble-stage freekick-stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            className="freekick-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {phase === 'playing' && nextCard && (
            <div className="fk-next">
              <div className="fk-next-card">
                <div className="fk-next-title">PROCHAIN TIR</div>
                <div className="fk-next-dist">📍 {nextCard.dist} m</div>
                <div className="fk-next-level">PALIER {nextCard.level}</div>
                {nextCard.info && <div className="fk-next-info">{nextCard.info}</div>}
              </div>
              <button className="fk-next-btn" onClick={continueNext}>▶ CONTINUER</button>
            </div>
          )}
          {phase === 'idle' && (
            <div className="dribble-idle-msg">
              <span style={{ fontSize: 30 }}>🧱</span>
              <p className="dribble-sub">Trace ton tir depuis le ballon, puis arrête la barre de puissance. Le mur et le gardien t'attendent.</p>
              <button className="dribble-cta" onClick={startGame}>Commencer</button>
            </div>
          )}
          {phase === 'over' && (
            <div className="dribble-end-msg">
              <span className="dribble-big">{finalPoints}</span>
              <p className="dribble-sub">
                {finalPoints === 0 ? 'Aucun but cette fois.' : `point${finalPoints > 1 ? 's' : ''} marqué${finalPoints > 1 ? 's' : ''} (${goals} but${goals > 1 ? 's' : ''}).`}
              </p>
              <button className="dribble-cta" onClick={startGame}>Rejouer</button>
            </div>
          )}
        </div>
      </div>

      {(allTimeBest || lastWeekBest || scores.length > 0) && (
        <button type="button" className="dribble-rules-toggle" onClick={() => setShowBoard((v) => !v)}>
          {showBoard ? 'Masquer le classement ▲' : '🏆 Voir le classement ▼'}
        </button>
      )}
      {showBoard && (allTimeBest || lastWeekBest) && (
        <div className="juggle-palmares">
          <p className="predictions-period">🏆 Palmarès</p>
          {allTimeBest && <p className="juggle-palmares-row">Record du groupe : <b>{allTimeBest.score}</b> ({allTimeBest.pseudo})</p>}
          {lastWeekBest && <p className="juggle-palmares-row">Édition précédente : <b>{lastWeekBest.score}</b> ({lastWeekBest.pseudo})</p>}
        </div>
      )}
      {showBoard && scores.length > 0 && (
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
