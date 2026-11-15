// Moteur du Dribble (mode infini, déplacement libre façon Toro).
// Le terrain défile : ton joueur remonte vers le haut, les défenseurs arrivent
// en face et te pressent (ils ont de l'élan et un temps de réaction : une
// feinte les met dans le vent). Contact = ballon perdu. Chaque défenseur passé
// = 1 point. DRIBBLE : crochet d'une demi-seconde qui passe à travers un
// défenseur, mais il coûte de l'endurance, qui se recharge avec le temps.
// Coordonnées : px logiques, largeur fixe W = 360, hauteur selon l'écran.

export const W = 360
const SPR = 2                 // 1 pixel du sprite = 2 px logiques
const RUN_FW = 40, RUN_FH = 48, DEF_FW = 35, DEF_FH = 40
const BODY_R = 13             // rayon de contact (joueur et défenseur)
const STAMINA_COST = 45       // un dribble
const STAMINA_REGEN = 9       // par seconde (≈ 5 s pour un dribble)
const DRIBBLE_TIME = 0.5
const MAX_SCORE = 2000

type Def = {
  x: number; y: number; vx: number; vy: number
  tx: number; react: number   // cible horizontale visée (mise à jour avec un temps de réaction)
  beaten: boolean; dribbled: boolean; t: number; side: number
}

export type Level = { maxDefs: number; vx: number; accel: number; react: number; every: number; scroll: number; lead: number; duo: number }
// paliers : plus de défenseurs, plus rapides, plus malins
export function levelFor(s: number): Level {
  if (s < 10) return { maxDefs: 1, vx: 105, accel: 420, react: 0.32, every: 1.2, scroll: 140 + s * 3, lead: 0, duo: 0 }
  if (s < 25) return { maxDefs: 2, vx: 135, accel: 520, react: 0.27, every: 1.35, scroll: 150 + (s - 10) * 2, lead: 0.1, duo: 0 }
  if (s < 45) return { maxDefs: 3, vx: 160, accel: 600, react: 0.23, every: 1.15, scroll: 180 + (s - 25) * 1.5, lead: 0.2, duo: 0.3 }
  if (s < 70) return { maxDefs: 3, vx: 185, accel: 700, react: 0.19, every: 1.0, scroll: 210 + (s - 45) * 1.2, lead: 0.35, duo: 0.4 }
  return { maxDefs: 4, vx: 210, accel: 800, react: 0.15, every: 0.85, scroll: Math.min(300, 240 + (s - 70)), lead: 0.45, duo: 0.5 }
}
export const TIERS: [number, string][] = [
  [10, '10 ! Deux défenseurs'],
  [25, '25 ! Ils te prennent à deux'],
  [45, '45 ! Ils lisent tes feintes'],
  [70, '70 ! Mode légende'],
]

export type EngineCallbacks = {
  onPoint: (score: number) => void
  onLose: (score: number) => void
  onDribble: (ok: boolean) => void
  onStamina: (v: number) => void       // 0..100
  onTier: (msg: string) => void
  onSpeed: (pct: number) => void      // 0..1
}

export function createDribbleEngine(canvas: HTMLCanvasElement, imgs: { runner: HTMLImageElement; def: HTMLImageElement; ball: HTMLImageElement }, cb: EngineCallbacks) {
  const ctx = canvas.getContext('2d')!
  let H = 560, scale = 1
  const resize = () => {
    const r = canvas.getBoundingClientRect()
    if (!r.width) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr)
    scale = canvas.width / W; H = canvas.height / scale
  }
  resize()

  // état
  let playing = false, raf = 0, last = 0, time = 0
  let score = 0, stamina = 100, dribbleT = 0, scroll = 0, spawnT = 0
  let lost: { x: number; y: number; t: number } | null = null
  const me = { x: W / 2, y: 0, vx: 0, vy: 0, tx: W / 2, ty: 0 }
  let defs: Def[] = []
  let holdDir = 0          // -1 / +1 tant qu'on garde ◀ ▶ appuyé
  let dragging = false

  const lv = () => levelFor(score)
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const yMin = () => H * 0.48, yMax = () => H * 0.86

  function reset() {
    score = 0; stamina = 100; dribbleT = 0; scroll = 0; spawnT = 0.6; time = 0; lost = null
    me.x = W / 2; me.y = H * 0.78; me.vx = 0; me.vy = 0; me.tx = me.x; me.ty = me.y
    defs = []; holdDir = 0; dragging = false
    cb.onStamina(stamina); cb.onSpeed(0)
  }

  function spawn() {
    const L = lv()
    const duo = defs.length + 2 <= L.maxDefs && Math.random() < L.duo
    if (duo) {
      // deux défenseurs qui ferment l'espace des deux côtés du joueur
      const gap = 70 + Math.random() * 30
      for (const s of [-1, 1]) defs.push(mk(clamp(me.x + s * gap, 30, W - 30), -40 - Math.random() * 20, s))
    } else {
      defs.push(mk(30 + Math.random() * (W - 60), -40, 0))
    }
  }
  const mk = (x: number, y: number, side: number): Def => ({ x, y, vx: 0, vy: 0, tx: x, react: 0, beaten: false, dribbled: false, t: Math.random(), side })

  function step(dt: number) {
    const L = lv()
    time += dt
    // ---- joueur : suit le doigt (ou ◀ ▶) avec de l'élan
    if (holdDir) me.tx = clamp(me.tx + holdDir * 300 * dt, 24, W - 24)
    const pv = dribbleT > 0 ? 330 : 270
    const ax = clamp((me.tx - me.x) * 9 - me.vx * 1.2, -1800, 1800)
    const ay = clamp((me.ty - me.y) * 9 - me.vy * 1.2, -1800, 1800)
    me.vx = clamp(me.vx + ax * dt, -pv, pv); me.vy = clamp(me.vy + ay * dt, -pv * 0.7, pv * 0.7)
    me.x = clamp(me.x + me.vx * dt, 22, W - 22); me.y = clamp(me.y + me.vy * dt, yMin(), yMax())
    // ---- défilement (le joueur avance)
    const S = L.scroll
    scroll += S * dt
    cb.onSpeed(clamp((S - 120) / 180, 0, 1))
    // ---- endurance
    if (dribbleT > 0) dribbleT -= dt
    else if (stamina < 100) { stamina = Math.min(100, stamina + STAMINA_REGEN * dt); cb.onStamina(stamina) }
    // ---- défenseurs
    spawnT -= dt
    if (spawnT <= 0 && defs.filter((d) => !d.beaten).length < L.maxDefs) { spawn(); spawnT = L.every * (0.8 + Math.random() * 0.4) }
    for (const d of defs) {
      d.t += dt
      if (!d.beaten) {
        // réagit avec un temps de retard : vise où tu vas être (anticipation selon le palier)
        d.react -= dt
        if (d.react <= 0) {
          d.react = L.react
          const lead = clamp(me.vx * L.lead, -90, 90)
          d.tx = clamp(me.x + lead + d.side * 18, 20, W - 20)
        }
        const ax2 = clamp((d.tx - d.x) * 7 - d.vx * 1.6, -L.accel, L.accel)
        d.vx = clamp(d.vx + ax2 * dt, -L.vx, L.vx)
        // il monte presser le porteur (en plus du défilement)
        const press = d.y < me.y - 120 ? 40 : 15
        d.vy = S + press
        if (d.dribbled) { d.vx *= 0.9; d.vy = S * 0.9 }
        if (d.y > me.y + 16) {
          d.beaten = true
          score = Math.min(MAX_SCORE, score + 1)
          const before = score - 1
          const tier = TIERS.find(([at]) => before < at && score >= at)
          if (tier) cb.onTier(tier[1])
          cb.onPoint(score)
        }
      } else {
        d.vx *= 0.96; d.vy = S * 1.05   // dans le vent : il reste sur place pendant que tu files
      }
      d.x = clamp(d.x + d.vx * dt, 18, W - 18); d.y += d.vy * dt
      // contact
      if (!d.beaten && !d.dribbled) {
        const dx = d.x - me.x, dy = (d.y - 6) - (me.y - 6)
        if (dx * dx + dy * dy < (BODY_R * 2) ** 2) {
          if (dribbleT > 0) { d.dribbled = true; d.vx = -Math.sign(dx || 1) * 60 }
          else { lose(d); return }
        }
      }
    }
    defs = defs.filter((d) => d.y < H + 80)
  }

  function lose(d: Def) {
    playing = false
    lost = { x: (d.x + me.x) / 2, y: (d.y + me.y) / 2 - 20, t: 0 }
    cb.onLose(score)
  }

  // ---------------- dessin
  function draw() {
    const g = ctx
    g.setTransform(scale, 0, 0, scale, 0, 0)
    g.imageSmoothingEnabled = false
    // pelouse rayée qui défile
    const band = 46, off = scroll % (band * 2)
    g.fillStyle = '#1b5c20'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#226b27'
    for (let y = -band * 2 + off; y < H; y += band * 2) g.fillRect(0, y, W, band)
    // lignes : bords, et une ligne médiane + rond central qui passent de temps en temps
    g.strokeStyle = 'rgba(236,240,226,.85)'; g.lineWidth = 3
    g.strokeRect(6, -10, W - 12, H + 20)
    const every = 900, ly = (scroll % every) - 200
    g.beginPath(); g.moveTo(6, ly); g.lineTo(W - 6, ly); g.stroke()
    g.beginPath(); g.arc(W / 2, ly, 46, 0, Math.PI * 2); g.stroke()
    g.fillStyle = 'rgba(236,240,226,.85)'; g.beginPath(); g.arc(W / 2, ly, 4, 0, Math.PI * 2); g.fill()

    // ombres
    const shadow = (x: number, y: number, w: number) => { g.fillStyle = 'rgba(0,20,6,.4)'; g.beginPath(); g.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2); g.fill() }
    // défenseurs (derrière le joueur s'ils sont plus haut)
    const drawDef = (d: Def) => {
      const f = Math.floor(d.t * 10) % 4
      shadow(d.x, d.y + 2, 17)
      g.save()
      if (d.dribbled || d.beaten) g.globalAlpha = d.beaten ? 0.85 : 1
      if (d.dribbled) { g.translate(d.x, d.y); g.rotate(Math.sin(d.t * 20) * 0.3); g.translate(-d.x, -d.y) }
      g.drawImage(imgs.def, f * DEF_FW, 0, DEF_FW, DEF_FH, d.x - DEF_FW * SPR / 2, d.y - DEF_FH * SPR + 8, DEF_FW * SPR, DEF_FH * SPR)
      g.restore()
      // « ! » quand il fonce sur toi
      if (!d.beaten && !d.dribbled && d.y > me.y - 170 && d.y < me.y - 30 && Math.abs(d.x - me.x) < 60) {
        g.fillStyle = '#ffd84a'; g.strokeStyle = '#15130f'; g.lineWidth = 2
        const bx = d.x, by = d.y - DEF_FH * SPR + 2 - (Math.floor(time * 8) % 2) * 3
        for (const [ox, oy, h] of [[-9, 4, 9], [0, 0, 11], [9, 4, 9]]) { g.save(); g.translate(bx + ox, by + oy); g.rotate(ox * 0.03); g.strokeRect(-2, -h, 4, h); g.fillRect(-2, -h, 4, h); g.restore() }
      }
    }
    const before = defs.filter((d) => d.y <= me.y), after = defs.filter((d) => d.y > me.y)
    before.forEach(drawDef)
    // joueur
    shadow(me.x, me.y + 2, 18)
    let f = Math.floor(time * 11) % 4; f = [0, 1, 2, 1][f]
    let ball = true
    if (me.vx > 120) { f = 3 + (Math.floor(time * 8) % 2); ball = false }
    else if (me.vx < -120) { f = 5 + (Math.floor(time * 8) % 2); ball = false }
    g.save()
    if (dribbleT > 0) {
      const k = 1 - dribbleT / DRIBBLE_TIME
      g.translate(me.x, me.y - 30); g.rotate(k * Math.PI * 2); g.translate(-me.x, -(me.y - 30))
    }
    g.drawImage(imgs.runner, f * RUN_FW, 0, RUN_FW, RUN_FH, me.x - RUN_FW * SPR / 2, me.y - RUN_FH * SPR + 12, RUN_FW * SPR, RUN_FH * SPR)
    g.restore()
    if (ball && dribbleT <= 0) {
      const bob = Math.abs(Math.sin(time * 9)) * 4
      g.drawImage(imgs.ball, me.x - 10 + Math.sin(time * 4.5) * 3, me.y - RUN_FH * SPR + 14 - bob, 20, 18)
    }
    if (dribbleT > 0) {
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3
      g.beginPath(); g.ellipse(me.x, me.y - 2, 30, 10, 0, 0.2, Math.PI - 0.2); g.stroke()
    }
    after.forEach(drawDef)
    // contact : éclair rouge
    if (lost) {
      lost.t += 1 / 60
      g.fillStyle = `rgba(193,68,60,${Math.max(0, 0.6 - lost.t)})`
      g.beginPath(); g.arc(lost.x, lost.y, 40 + lost.t * 80, 0, Math.PI * 2); g.fill()
    }
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    if (playing) step(dt)
    draw()
    if (playing || (lost && lost.t < 0.7)) raf = requestAnimationFrame(loop)
  }

  // aide aux tests automatiques (?debug dans l'adresse) : lecture seule
  if (typeof location !== 'undefined' && location.search.includes('debug')) {
    (window as unknown as Record<string, unknown>).__dribbleDbg = { me, defs: () => defs, score: () => score, stamina: () => stamina, W, H: () => H }
  }

  return {
    reset() { cancelAnimationFrame(raf); reset(); draw() },
    start() { playing = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) },
    stop() { playing = false; cancelAnimationFrame(raf) },
    isPlaying: () => playing,
    resize() { resize(); draw() },
    redraw: draw,
    // doigt sur le terrain : le joueur va vers le doigt (un peu au-dessus, pour le voir)
    pointer(xPx: number, yPx: number, down: boolean) {
      const r = canvas.getBoundingClientRect()
      if (!down) { dragging = false; return }
      dragging = true
      me.tx = clamp((xPx - r.left) / r.width * W, 24, W - 24)
      me.ty = clamp((yPx - r.top) / r.height * H - 40, yMin(), yMax())
    },
    hold(dir: number) { holdDir = dir; if (!dir && !dragging) me.tx = me.x + me.vx * 0.12 },
    dribble(): boolean {
      if (!playing || dribbleT > 0) return false
      if (stamina < STAMINA_COST) { cb.onDribble(false); return false }
      stamina -= STAMINA_COST; dribbleT = DRIBBLE_TIME
      cb.onStamina(stamina); cb.onDribble(true)
      return true
    },
    canDribble: () => stamina >= STAMINA_COST,
  }
}
