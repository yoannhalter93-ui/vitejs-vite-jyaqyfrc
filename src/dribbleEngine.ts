// Moteur du Dribble (mode infini, déplacement libre au doigt).
// Le terrain défile, ton joueur remonte. Les défenseurs ont chacun un
// comportement (marqueur qui te suit, latéral, change de côté, charge, feinte puis tacle,
// paire qui ferme deux couloirs). Autour de chaque défenseur, une ZONE DE DUEL :
// DRIBBLE dedans au bon moment = PARFAIT +2 ou BIEN +1. Trop tôt : il se
// replace (et l'endurance est dépensée). Trop tard : il prend le ballon.
// Simple évitement = +1. Le dribble coûte de l'endurance (recharge lente).
// Niveau tous les 10 points : vitesse +5 %, nouveaux comportements, décor qui change.
// Coordonnées : px logiques, largeur fixe W = 360, hauteur selon l'écran.

export const W = 360
const SPR = 2
const RUN_FW = 40, RUN_FH = 48, DEF_FW = 35, DEF_FH = 40, TCK_FW = 48, TCK_FH = 44
const BODY_R = 13
const SPIN_TIME = 0.35
const MAX_SCORE = 2000
// fenêtre du dribble : écart vertical joueur ↔ défenseur au moment de l'appui
const DUEL_MAX = 130

type Kind = 'static' | 'lateral' | 'switch' | 'charge' | 'feint' | 'pair' | 'gate'
type Def = {
  kind: Kind; x: number; y: number; vx: number; vyNow: number
  t: number; baseX: number; amp: number; freq: number
  tx: number; react: number
  switched: boolean; lunging: boolean; fakeDir: number; alerted: number
  beaten: boolean; dribbled: boolean; spin: number
  group: number; slot: number
  // « IA » (à partir de 6 points) : approche → temporise (jockey) → tacle
  ai: 'approach' | 'jockey' | 'lunge'; jockeyT: number; lx: number; ly: number
}
type Pair = { id: number; open: number; swaps: number }
type Dust = { x: number; y: number; vx: number; vy: number; life: number; c: string }
type Txt = { s: string; x: number; y: number; life: number; c: string; big: boolean }

export type DribbleKind = 'perfect' | 'good' | 'early' | 'late' | 'none' | 'tired'
export type EngineCallbacks = {
  onPoint: (score: number) => void
  onLose: (score: number) => void
  onDribble: (kind: DribbleKind) => void
  onStamina: (v: number) => void
  onLevel: (level: number, msg: string) => void
  onSpeed: (pct: number) => void
}

// ce qui arrive à chaque niveau (1 niveau = 10 points)
const LEVEL_MSG: Record<number, string> = {
  2: 'Ils ferment deux couloirs',
  3: 'Ils bougent !',
  4: 'Ils chargent et taclent',
  5: 'Ils attaquent à deux',
  6: 'Tout se mélange',
}
function poolFor(level: number): [Kind | 'combo', number][] {
  if (level <= 1) return [['static', 1]]
  if (level === 2) return [['static', 2], ['pair', 2], ['gate', 1]]
  if (level === 3) return [['static', 1], ['pair', 1], ['gate', 1], ['lateral', 2], ['switch', 2]]
  if (level === 4) return [['pair', 1], ['gate', 1], ['lateral', 1], ['switch', 1], ['charge', 2], ['feint', 2]]
  if (level === 5) return [['charge', 1], ['feint', 1], ['switch', 1], ['gate', 1], ['combo', 4]]
  return [['static', 1], ['lateral', 1], ['switch', 1], ['charge', 2], ['feint', 2], ['pair', 1], ['gate', 2], ['combo', 5]]
}
// décor : un peu plus sombre et plus « nocturne » à chaque niveau
const PALETTES = [
  ['#1b5c20', '#226b27'], ['#1a5a24', '#21682c'], ['#185226', '#1f602e'],
  ['#154a26', '#1b562d'], ['#13422a', '#194e31'], ['#103a2a', '#164532'],
]

export function createDribbleEngine(canvas: HTMLCanvasElement, imgs: { runner: HTMLImageElement; def: HTMLImageElement; ball: HTMLImageElement; tackle: HTMLImageElement }, cb: EngineCallbacks) {
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

  let playing = false, raf = 0, last = 0, time = 0
  let invulnT = 0
  let score = 0, level = 1, stamina = 100, spinT = 0, scroll = 0, slowT = 0, flashT = 0
  let nextSpawnAt = 0, groupId = 0, bannerT = 0, bannerText = ''
  let lost: { x: number; y: number; t: number } | null = null
  const me = { x: W / 2, y: 0, vx: 0, vy: 0, tx: W / 2, ty: 0 }
  let defs: Def[] = []
  const pairs: Pair[] = []
  let dust: Dust[] = [], txts: Txt[] = []
  let holdDir = 0

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const yMin = () => H * 0.5, yMax = () => H * 0.86
  // vitesse : +5 % tous les 8 points, plafonnée
  const scrollSpeed = () => 150 * Math.min(1.95, Math.pow(1.06, Math.floor(score / 8)))
  const spacing = () => Math.max(135, 250 - (level - 1) * 20)
  // la difficulté monte avec les niveaux : fenêtre de dribble plus courte, endurance plus chère
  // (rien ne change aux niveaux 1-2 : le temps de prendre le coup de main)
  const hard = () => Math.max(0, level - 2)
  // fenêtres du dribble en TEMPS avant le contact (juste, même quand il tacle vite)
  const perfectWin = () => 0.15 - Math.min(0.05, hard() * 0.009)   // s
  const goodWin = () => 0.28 - Math.min(0.08, hard() * 0.014)      // s
  // temps avant contact avec ce défenseur (s) ; Infinity s'il ne se rapproche pas
  const ttc = (d: Def) => {
    const close = Math.max(40, d.vyNow - me.vy)              // vitesse à laquelle l'écart se réduit
    return (me.y - d.y - BODY_R * 2) / close
  }
  const timing = (d: Def): 'late' | 'perfect' | 'good' | 'early' => {
    const t = ttc(d)
    if (t < 0.02) return 'late'
    if (t <= perfectWin()) return 'perfect'
    if (t <= goodWin()) return 'good'
    return 'early'
  }
  const staminaCost = () => 35 + Math.min(10, hard() * 1.7)
  const staminaRegen = () => Math.max(5.5, 10 - hard() * 0.8)

  function reset() {
    invulnT = 0
    score = 0; level = 1; stamina = 100; spinT = 0; scroll = 0; slowT = 0; flashT = 0; time = 0
    nextSpawnAt = 120; bannerT = 0; lost = null
    me.x = W / 2; me.y = H * 0.78; me.vx = 0; me.vy = 0; me.tx = me.x; me.ty = me.y
    defs = []; pairs.length = 0; dust = []; txts = []; holdDir = 0
    avgX = W / 2; commitDir = 0; commitT = 0; sideBias = 0
    cb.onStamina(stamina); cb.onSpeed(0)
  }

  const mk = (kind: Kind, x: number, y = -50): Def => ({
    kind, x, y, vx: 0, vyNow: 0, t: Math.random() * 6, baseX: x, amp: 0, freq: 0, tx: x, react: 0,
    switched: false, lunging: false, fakeDir: 0, alerted: 0, beaten: false, dribbled: false, spin: 0, group: -1, slot: 0,
    ai: 'approach', jockeyT: 0, lx: x, ly: 0,
  })
  const thirds = [W / 6, W / 2, W * 5 / 6]

  function spawn() {
    const pool = poolFor(level)
    let r = Math.random() * pool.reduce((a, [, w]) => a + w, 0)
    let kind: Kind | 'combo' = pool[0][0]
    for (const [k, w] of pool) { r -= w; if (r <= 0) { kind = k; break } }
    if (kind === 'combo') {
      // deux comportements ensemble, décalés
      const a: Kind[] = ['charge', 'feint', 'lateral', 'switch', 'static']
      const k1 = a[Math.floor(Math.random() * a.length)], k2 = a[Math.floor(Math.random() * a.length)]
      add(k1, -50); add(k2, -130)
      return
    }
    add(kind, -50)
  }
  function add(kind: Kind, y: number) {
    if (kind === 'gate') {
      // la « porte » : deux défenseurs qui te gardent entre eux — la seule
      // solution est de passer au milieu, avant qu'elle se referme
      const id = ++groupId
      const c = clamp(me.x, 90, W - 90)
      for (const s of [-1, 1]) { const d = mk('gate', c + s * 62, y); d.group = id; d.slot = s; d.baseX = c; defs.push(d) }
      return
    }
    if (kind === 'pair') {
      const open = Math.floor(Math.random() * 3), id = ++groupId
      pairs.push({ id, open, swaps: 0 })
      let slot = 0
      for (let i = 0; i < 3; i++) if (i !== open) { const d = mk('pair', thirds[i], y); d.group = id; d.slot = slot++; defs.push(d) }
      return
    }
    const x = kind === 'static' ? clamp(me.x + (Math.random() - 0.5) * 140, 40, W - 40) : 40 + Math.random() * (W - 80)
    const d = mk(kind, x, y)
    if (kind === 'lateral') { d.amp = 60 + Math.random() * 50; d.freq = 1.6 + Math.random() * 1.2; d.baseX = clamp(x, 40 + d.amp, W - 40 - d.amp) }
    if (kind === 'feint') d.fakeDir = Math.random() < 0.5 ? -1 : 1
    defs.push(d)
  }

  function addPoints(n: number) {
    const before = score
    score = Math.min(MAX_SCORE, score + n)
    cb.onPoint(score)
    const lv = Math.floor(score / 10) + 1
    if (lv > level) {
      level = lv
      bannerText = 'NIVEAU ' + level; bannerT = 1.6
      cb.onLevel(level, LEVEL_MSG[level] ?? 'Encore plus vite !')
    }
    void before
  }

  // ---------------- « IA » des défenseurs
  // Ce qu'ils observent : ta position lissée (un zigzag ne les fait pas bouger
  // d'un côté à l'autre), ton côté préféré (ils le ferment), et quand tu
  // t'engages vraiment d'un côté (là, ils anticipent). Ils te temporisent à
  // distance au lieu de foncer, puis taclent : soit quand tu t'engages, soit
  // quand ils ont assez attendu, soit si tu viens à leur contact.
  const SMART_AT = 6
  let avgX = W / 2, commitDir = 0, commitT = 0
  let sideBias = 0                          // > 0 : tu passes plutôt par la droite
  function observe(dt: number) {
    avgX += (me.x - avgX) * Math.min(1, dt / 0.45)
    const dir = Math.abs(me.vx) > 140 ? Math.sign(me.vx) : 0
    if (dir && dir === commitDir) commitT += dt
    else { commitDir = dir; commitT = 0 }
  }
  function smartDefend(d: Def, gap: number, dt: number) {
    const L = Math.min(8, level)
    const JOCKEY_GAP = 112
    const H = Math.max(0, L - 2)
    const lateral = Math.min(300, 202 + L * 4 + H * 14)    // vitesse de côté (dépasse la tienne vers le niveau 6)
    const patience = Math.max(0.45, 1.4 - L * 0.05 - H * 0.12)   // temps max à temporiser
    // couverture à plusieurs : si un autre défenseur proche couvre déjà ton côté, il prend l'autre
    const mates = defs.filter((o) => o !== d && !o.beaten && o.kind !== 'pair' && o.kind !== 'gate' && Math.abs((me.y - o.y) - gap) < 90)
    let cover = 0
    if (mates.length) cover = (mates[0].x < d.x ? 1 : -1) * 38
    const habit = clamp(sideBias, -1, 1) * 18
    if (d.ai === 'approach') {
      if (gap < JOCKEY_GAP + 12) { d.ai = 'jockey'; d.jockeyT = 0 }
      return { target: avgX + habit + cover, vmax: lateral * 0.8, vy: scrollSpeed() + 40, acc: 1500 }
    }
    if (d.ai === 'jockey') {
      d.jockeyT += dt
      // il recule en gardant la distance (mais moins vite que toi si tu avances)
      const vy = clamp((me.y - JOCKEY_GAP - d.y) * 5, -45, 220)
      // il se cale sur ta position lissée : tes zigzags ne le déplacent presque pas
      const target = avgX + clamp(me.x - avgX, -26, 26) + habit + cover
      const committed = commitT > Math.max(0.12, 0.2 - H * 0.015) && Math.abs(me.x - d.x) > 18
      if (committed || d.jockeyT > patience || gap < 70) {
        d.ai = 'lunge'; d.lunging = true; d.alerted = 0.35
        // il tacle là où tu vas être
        d.lx = clamp(me.x + me.vx * (committed ? 0.3 : 0.12), 20, W - 20)
      }
      return { target, vmax: lateral, vy, acc: 2200 }
    }
    // tacle : engagé, il ne peut plus corriger beaucoup (c'est là qu'on le passe)…
    // …sauf les meilleurs (niveau 5+), qui corrigent un peu leur tacle en route
    if (L >= 5) d.lx += (me.x - d.lx) * Math.min(1, dt * (L - 4) * 1.1)
    return { target: d.lx, vmax: 300, vy: scrollSpeed() + 260 + L * 15, acc: 1300 }
  }

  function step(rawDt: number) {
    let dt = rawDt
    if (slowT > 0) { slowT -= rawDt; dt = rawDt * 0.3 }       // mini ralenti après un beau dribble
    time += dt
    if (flashT > 0) flashT -= rawDt
    if (bannerT > 0) bannerT -= rawDt
    // ---- joueur
    if (holdDir) me.tx = clamp(me.tx + holdDir * 300 * dt, 24, W - 24)
    const pv = spinT > 0 ? 320 : 270
    const ax = clamp((me.tx - me.x) * 16 - me.vx * 8, -2400, 2400)
    const ay = clamp((me.ty - me.y) * 16 - me.vy * 8, -2400, 2400)
    me.vx = clamp(me.vx + ax * dt, -pv, pv); me.vy = clamp(me.vy + ay * dt, -pv * 0.7, pv * 0.7)
    me.x = clamp(me.x + me.vx * dt, 22, W - 22); me.y = clamp(me.y + me.vy * dt, yMin(), yMax())
    // poussière quand il court vite sur le côté
    if (Math.abs(me.vx) > 160 && Math.random() < 0.5) puff(me.x, me.y, 1, '#c9b98f')
    observe(dt)
    // ---- défilement
    const S = scrollSpeed()
    scroll += S * dt
    cb.onSpeed(clamp((S - 150) / 105, 0, 1))
    // ---- endurance
    if (invulnT > 0) invulnT -= dt
    if (spinT > 0) spinT -= dt
    else if (stamina < 100) { stamina = Math.min(100, stamina + staminaRegen() * dt); cb.onStamina(stamina) }
    // ---- apparitions (à distance régulière, pas au hasard du temps)
    nextSpawnAt -= S * dt
    if (nextSpawnAt <= 0) { spawn(); nextSpawnAt = spacing() * (0.9 + Math.random() * 0.25) }
    // ---- paires : le couloir libre peut changer en route (niveau 5+)
    for (const p of pairs) {
      const members = defs.filter((d) => d.group === p.id)
      if (!members.length) continue
      // ils ferment le couloir où tu es + un voisin : le trou est toujours loin de toi
      const mine = me.x < W / 3 ? 0 : me.x < W * 2 / 3 ? 1 : 2
      if (p.open === mine && me.y - members[0].y > 60 && p.swaps < (level >= 5 ? 2 : 1)) {
        p.swaps++
        p.open = mine === 1 ? (Math.random() < 0.5 ? 0 : 2) : mine === 0 ? 2 : 0
        members.forEach((d) => { d.alerted = 0.35 })
      }
      const closed = [0, 1, 2].filter((i) => i !== p.open)
      members.forEach((d) => { d.tx = thirds[closed[d.slot]] })
    }
    // ---- défenseurs
    const boost = 1 + 0.08 * (level - 1) + 0.05 * Math.max(0, level - 2)      // plus vifs à chaque niveau
    for (const d of defs) {
      d.t += dt
      if (d.alerted > 0) d.alerted -= dt
      let vy = S
      const gap = me.y - d.y                 // > 0 : il est devant toi
      if (!d.beaten) {
        let vmax = 120, target = d.tx
        switch (d.kind) {
          case 'static':
            // le « marqueur » : se met toujours entre toi et le chemin (avec un temps de réaction)
            d.react -= dt
            if (d.react <= 0) { d.react = Math.max(0.16, 0.44 - level * 0.05); d.tx = me.x + me.vx * (level >= 3 ? 0.15 : 0) }
            target = d.tx; vmax = level === 1 ? 95 : level === 2 ? 115 : 125 * boost; vy = S + 25
            break
          case 'lateral':
            // glisse de gauche à droite… puis te prend au marquage quand tu approches
            if (gap < 170) { d.react -= dt; if (d.react <= 0) { d.react = 0.25; d.tx = me.x } target = d.tx; vmax = 190 * boost }
            else { target = d.baseX + Math.sin(d.t * d.freq) * d.amp; vmax = 200 }
            break
          case 'switch':
            // part d'un côté puis change de ligne pour se mettre devant toi
            if (!d.switched && gap < 230) { d.switched = true; d.alerted = 0.45; d.baseX = me.x + me.vx * 0.25 }
            target = d.baseX; vmax = d.switched ? 260 : 60
            break
          case 'charge':
            // fonce sur toi en suivant tes déplacements (avec un temps de réaction)
            d.react -= dt
            if (d.react <= 0) { d.react = 0.22; d.tx = me.x }
            target = d.tx; vmax = gap < 110 ? 230 : 140; vy = S + 70
            break
          case 'feint':
            // fait mine de partir d'un côté… puis tacle vers toi
            if (gap > 150) { target = clamp(me.x + d.fakeDir * 95, 30, W - 30); vmax = 130 }
            else { if (!d.lunging) { d.lunging = true; d.alerted = 0.4; d.lx = me.x } target = me.x; vmax = 330; vy = S + 40 }
            break
          case 'gate': {
            // le centre de la porte suit le joueur (on ne peut pas la contourner) ;
            // l'ouverture se resserre en approchant : il faut passer à temps
            const mate = defs.find((o) => o !== d && o.group === d.group && !o.beaten)
            const half = clamp(34 + Math.max(0, gap - 40) * 0.22, 34, 62)    // demi-ouverture (centre ↔ défenseur)
            const follow = clamp(me.x, 30 + half, W - 30 - half)
            target = mate ? follow + d.slot * half : me.x
            vmax = 250; vy = S + 20
            break
          }
          case 'pair':
            target = d.tx; vmax = 170 * boost; vy = S + 15
            break
        }
        // au contact, les défenseurs « collants » ferment l'espace : il faut dribbler
        // (lire le défenseur et partir tôt marche encore ; à la dernière seconde, non)
        const stick = d.kind === 'charge' || d.kind === 'feint' ? 260
          : d.kind === 'pair' || d.kind === 'gate' ? 0
          : level >= 3 ? 210 : level >= 2 ? 150 : 0
        if (stick && gap < 70 && gap > 0 && Math.abs(me.x - d.x) < 80) { target = me.x; vmax = Math.max(vmax, stick) }
        if (d.alerted > 0.6) { target = me.x; vmax = 300 }          // trop tôt : il se replace
        // ---- défenseur intelligent (après les 6 premiers points)
        let accMax = 1600
        if (score >= SMART_AT && d.kind !== 'pair' && d.kind !== 'gate' && gap > -10 && gap < 165) {
          const r = smartDefend(d, gap, dt)
          target = r.target; vmax = r.vmax; vy = r.vy; accMax = r.acc
        }
        const acc = clamp((target - d.x) * 9 - d.vx * 4, -accMax, accMax)
        d.vx = clamp(d.vx + acc * dt, -vmax, vmax)
        // passé sans dribble : simple évitement = +1
        if (gap < -16) {
          sideBias = sideBias * 0.6 + (me.x > d.x ? 1 : -1) * 0.4
          d.beaten = true
          addPoints(1)
          txts.push({ s: '+1', x: d.x, y: d.y - 50, life: 0.7, c: '#e8f5e0', big: false })
        }
      } else {
        d.vx *= 0.94
        if (d.dribbled) { d.spin += dt * 9; vy = S * 1.05 }
      }
      d.x = clamp(d.x + d.vx * dt, 18, W - 18); d.y += vy * dt; d.vyNow = vy
      // gerbe de gazon pendant le tacle
      if (d.lunging && !d.dribbled && gap < 175 && gap > -60 && Math.random() < 0.6) {
        dust.push({ x: d.x + (Math.random() - 0.5) * 20, y: d.y + 4, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 60, life: 0.3 + Math.random() * 0.2, c: Math.random() < 0.6 ? '#3f8a3a' : '#c9b98f' })
      }
      // contact
      if (!d.beaten) {
        const dx = d.x - me.x, dy = d.y - me.y
        if (dx * dx + dy * dy < (BODY_R * 2) ** 2 && invulnT <= 0) { lose(d); return }
      }
    }
    // deux défenseurs ne se superposent jamais : ils s'écartent l'un de l'autre
    for (let i = 0; i < defs.length; i++) for (let j = i + 1; j < defs.length; j++) {
      const a = defs[i], b = defs[j]
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), min = 34
      if (dist < min && dist > 0.01) {
        const push = (min - dist) / 2, nx = dx / dist, ny = dy / dist
        a.x = clamp(a.x - nx * push, 18, W - 18); b.x = clamp(b.x + nx * push, 18, W - 18)
        a.y -= ny * push * 0.5; b.y += ny * push * 0.5
      } else if (dist <= 0.01) { a.x = clamp(a.x - 17, 18, W - 18); b.x = clamp(b.x + 17, 18, W - 18) }
    }
    defs = defs.filter((d) => d.y < H + 90)
    for (let i = pairs.length - 1; i >= 0; i--) if (!defs.some((d) => d.group === pairs[i].id)) pairs.splice(i, 1)
    // effets
    for (const p of dust) { p.x += p.vx * dt; p.y += (p.vy + S) * dt; p.life -= dt }
    dust = dust.filter((p) => p.life > 0)
    for (const t of txts) { t.y -= 40 * dt; t.life -= rawDt }
    txts = txts.filter((t) => t.life > 0)
  }

  function puff(x: number, y: number, n: number, c: string) {
    for (let i = 0; i < n; i++) dust.push({ x: x + (Math.random() - 0.5) * 16, y: y + Math.random() * 4, vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 40, life: 0.35 + Math.random() * 0.25, c })
  }

  function lose(d: Def) {
    playing = false
    lost = { x: (d.x + me.x) / 2, y: (d.y + me.y) / 2 - 20, t: 0 }
    cb.onLose(score)
  }

  // défenseur visé par un dribble : le plus proche devant toi, à portée
  function duelTarget() {
    let best: Def | null = null
    for (const d of defs) {
      if (d.beaten) continue
      const gap = me.y - d.y
      if (gap < -6 || gap > DUEL_MAX || Math.abs(d.x - me.x) > 55) continue
      if (!best || gap < me.y - best.y) best = d
    }
    return best
  }

  // DRIBBLE : le geste part toujours et vide toujours l'endurance.
  // Il ne passe le défenseur que s'il est fait au bon moment.
  function dribble() {
    if (!playing || spinT > 0) return
    if (stamina < staminaCost()) { cb.onDribble('tired'); return }
    stamina -= staminaCost(); cb.onStamina(stamina)
    spinT = SPIN_TIME
    puff(me.x, me.y, 6, '#d9c99e')
    const d = duelTarget()
    if (!d) {                                                     // dans le vide
      txts.push({ s: 'DANS LE VIDE', x: me.x, y: me.y - 110, life: 0.7, c: '#cfc6ad', big: false })
      cb.onDribble('none'); return
    }
    const when = timing(d)
    if (when === 'early') {                                        // trop tôt : il se replace devant toi
      d.alerted = 0.9
      txts.push({ s: 'TROP TÔT', x: d.x, y: d.y - 60, life: 0.8, c: '#ffb36b', big: false })
      cb.onDribble('early'); return
    }
    if (when === 'late') {                                         // trop tard : il prend le ballon
      cb.onDribble('late'); lose(d); return
    }
    const perfect = when === 'perfect'
    d.beaten = true; d.dribbled = true; d.vx = (d.x < me.x ? -1 : 1) * 140
    invulnT = SPIN_TIME
    me.ty = clamp(me.y - 30, yMin(), yMax())                       // petit rush vers l'avant
    puff(me.x, me.y, perfect ? 14 : 8, '#d9c99e')
    if (perfect) { slowT = 0.12; flashT = 0.18 }
    const pts = perfect ? 2 : 1
    txts.push({ s: perfect ? 'PARFAIT +2' : 'BIEN +1', x: me.x, y: me.y - 110, life: 0.9, c: perfect ? '#ffd84a' : '#e8f5e0', big: perfect })
    addPoints(pts)
    cb.onDribble(perfect ? 'perfect' : 'good')
  }

  // ---------------- dessin
  function draw() {
    const g = ctx
    g.setTransform(scale, 0, 0, scale, 0, 0)
    g.imageSmoothingEnabled = false
    const pal = PALETTES[Math.min(PALETTES.length - 1, level - 1)]
    const band = 46, off = scroll % (band * 2)
    g.fillStyle = pal[0]; g.fillRect(0, 0, W, H)
    g.fillStyle = pal[1]
    for (let y = -band * 2 + off; y < H; y += band * 2) g.fillRect(0, y, W, band)
    g.strokeStyle = 'rgba(236,240,226,.85)'; g.lineWidth = 3
    g.strokeRect(6, -10, W - 12, H + 20)
    const every = 900, ly = (scroll % every) - 200
    g.beginPath(); g.moveTo(6, ly); g.lineTo(W - 6, ly); g.stroke()
    g.beginPath(); g.arc(W / 2, ly, 46, 0, Math.PI * 2); g.stroke()

    const shadow = (x: number, y: number, w: number) => { g.fillStyle = 'rgba(0,20,6,.4)'; g.beginPath(); g.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2); g.fill() }
    // zones de duel : anneau au sol, doré quand c'est le moment parfait
    for (const d of defs) {
      if (d.beaten) continue
      const gap = me.y - d.y
      if (gap < -6 || gap > 190) continue
      const aligned = Math.abs(d.x - me.x) < 55
      const w = timing(d)
      const perfect = aligned && w === 'perfect'
      const good = aligned && w === 'good'
      g.lineWidth = perfect ? 3 : 2
      g.strokeStyle = perfect ? 'rgba(255,216,74,.95)' : good ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.28)'
      g.beginPath(); g.ellipse(d.x, d.y + 6, 44, 15, 0, 0, Math.PI * 2); g.stroke()
    }
    const drawDef = (d: Def) => {
      const f = Math.floor(d.t * 10) % 4
      // TACLE GLISSÉ : pieds en avant, vers l'endroit visé
      if (d.lunging && !d.dribbled && (d.beaten || me.y - d.y < 175)) {
        const dir = (d.lx || me.x) < d.x - 4 ? -1 : 1
        shadow(d.x + dir * 4, d.y + 2, 19)
        g.save()
        if (d.beaten) g.globalAlpha = 0.85
        if (d.kind === 'charge') g.filter = 'hue-rotate(22deg) saturate(1.3)'
        else if (d.kind === 'feint') g.filter = 'hue-rotate(-35deg) saturate(1.2)'
        g.translate(d.x, d.y); g.scale(dir, 1)
        const tf = d.beaten ? 1 : Math.floor(d.t * 12) % 2
        const TS = 1.35   // même taille qu'un défenseur debout
        g.drawImage(imgs.tackle, tf * TCK_FW, 0, TCK_FW, TCK_FH, -TCK_FW * TS * 0.62, -TCK_FH * TS * 0.78, TCK_FW * TS, TCK_FH * TS)
        g.restore()
        return
      }
      shadow(d.x, d.y + 2, 17)
      g.save()
      if (d.dribbled) { g.globalAlpha = 0.9; g.translate(d.x, d.y - 30); g.rotate(Math.sin(d.spin) * 0.35); g.translate(-d.x, -(d.y - 30)) }
      else if (d.beaten) g.globalAlpha = 0.85
      // couleur selon le comportement (lisible d'un coup d'œil)
      if (d.kind === 'charge') g.filter = 'hue-rotate(22deg) saturate(1.3)'
      else if (d.kind === 'feint') g.filter = 'hue-rotate(-35deg) saturate(1.2)'
      else if (d.kind === 'lateral' || d.kind === 'switch') g.filter = 'brightness(1.15)'
      g.drawImage(imgs.def, f * DEF_FW, 0, DEF_FW, DEF_FH, d.x - DEF_FW * SPR / 2, d.y - DEF_FH * SPR + 8, DEF_FW * SPR, DEF_FH * SPR)
      g.restore()
      // « ! » quand il change de côté / tacle / se replace
      if (!d.beaten && (d.alerted > 0 || (d.lunging && me.y - d.y < 150))) {
        g.fillStyle = '#ffd84a'; g.strokeStyle = '#15130f'; g.lineWidth = 2
        const bx = d.x, by = d.y - DEF_FH * SPR + 2 - (Math.floor(time * 8) % 2) * 3
        for (const [ox, oy, h] of [[-9, 4, 9], [0, 0, 11], [9, 4, 9]]) { g.save(); g.translate(bx + ox, by + oy); g.rotate(ox * 0.03); g.strokeRect(-2, -h, 4, h); g.fillRect(-2, -h, 4, h); g.restore() }
      }
      // flèches pour le défenseur latéral
      if (!d.beaten && d.kind === 'lateral') {
        g.fillStyle = 'rgba(255,255,255,.6)'
        g.beginPath(); g.moveTo(d.x - 30, d.y - 10); g.lineTo(d.x - 22, d.y - 15); g.lineTo(d.x - 22, d.y - 5); g.fill()
        g.beginPath(); g.moveTo(d.x + 30, d.y - 10); g.lineTo(d.x + 22, d.y - 15); g.lineTo(d.x + 22, d.y - 5); g.fill()
      }
    }
    defs.filter((d) => d.y <= me.y).forEach(drawDef)
    // poussière
    for (const p of dust) { g.globalAlpha = Math.min(1, p.life * 3); g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), 3, 3) }
    g.globalAlpha = 1
    // joueur
    shadow(me.x, me.y + 2, 18)
    let f = [0, 1, 2, 1][Math.floor(time * 11) % 4]
    let ball = true
    if (me.vx > 120) { f = 3 + (Math.floor(time * 8) % 2); ball = false }
    else if (me.vx < -120) { f = 5 + (Math.floor(time * 8) % 2); ball = false }
    g.save()
    if (spinT > 0) {
      const k = 1 - spinT / SPIN_TIME
      g.translate(me.x, me.y - 30); g.rotate(k * Math.PI * 2); g.translate(-me.x, -(me.y - 30))
    }
    g.drawImage(imgs.runner, f * RUN_FW, 0, RUN_FW, RUN_FH, me.x - RUN_FW * SPR / 2, me.y - RUN_FH * SPR + 12, RUN_FW * SPR, RUN_FH * SPR)
    g.restore()
    if (ball && spinT <= 0) {
      const bob = Math.abs(Math.sin(time * 9)) * 4
      g.drawImage(imgs.ball, me.x - 10 + Math.sin(time * 4.5) * 3, me.y - RUN_FH * SPR + 14 - bob, 20, 18)
    }
    if (spinT > 0) {
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3
      g.beginPath(); g.ellipse(me.x, me.y - 2, 30, 10, 0, 0.2, Math.PI - 0.2); g.stroke()
    }
    defs.filter((d) => d.y > me.y).forEach(drawDef)
    // textes flottants
    for (const t of txts) {
      g.globalAlpha = Math.min(1, t.life * 2.5)
      g.font = `700 ${t.big ? 26 : 16}px Oswald, 'Arial Narrow', sans-serif`; g.textAlign = 'center'
      g.lineWidth = 4; g.strokeStyle = '#15130f'; g.strokeText(t.s, t.x, t.y); g.fillStyle = t.c; g.fillText(t.s, t.x, t.y)
    }
    g.globalAlpha = 1
    // vignette qui se resserre avec les niveaux
    const vig = Math.min(0.45, (level - 1) * 0.08)
    if (vig > 0) {
      const rg = g.createRadialGradient(W / 2, H * 0.6, H * 0.3, W / 2, H * 0.6, H * 0.85)
      rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, `rgba(0,8,4,${vig})`)
      g.fillStyle = rg; g.fillRect(0, 0, W, H)
    }
    // flash blanc du dribble parfait
    if (flashT > 0) { g.fillStyle = `rgba(255,248,220,${flashT * 2})`; g.fillRect(0, 0, W, H) }
    // bandeau NIVEAU
    if (bannerT > 0) {
      const a = Math.min(1, bannerT * 2, (1.6 - bannerT) * 6)
      g.globalAlpha = a
      g.fillStyle = 'rgba(21,19,15,.85)'; g.fillRect(0, H * 0.3 - 34, W, 62)
      g.fillStyle = '#e9c46a'; g.fillRect(0, H * 0.3 - 34, W, 3); g.fillRect(0, H * 0.3 + 25, W, 3)
      g.font = "700 34px Oswald, 'Arial Narrow', sans-serif"; g.textAlign = 'center'
      g.fillStyle = '#ffd84a'; g.fillText(bannerText, W / 2, H * 0.3 + 6)
      g.font = "600 13px Oswald, 'Arial Narrow', sans-serif"; g.fillStyle = '#f4ecd4'
      g.fillText((LEVEL_MSG[level] ?? 'Encore plus vite !').toUpperCase(), W / 2, H * 0.3 + 21)
      g.globalAlpha = 1
    }
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
    (window as unknown as Record<string, unknown>).__dribbleDbg = { me, defs: () => defs, score: () => score, stamina: () => stamina, level: () => level, W, H: () => H }
  }

  return {
    reset() { cancelAnimationFrame(raf); reset(); draw() },
    start() { playing = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) },
    stop() { playing = false; cancelAnimationFrame(raf) },
    isPlaying: () => playing,
    score: () => score,
    resize() { resize(); draw() },
    redraw: draw,
    pointer(xPx: number, yPx: number, down: boolean) {
      if (!down) return
      const r = canvas.getBoundingClientRect()
      me.tx = clamp((xPx - r.left) / r.width * W, 24, W - 24)
      me.ty = clamp((yPx - r.top) / r.height * H - 40, yMin(), yMax())
    },
    // ◀ ▶ : un appui = un pas franc sur le côté, garder appuyé = continuer à glisser
    hold(dir: number) {
      if (dir && dir !== holdDir) me.tx = clamp((dir > 0 ? Math.max(me.tx, me.x) : Math.min(me.tx, me.x)) + dir * 70, 24, W - 24)
      holdDir = dir
    },
    dribble,
  }
}
