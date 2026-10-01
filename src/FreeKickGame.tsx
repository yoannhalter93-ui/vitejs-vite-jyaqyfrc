import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import { useWizzChannel } from './wizzChannel'

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
const WALL_HEIGHT = 1.8
const WALL_JUMP = 0.38
const KEEPER_LINE_OFFSET = 0.3 // le gardien se tient 30 cm devant sa ligne
const MAX_CURL_ACCEL = 7 // m/s², effet maximal
const MAX_SCORE = 2000

// ---- caméra / écran (unités logiques : largeur fixe 360) ----
const LW = 360
const FOCAL = 780
const CAM_BACK = 6.5
const CAM_H = 2.1
const TOUCH_RADIUS = 75 // px logiques autour du ballon pour lancer le geste

function monday(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return d.toISOString().slice(0, 10)
}

function previousMonday(): string {
  const d = new Date(monday() + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7)
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
}

// Taille du mur : il couvre une part fixe de l'ANGLE du but vu du ballon
// (≈ la moitié côté poteau, un peu plus aux niveaux avancés). Un nombre fixe
// de joueurs masquait tout le but de loin : à 26 m, 5 joueurs à 9,15 m ont le
// même angle apparent que le but entier.
function wallSize(ballX: number, dist: number, n: number): number {
  const angleCos = dist / Math.hypot(ballX, dist)
  const goalAtWall = 2 * GOAL_HALF_W * angleCos * (WALL_DIST / dist)
  const coverage = n < 6 ? 0.5 : 0.62
  return Math.max(2, Math.min(5, Math.round((coverage * goalAtWall) / 0.55)))
}

// Difficulté progressive selon le nombre de coups francs déjà réussis.
// Courbe adoucie depuis la semaine du 28 septembre 2026 (avant : au-delà
// du 9e but, moins d'1 % des tirs possibles marquaient, et le 13e était
// quasi impossible). Simulation de tous les tirs (cible x hauteur x effet)
// sur 6 semaines : ~25 % au 1er, puis jamais moins de ~2,5 % ensuite. La
// ancienne courbe reste pour les semaines passées.
const SOFT_CURVE_FROM = '2026-09-28'
// À partir du 5 octobre 2026 : la courbe adoucie plafonnait vers le 12e but
// (un bon joueur enchaînait ensuite indéfiniment, ~5 % de tirs possibles à
// chaque niveau). Désormais, après le 12e but, gardien, distance et saut du
// mur continuent de progresser doucement : ~3,5 % au 18e, ~2 % au 21e, puis
// palier autour de 1 % (jamais impossible). Mesuré par simulation.
const RISING_CURVE_FROM = '2026-10-05'

function shotConfig(weekSeed: number, n: number): ShotConfig {
  const week = monday()
  const soft = week >= SOFT_CURVE_FROM
  const rising = week >= RISING_CURVE_FROM
  const x = rising ? Math.max(0, n - 11) : 0 // niveaux au-delà du 12e but
  const r = mulberry32(weekSeed + n * 7919)
  const side = r() < 0.5 ? -1 : 1
  const lateral = r() * (rising ? Math.min(7.5, 1.2 + n * 0.6) : soft ? Math.min(6.5, 1.2 + n * 0.6) : Math.min(8.5, 1.2 + n * 0.8))
  const ballX = side * lateral
  const dist = soft ? 17 + Math.min(7, n * 0.65) + Math.min(3, x * 0.2) + r() * 2 : 17 + Math.min(10, n * 0.9) + r() * 2
  const jumpChance = rising
    ? Math.min(0.55 + x * 0.02, 0.3 + (n - 4) * 0.05)
    : soft ? Math.min(0.55, 0.3 + (n - 4) * 0.05) : Math.min(0.8, 0.3 + (n - 4) * 0.1)
  return {
    ballX,
    dist,
    nearSide: lateral < 1 ? side : Math.sign(ballX),
    // adouci : le mur ne grandit plus au-delà du niveau 6
    wallCount: wallSize(ballX, dist, soft ? Math.min(n, 5) : n),
    wallJumps: n >= 4 && r() < jumpChance,
    // début accessible (un coin bien placé passe), puis le gardien devient
    // plus vif ; au-delà du 12e but il continue de progresser (max 3,85 m/s)
    keeperSpeed: soft ? Math.min(3.85, 2.4 + Math.min(0.9, n * 0.1) + x * 0.04) : 2.4 + Math.min(1.45, n * 0.16),
    keeperReaction: soft ? Math.max(0.2, Math.max(0.25, 0.38 - n * 0.015) - x * 0.004) : Math.max(0.18, 0.38 - n * 0.022),
  }
}

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

function project(sc: Scene, p: Vec3, cx: number, hy: number) {
  const dx = p.x - sc.cam.x, dz = p.z - sc.cam.z
  const xr = dx * sc.cam.cos - dz * sc.cam.sin
  const zr = dx * sc.cam.sin + dz * sc.cam.cos
  return { x: cx + (FOCAL * xr) / zr, y: hy - (FOCAL * (p.y - sc.cam.y)) / zr, depth: zr, k: FOCAL / zr }
}

// point de l'écran -> point visé dans le plan du but (z = dist)
function unprojectToGoalPlane(sc: Scene, sx: number, sy: number, cx: number, hy: number): Vec3 {
  const xr = (sx - cx) / FOCAL
  const yr = -(sy - hy) / FOCAL
  const dx = xr * sc.cam.cos + sc.cam.sin
  const dz = -xr * sc.cam.sin + sc.cam.cos
  const t = (sc.cfg.dist - sc.cam.z) / dz
  // y < 0 : le doigt est levé sous la ligne de but -> tir à ras de terre
  return { x: sc.cam.x + t * dx, y: Math.max(-2, Math.min(6, sc.cam.y + t * yr)), z: sc.cfg.dist }
}

type Outcome = 'goal' | 'lucarne' | 'wall' | 'saved' | 'post' | 'bar' | 'wide' | 'over'

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
  phase: 'idle' | 'aim' | 'flight' | 'after' | 'over'
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
  swipe: { x: number; y: number }[]
  swiping: boolean
  particles: { x: number; y: number; vx: number; vy: number; life: number; c: string }[]
  msg: { text: string; sub: string; color: string; at: number } | null
  spin: number
  crowd: { x: number; y: number; c: string }[]
  lastW: number
  lastH: number
  audio: AudioContext | null
}

function newEngine(seed: number): Engine {
  const cfg = shotConfig(seed, 0)
  return {
    phase: 'idle', weekSeed: seed, goals: 0, points: 0,
    scene: buildScene(cfg), flight: null, free: null, outcome: null, outcomeAt: 0,
    keeperX: -cfg.nearSide * 0.6, keeperJump: 0, wallJumpT: -1, netHit: null,
    swipe: [], swiping: false, particles: [], msg: null, spin: 0,
    crowd: [], lastW: 0, lastH: 0, audio: null,
  }
}

const OUTCOME_TEXT: Record<Outcome, { text: string; color: string }> = {
  goal: { text: 'BUT !', color: '#D4A22C' },
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
      .eq('group_id', groupId).eq('week_start', previousMonday()).order('score', { ascending: false }).limit(1)
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
    // cadrage : le ballon à ~85 px du bas, l'horizon en découle (le but
    // occupe alors le tiers central de l'écran)
    const ballY = lh - 85
    const hy = ballY - (FOCAL * (CAM_H - BALL_R)) / CAM_BACK
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
    eng.msg = null
    eng.phase = 'aim'
    setDistance(Math.round(cfg.dist))
    sfxWhistle()
  }

  const startGame = () => {
    ensureAudio()
    const eng = engineRef.current
    eng.weekSeed = hashString('coup-franc:' + monday())
    eng.goals = 0
    eng.points = 0
    eng.particles = []
    setPoints(0)
    setGoals(0)
    setPhase('playing')
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
  const shoot = (aimed: Vec3, curl: number) => {
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
    const v = {
      x: (target.x - b.x) / T - 0.5 * a.x * T,
      y: (target.y - b.y) / T - 0.5 * a.y * T,
      z: (target.z - b.z) / T - 0.5 * a.z * T,
    }
    eng.flight = { o: { ...b }, v, a, t: 0, prevDepth: 0, trail: [] }
    eng.phase = 'flight'
    eng.wallJumpT = 0
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
    const isGoal = outcome === 'goal' || outcome === 'lucarne'
    if (isGoal) {
      const pts = outcome === 'lucarne' ? 2 : 1
      eng.goals += 1
      eng.points += pts
      setGoals(eng.goals)
      setPoints(eng.points)
      eng.msg = { text: txt.text, sub: outcome === 'lucarne' ? '+2 points' : '+1 point', color: txt.color, at: performance.now() }
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

    if (eng.phase === 'flight' && eng.flight) {
      const f = eng.flight
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
          const inWall = sc.wallLats.some((l) => Math.abs(lat - l) <= WALL_PLAYER_HALF_W + BALL_R)
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
          const reachX = 1.05
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
            const lucarne = ax > GOAL_HALF_W - 1.1 && pc.y > 1.6
            resolve(lucarne ? 'lucarne' : 'goal', pc, v)
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
      const isGoal = eng.outcome === 'goal' || eng.outcome === 'lucarne'
      if (isGoal && fb.p.z > sc.cfg.dist + 1.6) { fb.p.z = sc.cfg.dist + 1.6; fb.v.z = 0; fb.v.x *= 0.5 }
      if (fb.p.y < BALL_R) { fb.p.y = BALL_R; fb.v.y = Math.abs(fb.v.y) * 0.4; fb.v.x *= 0.7; fb.v.z *= 0.7 }
      // le gardien retombe
      eng.keeperJump *= Math.max(0, 1 - dt * 4)

      const elapsed = (performance.now() - eng.outcomeAt) / 1000
      if (elapsed > (isGoal ? 1.7 : 1.5)) {
        if (isGoal) setupShot()
        else endGame()
      }
    }
  }

  // ------------------------------------------------------------ rendu ------
  const drawScene = (ctx: CanvasRenderingContext2D) => {
    const eng = engineRef.current
    const sc = eng.scene
    const { cx, hy, lh } = layout()
    const P = (p: Vec3) => project(sc, p, cx, hy)
    const now = performance.now()

    // ciel de nuit
    const sky = ctx.createLinearGradient(0, 0, 0, hy)
    sky.addColorStop(0, '#07130f')
    sky.addColorStop(1, '#10261e')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, LW, lh)

    // tribunes derrière le but (un mur de supporters)
    const boardZ = sc.cfg.dist + 8
    const boardY = P({ x: 0, y: 0, z: boardZ }).y
    const standTop = Math.max(34, boardY - 250)
    const stand = ctx.createLinearGradient(0, standTop, 0, boardY)
    stand.addColorStop(0, '#0b1a15')
    stand.addColorStop(1, '#1a2c25')
    ctx.fillStyle = stand
    ctx.fillRect(0, standTop, LW, boardY - standTop)
    if (eng.crowd.length === 0 || eng.lastH !== lh) {
      const r = mulberry32(42)
      const palette = ['#C1443C', '#D4A22C', '#F4EFE2', '#2F8F5B', '#3b5a8c', '#8a6f4a']
      eng.crowd = Array.from({ length: 520 }, () => ({ x: r() * LW, y: r(), c: palette[Math.floor(r() * palette.length)] }))
    }
    const celebrate = (eng.outcome === 'goal' || eng.outcome === 'lucarne') && now - eng.outcomeAt < 1500
    for (const c of eng.crowd) {
      const yy = standTop + 6 + c.y * (boardY - standTop - 22)
      const bob = celebrate ? Math.sin(now / 90 + c.x) * 2.5 : 0
      ctx.globalAlpha = 0.25 + c.y * 0.45
      ctx.fillStyle = c.c
      ctx.fillRect(c.x, yy + bob, 2.2, 2.2)
    }
    ctx.globalAlpha = 1
    // projecteurs
    for (const lx of [24, LW - 24]) {
      const glow = ctx.createRadialGradient(lx, standTop - 24, 1, lx, standTop - 24, 70)
      glow.addColorStop(0, 'rgba(255,248,220,0.5)')
      glow.addColorStop(0.25, 'rgba(255,248,220,0.14)')
      glow.addColorStop(1, 'rgba(255,248,220,0)')
      ctx.fillStyle = glow
      ctx.fillRect(lx - 70, standTop - 94, 140, 140)
      ctx.fillStyle = 'rgba(255,250,235,0.95)'
      ctx.fillRect(lx - 7, standTop - 27, 14, 5)
    }
    // panneaux publicitaires
    ctx.fillStyle = '#0F3B2E'
    ctx.fillRect(0, boardY - 11, LW, 11)
    ctx.fillStyle = '#D4A22C'
    ctx.font = '700 8px Oswald, sans-serif'
    ctx.textBaseline = 'middle'
    for (let x = -((now / 40) % 90); x < LW; x += 90) ctx.fillText('ENTRE NOUS', x, boardY - 5.5)

    // pelouse : bandes de tonte parallèles à la ligne de but
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, boardY, LW, lh - boardY)
    ctx.clip()
    ctx.fillStyle = '#16563f'
    ctx.fillRect(0, boardY, LW, lh - boardY)
    const zNear = sc.cam.z + 1.5
    for (let z = Math.floor(zNear / 4) * 4; z < boardZ; z += 4) {
      if (Math.round(z / 4) % 2 === 0) continue
      const a = P({ x: -60, y: 0, z }), b = P({ x: 60, y: 0, z })
      const c2 = P({ x: 60, y: 0, z: Math.min(z + 4, boardZ) }), d = P({ x: -60, y: 0, z: Math.min(z + 4, boardZ) })
      if (a.depth <= 0.3 || d.depth <= 0.3) continue
      ctx.fillStyle = '#1b6649'
      ctx.beginPath()
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(d.x, d.y)
      ctx.closePath()
      ctx.fill()
    }
    // lignes blanches
    const line = (pts: Vec3[], width = 1.4) => {
      ctx.beginPath()
      let started = false
      for (const p of pts) {
        const s = P(p)
        if (s.depth < 0.5) { started = false; continue }
        if (!started) { ctx.moveTo(s.x, s.y); started = true } else ctx.lineTo(s.x, s.y)
      }
      ctx.strokeStyle = 'rgba(244,239,226,0.8)'
      ctx.lineWidth = width
      ctx.stroke()
    }
    const D = sc.cfg.dist
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const pts: Vec3[] = []
      for (let i = 0; i <= 12; i++) pts.push({ x: x1 + ((x2 - x1) * i) / 12, y: 0, z: z1 + ((z2 - z1) * i) / 12 })
      line(pts)
    }
    seg(-34, D, 34, D)
    seg(-20.16, D, -20.16, D - 16.5); seg(20.16, D, 20.16, D - 16.5); seg(-20.16, D - 16.5, 20.16, D - 16.5)
    seg(-9.16, D, -9.16, D - 5.5); seg(9.16, D, 9.16, D - 5.5); seg(-9.16, D - 5.5, 9.16, D - 5.5)
    const arc: Vec3[] = []
    for (let i = 0; i <= 24; i++) {
      const ang = -0.93 + (1.86 * i) / 24
      const x = Math.sin(ang) * 9.15, z = D - 11 - Math.cos(ang) * 9.15
      if (z <= D - 16.5) arc.push({ x, y: 0, z })
    }
    if (arc.length > 1) line(arc)
    const spot = P({ x: 0, y: 0, z: D - 11 })
    ctx.fillStyle = 'rgba(244,239,226,0.8)'
    ctx.beginPath(); ctx.ellipse(spot.x, spot.y, Math.max(1, spot.k * 0.11), Math.max(0.6, spot.k * 0.05), 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()

    // ---- objets triés par profondeur (du plus loin au plus proche) ----
    type Drawable = { depth: number; draw: () => void }
    const items: Drawable[] = []

    // but + filet
    items.push({ depth: P({ x: 0, y: 0, z: D }).depth + 1, draw: () => drawGoal(ctx, P, D, eng) })
    // gardien
    const kz = D - KEEPER_LINE_OFFSET
    items.push({ depth: P({ x: eng.keeperX, y: 0, z: kz }).depth, draw: () => drawKeeper(ctx, P, eng, kz) })
    // mur
    const top = eng.phase === 'flight' || eng.phase === 'after' ? wallTop(eng.wallJumpT) : WALL_HEIGHT
    const jump = top - WALL_HEIGHT
    for (const lat of sc.wallLats) {
      const wx = sc.ball0.x + sc.hc.x * WALL_DIST + sc.w.x * lat
      const wz = sc.ball0.z + sc.hc.z * WALL_DIST + sc.w.z * lat
      items.push({ depth: P({ x: wx, y: 0, z: wz }).depth, draw: () => drawWallPlayer(ctx, P, wx, wz, jump) })
    }
    // ballon
    let ballPos: Vec3 = sc.ball0
    if (eng.phase === 'flight' && eng.flight) ballPos = flightPos(eng.flight, eng.flight.t)
    else if (eng.phase === 'after' && eng.free) ballPos = eng.free.p
    items.push({ depth: P(ballPos).depth - 0.01, draw: () => drawBall(ctx, P, ballPos, eng) })

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

    // geste en cours
    if (eng.phase === 'aim') {
      const bs = ballScreen()
      if (!eng.swiping) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 220)
        ctx.strokeStyle = `rgba(212,162,44,${0.35 + pulse * 0.5})`
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(bs.x, bs.y, bs.k * BALL_R + 8 + pulse * 5, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = 'rgba(244,239,226,0.85)'
        ctx.font = '600 12px "Space Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText('Glisse du ballon vers le but', cx, Math.min(lh - 16, bs.y + 42))
        ctx.textAlign = 'left'
      }
      if (eng.swipe.length > 1) {
        ctx.beginPath()
        eng.swipe.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) })
        ctx.strokeStyle = 'rgba(212,162,44,0.9)'
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.stroke()
        const last = eng.swipe[eng.swipe.length - 1]
        ctx.strokeStyle = 'rgba(244,239,226,0.9)'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(last.x, last.y, 7, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(last.x - 11, last.y); ctx.lineTo(last.x + 11, last.y); ctx.moveTo(last.x, last.y - 11); ctx.lineTo(last.x, last.y + 11); ctx.stroke()
      }
    }

    // confettis
    for (const p of eng.particles) {
      ctx.globalAlpha = Math.min(1, p.life)
      ctx.fillStyle = p.c
      ctx.fillRect(p.x, p.y, 3, 5)
    }
    ctx.globalAlpha = 1

    // message d'issue
    if (eng.msg) {
      const age = (now - eng.msg.at) / 1000
      const s = age < 0.18 ? 0.6 + (age / 0.18) * 0.5 : age < 0.3 ? 1.1 - ((age - 0.18) / 0.12) * 0.1 : 1
      ctx.save()
      ctx.translate(cx, hy - 40)
      ctx.scale(s, s)
      ctx.textAlign = 'center'
      ctx.font = '700 38px Oswald, sans-serif'
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(7,19,15,0.85)'
      ctx.strokeText(eng.msg.text, 0, 0)
      ctx.fillStyle = eng.msg.color
      ctx.fillText(eng.msg.text, 0, 0)
      if (eng.msg.sub) {
        ctx.font = '700 14px "Space Mono", monospace'
        ctx.strokeText(eng.msg.sub, 0, 26)
        ctx.fillStyle = '#F4EFE2'
        ctx.fillText(eng.msg.sub, 0, 26)
      }
      ctx.restore()
    }

    // infos du coup franc (mur qui saute)
    if (eng.phase === 'aim' && sc.cfg.wallJumps) {
      ctx.fillStyle = 'rgba(193,68,60,0.9)'
      ctx.font = '700 11px "Space Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('⚠ Le mur saute !', cx, 18)
      ctx.textAlign = 'left'
    }
  }

  // -- dessin : but et filet
  function drawGoal(ctx: CanvasRenderingContext2D, P: (p: Vec3) => ReturnType<typeof project>, D: number, eng: Engine) {
    const depth = 1.8
    const bulge = eng.netHit && (eng.outcome === 'goal' || eng.outcome === 'lucarne')
      ? Math.max(0, 1 - (performance.now() - eng.outcomeAt) / 600) : 0
    const netPoint = (x: number, y: number) => {
      // le filet de fond, qui se déforme là où le ballon le touche
      let z = D + depth - (y / GOAL_H) * 0.6
      if (bulge && eng.netHit) {
        const d = Math.hypot(x - eng.netHit.x, y - eng.netHit.y)
        z += Math.max(0, 1 - d / 1.4) * 0.8 * bulge
      }
      return P({ x, y, z })
    }
    ctx.strokeStyle = 'rgba(244,239,226,0.28)'
    ctx.lineWidth = 0.8
    for (let x = -GOAL_HALF_W; x <= GOAL_HALF_W + 0.01; x += 0.45) {
      ctx.beginPath()
      for (let y = 0; y <= GOAL_H + 0.01; y += 0.2) { const s = netPoint(x, y); if (y === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y) }
      ctx.stroke()
    }
    for (let y = 0; y <= GOAL_H + 0.01; y += 0.35) {
      ctx.beginPath()
      for (let x = -GOAL_HALF_W; x <= GOAL_HALF_W + 0.01; x += 0.3) { const s = netPoint(x, y); if (x === -GOAL_HALF_W) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y) }
      ctx.stroke()
    }
    // côtés du filet
    for (const sx of [-GOAL_HALF_W, GOAL_HALF_W]) {
      for (let y = 0; y <= GOAL_H + 0.01; y += 0.35) {
        const a = P({ x: sx, y, z: D }), b = netPoint(sx, y)
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
    }
    // poteaux et transversale
    const bl = P({ x: -GOAL_HALF_W, y: 0, z: D }), tl = P({ x: -GOAL_HALF_W, y: GOAL_H, z: D })
    const br = P({ x: GOAL_HALF_W, y: 0, z: D }), tr = P({ x: GOAL_HALF_W, y: GOAL_H, z: D })
    ctx.strokeStyle = '#F4EFE2'
    ctx.lineWidth = Math.max(2, bl.k * POST_R * 2)
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.stroke()
  }

  // -- dessin : un joueur du mur
  function drawWallPlayer(ctx: CanvasRenderingContext2D, P: (p: Vec3) => ReturnType<typeof project>, x: number, z: number, jump: number) {
    const feet = P({ x, y: jump, z })
    const k = feet.k
    if (feet.depth < 0.5) return
    // ombre
    const g = P({ x, y: 0, z })
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.3 * k, 0.08 * k, 0, 0, Math.PI * 2); ctx.fill()
    const w = 0.46 * k
    // jambes
    ctx.fillStyle = '#e8c9a8'
    ctx.fillRect(feet.x - w * 0.34, feet.y - 0.85 * k, w * 0.22, 0.85 * k)
    ctx.fillRect(feet.x + w * 0.12, feet.y - 0.85 * k, w * 0.22, 0.85 * k)
    ctx.fillStyle = '#1b1b1f'
    ctx.fillRect(feet.x - w * 0.38, feet.y - 0.08 * k, w * 0.3, 0.08 * k)
    ctx.fillRect(feet.x + w * 0.08, feet.y - 0.08 * k, w * 0.3, 0.08 * k)
    // short
    ctx.fillStyle = '#2a1a17'
    ctx.fillRect(feet.x - w / 2, feet.y - 1.02 * k, w, 0.24 * k)
    // maillot
    ctx.fillStyle = '#C1443C'
    ctx.beginPath()
    ctx.roundRect(feet.x - w / 2, feet.y - 1.58 * k, w, 0.6 * k, 0.06 * k)
    ctx.fill()
    // bras croisés devant (protection)
    ctx.fillStyle = '#a8352f'
    ctx.fillRect(feet.x - w * 0.46, feet.y - 1.12 * k, w * 0.92, 0.1 * k)
    // tête
    ctx.fillStyle = '#e8c9a8'
    ctx.beginPath(); ctx.arc(feet.x, feet.y - 1.68 * k, 0.12 * k, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#2b1d14'
    ctx.beginPath(); ctx.arc(feet.x, feet.y - 1.72 * k, 0.12 * k, Math.PI, 0); ctx.fill()
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
    ctx.save()
    ctx.translate(feet.x, feet.y)
    ctx.rotate(dive * 1.05)
    const w = 0.5 * k
    ctx.fillStyle = '#e8c9a8'
    ctx.fillRect(-w * 0.34, -0.85 * k, w * 0.22, 0.85 * k)
    ctx.fillRect(w * 0.12, -0.85 * k, w * 0.22, 0.85 * k)
    ctx.fillStyle = '#1b1b1f'
    ctx.fillRect(-w / 2, -1.02 * k, w, 0.24 * k)
    ctx.fillStyle = '#E8C547'
    ctx.beginPath(); ctx.roundRect(-w / 2, -1.6 * k, w, 0.62 * k, 0.06 * k); ctx.fill()
    // bras levés, gants
    ctx.strokeStyle = '#E8C547'
    ctx.lineWidth = 0.1 * k
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-w * 0.45, -1.5 * k); ctx.lineTo(-w * 1.05, -2.0 * k)
    ctx.moveTo(w * 0.45, -1.5 * k); ctx.lineTo(w * 1.05, -2.0 * k)
    ctx.stroke()
    ctx.fillStyle = '#1b1b1f'
    ctx.beginPath(); ctx.arc(-w * 1.08, -2.05 * k, 0.08 * k, 0, Math.PI * 2); ctx.arc(w * 1.08, -2.05 * k, 0.08 * k, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#e8c9a8'
    ctx.beginPath(); ctx.arc(0, -1.72 * k, 0.12 * k, 0, Math.PI * 2); ctx.fill()
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
    ctx.save()
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.clip()
    const grad = ctx.createRadialGradient(s.x - r * 0.35, s.y - r * 0.4, r * 0.1, s.x, s.y, r)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(1, '#bdbdbd')
    ctx.fillStyle = grad
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2)
    ctx.fillStyle = '#1b1b1f'
    for (let i = 0; i < 5; i++) {
      const a = eng.spin + (i * Math.PI * 2) / 5
      const px = s.x + Math.cos(a) * r * 0.62, py = s.y + Math.sin(a) * r * 0.62
      ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, Math.PI * 2); ctx.fill()
    }
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.26, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke()
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
      const eng = engineRef.current
      eng.lastW = rect.width
      eng.lastH = (rect.height / rect.width) * LW
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
      step(dt)
      drawScene(ctx)
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
      }
      raf = requestAnimationFrame(loop)
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

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    if (eng.phase !== 'aim') return
    const p = toLogical(e)
    const bs = ballScreen()
    if (Math.hypot(p.x - bs.x, p.y - bs.y) > TOUCH_RADIUS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    eng.swiping = true
    eng.swipe = [p]
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current
    if (!eng.swiping) return
    const p = toLogical(e)
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
    if (a.y - b.y < 50 || len < 60) return // geste trop court / pas vers le but
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
    shoot(target, curl)
  }

  return (
    <div className="predictions-screen dribble-page" ref={wrapperRef}>
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
            Pose le doigt sur le ballon et glisse vers l'endroit du but où tu veux le mettre : le ballon arrive
            là où tu lèves le doigt. Trace un geste en arc pour donner de l'effet (un arc vers la droite part à
            droite puis revient) et contourner le mur. Lève le doigt sous la ligne de but pour une frappe à ras
            de terre : elle passe sous le mur quand il saute. Le mur couvre un poteau, le gardien l'autre ; plus
            tu marques, plus c'est loin, excentré, et plus le gardien est vif — et le mur finit par sauter.
            But = 1 point, lucarne = 2 points. Au premier raté, la série s'arrête. Même série de coups francs
            pour tout le monde cette semaine.
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
          {phase === 'idle' && (
            <div className="dribble-idle-msg">
              <span style={{ fontSize: 30 }}>🧱</span>
              <p className="dribble-sub">Glisse du ballon vers la lucarne. Le mur et le gardien t'attendent.</p>
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
          {lastWeekBest && <p className="juggle-palmares-row">Semaine dernière : <b>{lastWeekBest.score}</b> ({lastWeekBest.pseudo})</p>}
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
