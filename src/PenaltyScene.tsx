import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import './PenaltyScene.css'

// Scène des tirs au but : décor du stade, gardien et tireur animés image par
// image (découpés dans des vidéos), ballon et filet calculés en direct.
// Coordonnées en pixels de l'image du décor (941 × 1410).

const IMG = '/penalty/'
const ZONES: Record<string, [number, number]> = {
  'haut-gauche': [325, 543], 'haut-droite': [825, 543],
  'milieu': [565, 640],
  'bas-gauche': [330, 705], 'bas-droite': [825, 705],
}
const FR = ['stance', 'crouch', 'takeoff', 'fly', 'reach', 'lying'] as const
const KICK_FR = ['stand', 'step', 'wind', 'strike', 'follow', 'end'] as const
type KFrame = { hx: number; hy: number; cx: number; bottom: number; top: number }
type KMeta = { w: number; h: number; frames: KFrame[] }
// taille de chaque plongeon et repères (main la plus avancée, centre, pieds) par image
const KF: Record<string, KMeta> = {"hr":{"w":424,"h":407,"frames":[{"hx":209,"hy":109,"cx":205.5,"bottom":400,"top":99},{"hx":256,"hy":114,"cx":207.2,"bottom":402,"top":104},{"hx":295,"hy":71,"cx":226.7,"bottom":395,"top":61},{"hx":406,"hy":25,"cx":222.9,"bottom":307,"top":4},{"hx":406,"hy":94,"cx":220.4,"bottom":344,"top":47},{"hx":364,"hy":207,"cx":236.5,"bottom":344,"top":195}]},"lr":{"w":431,"h":313,"frames":[{"hx":319,"hy":190,"cx":208.3,"bottom":308,"top":4},{"hx":307,"hy":145,"cx":213.7,"bottom":307,"top":24},{"hx":378,"hy":221,"cx":231.2,"bottom":304,"top":37},{"hx":417,"hy":245,"cx":243.4,"bottom":292,"top":86},{"hx":418,"hy":282,"cx":255.9,"bottom":285,"top":119},{"hx":385,"hy":176,"cx":255.0,"bottom":286,"top":150}]},"hl":{"w":436,"h":411,"frames":[{"hx":219,"hy":114,"cx":229.6,"bottom":406,"top":100},{"hx":155,"hy":122,"cx":207.3,"bottom":406,"top":110},{"hx":58,"hy":132,"cx":200.1,"bottom":381,"top":59},{"hx":17,"hy":48,"cx":204.8,"bottom":350,"top":4},{"hx":66,"hy":55,"cx":186.2,"bottom":369,"top":43},{"hx":76,"hy":230,"cx":189.4,"bottom":384,"top":216}]},"ll":{"w":446,"h":324,"frames":[{"hx":122,"hy":192,"cx":229.3,"bottom":319,"top":4},{"hx":84,"hy":173,"cx":208.9,"bottom":315,"top":19},{"hx":41,"hy":215,"cx":194.9,"bottom":301,"top":24},{"hx":13,"hy":271,"cx":191.3,"bottom":293,"top":92},{"hx":14,"hy":284,"cx":171.6,"bottom":285,"top":121},{"hx":39,"hy":189,"cx":169.3,"bottom":298,"top":157}]}}

export type PlayOptions = {
  shot: string                 // zone où part le ballon
  dive: string | null          // zone où plonge le gardien (null : il ne bouge pas)
  goal?: boolean               // résultat (sinon : but si les zones diffèrent)
  blind?: boolean              // tir à l'aveugle : le ballon s'efface en arrivant, pas de résultat
  onKick?: () => void
  onResult?: (goal: boolean) => void
}
export type PenaltySceneHandle = { play: (o: PlayOptions) => Promise<void> }

type Props = {
  canPick: boolean
  allowSwipe?: boolean
  onPick: (zone: string) => void
  hudLabel: string             // « TIR » ou « ARRÊT »
  done: number                 // tentatives déjà jouées (0 à 3)
  hint: string | null
  ref?: Ref<PenaltySceneHandle>
}

// préchargement des images (une seule fois)
let preloaded = false
function preload() {
  if (preloaded) return
  preloaded = true
  const names = ['stade', 'ballon', ...KICK_FR.map((n) => 'tireur_' + n)]
  for (const a of Object.keys(KF)) for (const n of FR) names.push(`gardien_${a}_${n}`)
  for (const n of names) { const im = new Image(); im.src = IMG + n + '.webp' }
}

function createEngine(root: HTMLDivElement) {
  const q = <T extends Element>(s: string) => root.querySelector(s) as T
  const ball = q<HTMLImageElement>('.pks-ball'), shadow = q<HTMLDivElement>('.pks-shadow')
  const banner = q<HTMLDivElement>('.pks-banner'), flash = q<HTMLDivElement>('.pks-flash'), ripple = q<HTMLDivElement>('.pks-ripple')
  const px = () => root.clientWidth / 941
  // perspective : sol au point de penalty (y 1042) et sur la ligne de but (y 762)
  const GROUND_NEAR = 1042, GROUND_GOAL = 762, BALL_R = 52, G = 2600
  const scaleAt = (d: number) => Math.max(0.3, 1 - 0.64 * d)
  const groundAt = (d: number) => GROUND_NEAR + (GROUND_GOAL - GROUND_NEAR) * Math.min(d, 1.12)
  const easeOut = (t: number, k = 2) => 1 - Math.pow(1 - t, k)
  const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x) }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))
  const heightFor = (ty: number) => (GROUND_GOAL - ty) / scaleAt(1) - BALL_R

  function drawBall(x: number, d: number, h: number, spin: number, alpha = 1) {
    ball.style.zIndex = d > 0.12 ? '3' : '5'          // plus loin que le tireur : passe derrière lui
    const s = scaleAt(d), gy = groundAt(d), cy = gy - (h + BALL_R) * s, k = px()
    ball.style.transform = `translate(${(x - 488) * k}px, ${(cy - 990) * k}px) scale(${s}) rotate(${spin}deg)`
    ball.style.opacity = String(alpha)
    shadow.style.transform = `translate(${(x - 488) * k}px, ${(gy - 1042) * k}px) scale(${s * Math.max(0.35, 1 - h / 900)})`
    shadow.style.opacity = String(Math.max(0.12, 0.55 - h / 1400) * alpha)
  }

  // ---------------- gardien : 6 images par plongeon
  const GROUND = 772, KX = 565
  const kfEl: Record<string, { el: HTMLDivElement; imgs: HTMLImageElement[]; K: number }> = {}
  for (const a of Object.keys(KF)) {
    const m = KF[a], st = m.frames[0]
    const K = 210 / (st.bottom - st.top)
    const el = q<HTMLDivElement>('.pks-kf-' + a)
    el.style.width = (m.w * K / 941 * 100) + '%'
    el.style.aspectRatio = m.w + ' / ' + m.h
    el.style.left = ((KX - st.cx * K) / 941 * 100) + '%'
    el.style.top = ((GROUND - st.bottom * K) / 1410 * 100) + '%'
    el.style.transformOrigin = (st.cx / m.w * 100) + '% 50%'
    kfEl[a] = { el, imgs: Array.from(el.querySelectorAll('img')), K }
  }
  function showFrames(a: string, weights: number[], ox: number, oy: number, sq = 0) {
    for (const k of Object.keys(kfEl)) kfEl[k].el.style.visibility = k === a ? 'visible' : 'hidden'
    const { el, imgs } = kfEl[a], k = px()
    imgs.forEach((im, i) => (im.style.opacity = String(weights[i] || 0)))
    el.style.transform = `translate(${ox * k}px, ${oy * k}px) scale(${1 + sq * 0.5}, ${1 - sq})`
  }
  type Plan = { stay: true } | { mid: true } | { a: string; peak: [number, number]; land: [number, number] }
  function keeperPlan(z: string | null): Plan {
    if (!z) return { stay: true }
    if (z === 'milieu') return { mid: true }
    const [zx, zy] = ZONES[z]
    const a = (z.startsWith('haut') ? 'h' : 'l') + (zx < KX ? 'l' : 'r'), m = KF[a], K = kfEl[a].K
    const st = m.frames[0], fly = m.frames[3], ly = m.frames[5]
    const hx = KX + Math.abs(fly.hx - st.cx) * K, hy = GROUND - (st.bottom - fly.hy) * K
    const sg = zx < KX ? -1 : 1
    const peak: [number, number] = [sg * (Math.abs(zx - KX) - (hx - KX)), zy - hy]
    const land: [number, number] = [peak[0] + sg * 14, (st.bottom - ly.bottom) * K]
    return { a, peak, land }
  }
  // temps (s) : élan, impulsion, vol (mains sur le ballon), retombée, au sol
  const T_CROUCH = 0.10, T_TAKE = 0.20, T_PEAK = 0.34, T_REACH = 0.46, T_LAND = 0.60
  function keeperAt(plan: Plan, t: number) {
    if ('stay' in plan) return showFrames('hr', [1], 0, 0)
    if ('mid' in plan) {                              // au milieu : reste sur ses appuis, petit saut
      const u = Math.max(0, t - 0.12)
      const hop = u < 0.5 ? Math.sin(Math.PI * u / 0.5) : 0
      return showFrames('hr', [1], 0, -46 * hop, t < 0.12 ? 0.06 * smooth(0, 0.12, t) : 0)
    }
    const cuts = [0.04, T_CROUCH, T_TAKE, T_PEAK + 0.06, T_REACH + 0.08]
    let i = 0
    while (i < cuts.length && t >= cuts[i]) i++
    const w = [0, 0, 0, 0, 0, 0]
    const f = Math.min(1, (i ? t - cuts[i - 1] : 1) / 0.02)
    w[i] = 1; if (i && f < 1) w[i - 1] = 1 - f
    const sg = Math.sign(plan.land[0] - plan.peak[0]) || 1
    let ox: number, oy: number
    if (t < T_CROUCH) { ox = 0; oy = 0 }
    else if (t < T_PEAK) { const u = (t - T_CROUCH) / (T_PEAK - T_CROUCH); ox = plan.peak[0] * easeOut(u, 1.5); oy = plan.peak[1] * easeOut(u, 2) }
    else if (t < T_LAND) { const u = (t - T_PEAK) / (T_LAND - T_PEAK); ox = lerp(plan.peak[0], plan.land[0], u); oy = plan.peak[1] + (plan.land[1] - plan.peak[1]) * u * u }
    else { const b = Math.min(1, (t - T_LAND) / 0.4); ox = plan.land[0] + sg * 22 * easeOut(b, 3); oy = plan.land[1] - 10 * Math.abs(Math.sin(Math.PI * 2 * b)) * (1 - b) * (1 - b) }
    const sq = t >= T_LAND ? 0.08 * Math.max(0, 1 - (t - T_LAND) / 0.12) : 0
    showFrames(plan.a, w, ox, oy, sq)
  }

  // ---------------- filet dessiné en direct : il se creuse et ondule quand le ballon entre
  const netCv = q<HTMLCanvasElement>('.pks-net'), nctx = netCv.getContext('2d')!
  const NET = { x0: 262, y0: 486, w: 640, h: 273, step: 12.5 }
  let netImpact: { x: number; y: number; t0: number } | null = null
  function drawNet(imp: { x: number; y: number } | null, t: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const cw = Math.round(netCv.clientWidth * dpr), ch = Math.round(netCv.clientHeight * dpr)
    if (!cw) return
    if (netCv.width !== cw || netCv.height !== ch) { netCv.width = cw; netCv.height = ch }
    const k = cw / NET.w
    nctx.clearRect(0, 0, cw, ch)
    const cols = Math.floor(NET.w / NET.step) + 1, rows = Math.floor(NET.h / NET.step) + 1
    let amp = 0, cx = 0, cy = 0, wave = 0
    if (imp && t < 2.2) {
      cx = imp.x - NET.x0; cy = imp.y - NET.y0
      amp = Math.exp(-2.2 * t) * (0.6 + 0.4 * Math.cos(12 * t)) * Math.min(1, t / 0.05)
      wave = t * 420
    }
    const node = (i: number, j: number) => {
      let x = Math.min(NET.w, i * NET.step), y = Math.min(NET.h, j * NET.step)
      y += 3 * Math.sin(Math.PI * x / NET.w) * (1 - y / NET.h)              // le filet pend un peu
      if (amp > 0.002) {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy)
        const g = Math.exp(-r * r / (2 * 120 * 120))
        const edge = Math.min(1, Math.min(x, NET.w - x, y + 30) / 40)        // tenu par les poteaux
        const pull = 0.62 * amp * g * edge
        const rip = 9 * amp * Math.exp(-Math.pow((r - wave) / 38, 2)) * edge
        x -= dx * pull - (r ? dx / r : 0) * rip
        y -= dy * pull - (r ? dy / r : 0) * rip - 30 * amp * g * edge
      }
      return [x * k, y * k]
    }
    nctx.strokeStyle = 'rgba(214,198,160,.72)'; nctx.lineWidth = Math.max(1, 1.1 * k); nctx.lineJoin = 'round'
    nctx.beginPath()
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [x, y] = node(i, j); if (i) nctx.lineTo(x, y); else nctx.moveTo(x, y) }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const [x, y] = node(i, j); if (j) nctx.lineTo(x, y); else nctx.moveTo(x, y) }
    nctx.stroke()
  }

  // ---------------- tireur : 6 images (attente, appel, armé, frappe, accompagnement)
  const KICK = 0.26                                    // le ballon part à cet instant
  const kickImgs = Array.from(root.querySelectorAll<HTMLImageElement>('.pks-kick img'))
  function kickAt(tk: number) {
    const cuts = [0.02, 0.12, KICK - 0.02, KICK + 0.07, KICK + 0.24]
    let i = 0
    while (i < cuts.length && tk >= cuts[i]) i++
    if (tk > 1.5) i = 0                                // il se replace
    kickImgs.forEach((im, j) => (im.style.opacity = j === i ? '1' : '0'))
  }

  let raf = 0, busy = false, done: (() => void) | null = null
  function reset() {
    cancelAnimationFrame(raf); netImpact = null; drawNet(null, 0); kickAt(0)
    showFrames('hr', [1], 0, 0)
    ball.style.transform = ''; ball.style.opacity = '1'; ball.style.zIndex = '5'; shadow.style.opacity = '0'
    banner.className = 'pks-banner'; flash.className = 'pks-flash'
    busy = false
    if (done) { const d = done; done = null; d() }
  }
  function show(txt: string, save: boolean) { banner.textContent = txt; banner.className = 'pks-banner show' + (save ? ' save' : '') }

  function play(o: PlayOptions): Promise<void> {
    if (busy) reset()
    busy = true
    return new Promise((resolve) => {
      done = resolve
      const plan = keeperPlan(o.dive)
      const shot = o.shot in ZONES ? o.shot : 'milieu'
      const goal = o.blind ? false : o.goal ?? shot !== o.dive
      const [tx, ty] = ZONES[shot]
      const lob = shot === 'milieu'
      const T = lob ? 0.95 : 0.55                      // durée du vol
      const hT = heightFor(ty), arc = lob ? 520 : 120
      const curve = (tx > 565 ? -1 : 1) * (lob ? 0 : 28)
      // en tir à l'aveugle le gardien ne bouge pas : le ballon s'efface avant d'arriver
      const END = o.blind ? T + 1.0 : T + 2.2
      let after: { x: number; d: number; h: number; vd: number; vx: number; vh: number; spin: number } | null = null
      let kicked = false, blindShown = false
      const t0 = performance.now()
      const frame = (now: number) => {
        const tk = (now - t0) / 1000, t = tk - KICK
        kickAt(tk)
        if (t < 0) { drawBall(488, 0, 0, 0); keeperAt(plan, 0); raf = requestAnimationFrame(frame); return }
        if (!kicked) { kicked = true; o.onKick?.() }
        keeperAt(plan, Math.max(0, t - Math.max(0.03, T - T_PEAK)))
        if (netImpact) drawNet(netImpact, (now - netImpact.t0) / 1000)
        if (o.blind) {
          const d = Math.min(t / T, 1)
          const fade = 1 - smooth(0.62, 0.86, d)
          drawBall(488 + (tx - 488) * d + curve * Math.sin(Math.PI * d), d, hT * d + arc * d * (1 - d), t * (lob ? 300 : 900), fade)
          if (d > 0.7 && !blindShown) { blindShown = true; show('🤫 Tir envoyé !', true) }
        } else if (t < T) {
          const d = t / T
          drawBall(488 + (tx - 488) * d + curve * Math.sin(Math.PI * d), d, hT * d + arc * d * (1 - d), t * (lob ? 300 : 900))
        } else {
          if (!after) {
            after = goal
              ? { x: tx, d: 1, h: hT, vd: 0.5, vx: 0, vh: 0, spin: T * 900 }
              : { x: tx, d: 1, h: hT, vd: -0.6, vx: (tx < 565 ? -1 : 1) * 260, vh: 420, spin: T * 900 }
            if (goal) {
              netImpact = { x: tx, y: ty, t0: now }
              ripple.style.left = (tx / 941 * 100) + '%'; ripple.style.top = (ty / 1410 * 100) + '%'
              ripple.className = 'pks-ripple'; void ripple.offsetWidth; ripple.className = 'pks-ripple go'
              root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake')
              show(lob ? '🎩 PANENKA ! +2' : '⚽ BUUUT ! +1', false); flash.className = 'pks-flash on'
            } else show('🧤 ARRÊT !', true)
            o.onResult?.(goal)
          }
          const dt = 1 / 60, a = after
          if (goal) {                                    // le filet freine le ballon, puis il retombe
            a.vd *= 0.86; a.d = Math.min(1.12, a.d + a.vd * dt)
            a.vh -= G * dt; a.h += a.vh * dt
            if (a.h < 0) { a.h = 0; a.vh = -a.vh * 0.3 }
          } else {                                       // repoussé : revient vers le tireur en rebondissant
            a.d = Math.max(0.25, a.d + a.vd * dt); a.vd *= 0.985
            a.x += a.vx * dt; a.vx *= 0.99
            a.vh -= G * dt; a.h += a.vh * dt
            if (a.h < 0) { a.h = 0; a.vh = Math.abs(a.vh) > 120 ? -a.vh * 0.45 : 0 }
          }
          a.spin += (goal ? 200 : -500) * dt
          drawBall(a.x, a.d, a.h, a.spin)
        }
        if (t < END) raf = requestAnimationFrame(frame)
        else reset()
      }
      raf = requestAnimationFrame(frame)
    })
  }
  const onResize = () => { if (!busy) reset(); else drawNet(null, 0) }
  window.addEventListener('resize', onResize)
  reset()
  return {
    play,
    isBusy: () => busy,
    destroy: () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); done = null },
  }
}

export default function PenaltyScene({ canPick, allowSwipe, onPick, hudLabel, done, hint, ref }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const engine = useRef<ReturnType<typeof createEngine> | null>(null)
  const pickRef = useRef({ canPick, onPick, allowSwipe })
  pickRef.current = { canPick, onPick, allowSwipe }

  useEffect(() => {
    preload()
    const e = createEngine(rootRef.current!)
    engine.current = e
    return () => { e.destroy(); engine.current = null }
  }, [])

  useImperativeHandle(ref, () => ({
    play: (o) => engine.current ? engine.current.play(o) : Promise.resolve(),
  }), [])

  // un seul choix par tir (un glisser qui finit sur la cage déclenche aussi un clic)
  const lastPick = useRef(0)
  const pick = (z: string) => {
    const p = pickRef.current
    if (!p.canPick || engine.current?.isBusy() || Date.now() - lastPick.current < 1500) return
    lastPick.current = Date.now()
    p.onPick(z)
  }

  // glisser depuis le ballon vers la cage = tir dans la zone la plus proche de la direction
  const start = useRef<[number, number] | null>(null)
  const onDown = (e: React.PointerEvent) => { if (pickRef.current.allowSwipe) start.current = [e.clientX, e.clientY] }
  const onUp = (e: React.PointerEvent) => {
    const s = start.current
    start.current = null
    if (!s || !rootRef.current) return
    const r = rootRef.current.getBoundingClientRect(), dx = e.clientX - s[0], dy = e.clientY - s[1]
    if (Math.hypot(dx, dy) < 40 || dy > -20) return
    const bx = 488 / 941 * r.width, by = 990 / 1410 * r.height
    const k = (by - 620 / 1410 * r.height) / -dy
    const tx = (bx + dx * k) / r.width * 941, ty = 620 + (dy < -180 ? -80 : 60)
    let bestZ = 'milieu', best = 1e9
    for (const [z, [x, y]] of Object.entries(ZONES)) { const d = Math.hypot(x - tx, y - ty); if (d < best) { best = d; bestZ = z } }
    pick(bestZ)
  }

  return (
    <div className={'pks' + (canPick ? '' : ' off')} ref={rootRef} onPointerDown={onDown} onPointerUp={onUp}>
      <img className="pks-bg" src={IMG + 'stade.webp'} alt="" />
      <canvas className="pks-net" />
      {Object.keys(KF).map((a) => (
        <div key={a} className={'pks-kf pks-kf-' + a}>
          {FR.map((n) => <img key={n} src={`${IMG}gardien_${a}_${n}.webp`} alt="" />)}
        </div>
      ))}
      <div className="pks-shadow" />
      <img className="pks-ball" src={IMG + 'ballon.webp'} alt="" />
      <div className="pks-ripple" />
      <div className="pks-kick">
        {KICK_FR.map((n) => <img key={n} src={`${IMG}tireur_${n}.webp`} alt="" />)}
      </div>
      {Object.entries(ZONES).map(([z, [x, y]]) => (
        <div key={z} className="pks-zone" style={{ left: (x / 941 * 100) + '%', top: (y / 1410 * 100) + '%' }}
          onClick={(e) => { e.stopPropagation(); pick(z) }} />
      ))}
      <div className="pks-hud">
        <div><div className="lbl">{hudLabel}</div><div className="val">{Math.min(done + 1, 3)} / 3</div></div>
        <div className="sep" />
        <div><div className="lbl">DUEL</div><div className="pks-dots">{[0, 1, 2].map((i) => <span key={i} className={i < done ? 'on' : ''} />)}</div></div>
      </div>
      <div className="pks-banner" />
      {hint && canPick && <div className="pks-hint">{hint}</div>}
      <div className="pks-flash" />
    </div>
  )
}
