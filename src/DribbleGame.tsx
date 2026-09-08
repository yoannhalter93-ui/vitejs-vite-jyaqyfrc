import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Props {
  groupId: string
  groupName: string
}

interface BestScore {
  pseudo: string
  score: number
}

interface ScoreRow {
  profile_id: string
  score: number
  pseudo: string
}

function monday(): string {
  const d = new Date()
  const day = d.getDay() || 7
  if (day !== 1) d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

function previousMonday(): string {
  const d = new Date(monday() + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}

// Constantes de jeu — reprises telles quelles du prototype validé
// (jeu-de-dribble.html), réglées au fil des retours de playtest.
const LANES_X = [16.6, 50, 83.3] // % de position horizontale des 3 couloirs
const START_TRAVEL = 1400 // ms pour qu'un défenseur traverse le terrain
const MIN_TRAVEL = 560 // ms, plancher de difficulté
const START_GAP = 1150 // ms entre deux apparitions
const MIN_GAP = 440
const DECAY = 0.971 // accélération à chaque défenseur évité
const SPEED_CAP_STREAK = 20 // au-delà de cette série, le rythme n'accélère plus
const LAST_MOMENT_WINDOW = 140 // ms : délai max entre le changement de couloir et l'arrivée du défenseur pour compter comme "au dernier moment"
const DOUBLE_START_STREAK = 6
const DOUBLE_RAMP_STREAK = 18
const DOUBLE_MAX_CHANCE = 0.55
const TRIPLE_START_STREAK = 10
const TRIPLE_RAMP_STREAK = 26
const TRIPLE_MAX_CHANCE = 0.3
const VARIANT_START_STREAK = 8
const VARIANT_RAMP_STREAK = 24
const VARIANT_MAX_CHANCE = 0.4
const MAX_SCORE = 2000 // garde-fou de bon sens côté client, comme pour les jonglages

interface DefenderEntry {
  el: HTMLDivElement
  lane: number
  resolved: boolean
}

interface TripleWave {
  entries: DefenderEntry[]
  ready: boolean
}

interface CrowdNodes {
  src: AudioBufferSourceNode
  gain: GainNode
}

interface Engine {
  streak: number
  travel: number
  gap: number
  playing: boolean
  playerLane: number
  spawnTimer: ReturnType<typeof setTimeout> | null
  activeDefenders: DefenderEntry[]
  tripleWave: TripleWave | null
  laneJustVacated: number | null
  lastLaneChangeAt: number
  wallMsgTimer: ReturnType<typeof setTimeout> | null
  audioCtx: AudioContext | null
  crowdNodes: CrowdNodes | null
}

function newEngine(): Engine {
  return {
    streak: 0,
    travel: START_TRAVEL,
    gap: START_GAP,
    playing: false,
    playerLane: 1,
    spawnTimer: null,
    activeDefenders: [],
    tripleWave: null,
    laneJustVacated: null,
    lastLaneChangeAt: 0,
    wallMsgTimer: null,
    audioCtx: null,
    crowdNodes: null,
  }
}

export default function DribbleGame({ groupId, groupName }: Props) {
  const { user } = useAuth()

  const fieldRef = useRef<HTMLDivElement>(null)
  const runnerRef = useRef<HTMLDivElement>(null)
  const flareRef = useRef<HTMLDivElement>(null)
  const wallMsgRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
  const idleMsgRef = useRef<HTMLDivElement>(null)
  const endMsgRef = useRef<HTMLDivElement>(null)
  const endScoreRef = useRef<HTMLSpanElement>(null)
  const endLabelRef = useRef<HTMLParagraphElement>(null)
  const streakElRef = useRef<HTMLElement>(null)
  const diffBarRef = useRef<HTMLElement>(null)
  const leftBtnRef = useRef<HTMLButtonElement>(null)
  const rightBtnRef = useRef<HTMLButtonElement>(null)
  const dribbleBtnRef = useRef<HTMLButtonElement>(null)

  const engineRef = useRef<Engine>(newEngine())

  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [lastWeekBest, setLastWeekBest] = useState<BestScore | null>(null)
  const [allTimeBest, setAllTimeBest] = useState<BestScore | null>(null)
  const wizzChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const loadScores = async () => {
    const { data: s } = await supabase.from('dribble_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', monday()).order('score', { ascending: false })
    const { data: lastWeekRows } = await supabase.from('dribble_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', previousMonday()).order('score', { ascending: false }).limit(1)
    const { data: allTimeRows } = await supabase.from('dribble_scores').select('profile_id, score')
      .eq('group_id', groupId).order('score', { ascending: false }).limit(1)

    const ids = new Set<string>()
    for (const r of s ?? []) ids.add(r.profile_id)
    for (const r of lastWeekRows ?? []) ids.add(r.profile_id)
    for (const r of allTimeRows ?? []) ids.add(r.profile_id)

    let pseudos: Record<string, string> = {}
    if (ids.size > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', [...ids])
      pseudos = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
    }
    const best: Record<string, number> = {}
    for (const r of s ?? []) best[r.profile_id] = Math.max(best[r.profile_id] ?? 0, r.score)
    const rows = Object.entries(best).map(([profile_id, sc]) => ({ profile_id, score: sc, pseudo: pseudos[profile_id] ?? '???' }))
    rows.sort((a, b) => b.score - a.score)
    setScores(rows)

    setLastWeekBest(
      lastWeekRows && lastWeekRows[0]
        ? { pseudo: pseudos[lastWeekRows[0].profile_id] ?? '???', score: lastWeekRows[0].score }
        : null
    )
    setAllTimeBest(
      allTimeRows && allTimeRows[0]
        ? { pseudo: pseudos[allTimeRows[0].profile_id] ?? '???', score: allTimeRows[0].score }
        : null
    )
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

  // Abonnement au canal temps réel du groupe (même canal `wizz-<groupId>` que
  // les autres mini-jeux) : sert uniquement à diffuser le début/fin de partie
  // pour le bandeau "X joue au mini-jeu !" affiché aux autres membres (via
  // App.tsx). Le wizz (effet reçu pendant la partie) est réservé au jonglage.
  useEffect(() => {
    const channel = supabase.channel(`wizz-${groupId}`)
    channel.subscribe()
    wizzChannelRef.current = channel
    return () => {
      if (user && engineRef.current.playing) {
        channel.send({ type: 'broadcast', event: 'playing', payload: { action: 'stop', profileId: user.id } })
      }
      supabase.removeChannel(channel)
      wizzChannelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  // ---- son (bips synthétiques, sans fichier) + vibration mobile ----
  const ensureAudio = () => {
    const eng = engineRef.current
    try {
      if (!eng.audioCtx) eng.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      else if (eng.audioCtx.state === 'suspended') eng.audioCtx.resume()
    } catch (e) { /* ignore */ }
  }

  const beep = (freq: number, dur: number, type: OscillatorType, vol?: number, delay?: number) => {
    const ctx = engineRef.current.audioCtx
    if (!ctx) return
    try {
      const t0 = ctx.currentTime + (delay || 0)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type || 'sine'
      osc.frequency.setValueAtTime(freq, t0)
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    } catch (e) { /* ignore */ }
  }
  const playDodge = () => beep(880, 0.08, 'triangle', 0.14)
  const playMiss = () => { beep(140, 0.3, 'sawtooth', 0.22); beep(90, 0.36, 'square', 0.15, 0.05) }
  const playDribbleSuccess = () => {
    beep(660, 0.09, 'triangle', 0.18)
    beep(880, 0.11, 'triangle', 0.18, 0.09)
    beep(1180, 0.15, 'triangle', 0.2, 0.18)
  }
  const playTick = () => beep(520, 0.07, 'square', 0.1)
  const playGo = () => beep(720, 0.14, 'triangle', 0.2)
  const playHola = () => {
    [300, 380, 460, 540, 620, 540].forEach((f, i) => beep(f, 0.09, 'sine', 0.16, i * 0.045))
  }
  const noiseBurst = (dur: number, peakVol: number, freq?: number) => {
    const ctx = engineRef.current.audioCtx
    if (!ctx) return
    try {
      const bufferSize = Math.floor(ctx.sampleRate * dur)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = freq || 1100
      filter.Q.value = 0.6
      const gain = ctx.createGain()
      const t0 = ctx.currentTime
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(peakVol, t0 + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      src.connect(filter).connect(gain).connect(ctx.destination)
      src.start(t0)
      src.stop(t0 + dur + 0.05)
    } catch (e) { /* ignore */ }
  }
  const playCrowdRoar = () => noiseBurst(0.9, 0.35, 1100)
  const vibrate = (pattern: number | number[]) => {
    try { if (navigator.vibrate) navigator.vibrate(pattern) } catch (e) { /* ignore */ }
  }

  const stopCrowdAmbience = () => {
    const eng = engineRef.current
    if (eng.crowdNodes) {
      try { eng.crowdNodes.src.stop() } catch (e) { /* ignore */ }
      eng.crowdNodes = null
    }
  }
  const startCrowdAmbience = () => {
    const eng = engineRef.current
    const ctx = eng.audioCtx
    if (!ctx) return
    stopCrowdAmbience()
    try {
      const bufferSize = ctx.sampleRate * 2
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 900
      filter.Q.value = 0.7
      const gain = ctx.createGain()
      gain.gain.value = 0.05
      src.connect(filter).connect(gain).connect(ctx.destination)
      src.start()
      eng.crowdNodes = { src, gain }
    } catch (e) { /* ignore */ }
  }
  const setCrowdIntensity = (pct: number) => {
    const eng = engineRef.current
    if (eng.crowdNodes && eng.audioCtx) {
      const g = 0.05 + pct * 0.14
      eng.crowdNodes.gain.gain.setTargetAtTime(g, eng.audioCtx.currentTime, 0.3)
    }
  }

  // ---- moteur de jeu (porté du prototype jeu-de-dribble.html) ----
  const setLaneButtonsEnabled = (on: boolean) => {
    if (leftBtnRef.current) leftBtnRef.current.disabled = !on
    if (rightBtnRef.current) rightBtnRef.current.disabled = !on
    if (dribbleBtnRef.current) dribbleBtnRef.current.disabled = !on
  }

  const setPlayerLane = (lane: number) => {
    const eng = engineRef.current
    if (lane !== eng.playerLane) {
      eng.laneJustVacated = eng.playerLane
      eng.lastLaneChangeAt = Date.now()
    }
    eng.playerLane = lane
    if (runnerRef.current) runnerRef.current.style.left = LANES_X[lane] + '%'
  }

  const showWallMsg = (text: string, kind?: 'success') => {
    const eng = engineRef.current
    if (eng.wallMsgTimer) clearTimeout(eng.wallMsgTimer)
    const el = wallMsgRef.current
    if (!el) return
    el.textContent = text
    el.classList.toggle('dribble-success', kind === 'success')
    el.classList.add('dribble-show')
    eng.wallMsgTimer = setTimeout(() => { el.classList.remove('dribble-show') }, 900)
  }

  const updateDifficultyBar = () => {
    const eng = engineRef.current
    const pct = Math.max(0, Math.min(1, (START_TRAVEL - eng.travel) / (START_TRAVEL - MIN_TRAVEL)))
    if (diffBarRef.current) diffBarRef.current.style.width = (8 + pct * 92) + '%'
    const field = fieldRef.current
    if (field) {
      const scrollDur = 2.1 - pct * 1.55
      field.style.setProperty('--scroll-dur', scrollDur + 's')
      field.style.setProperty('--dusk', (pct * 0.85).toFixed(2))
    }
    setCrowdIntensity(pct)
  }

  const showNutmeg = (entry: DefenderEntry) => {
    const field = fieldRef.current
    if (!field) return
    field.classList.remove('dribble-slowmo')
    void field.offsetWidth
    field.classList.add('dribble-slowmo')
    setTimeout(() => { field.classList.remove('dribble-slowmo') }, 180)

    entry.el.style.transition = 'none'
    entry.el.classList.add('dribble-nutmegged')

    const ball = document.createElement('div')
    ball.className = 'dribble-nutmeg-ball'
    ball.style.left = LANES_X[entry.lane] + '%'
    field.appendChild(ball)

    setTimeout(() => {
      entry.el.remove()
      ball.remove()
    }, 480)
  }

  const showFlare = (kind: 'dodge' | 'miss', laneIdx?: number) => {
    const flare = flareRef.current
    if (!flare) return
    if (laneIdx != null) flare.style.setProperty('--fx', LANES_X[laneIdx] + '%')
    flare.classList.remove('dribble-show', 'dribble-dodge', 'dribble-miss')
    void flare.offsetWidth
    flare.classList.add('dribble-show', kind === 'dodge' ? 'dribble-dodge' : 'dribble-miss')
  }

  const currentDoubleChance = () => {
    const streak = engineRef.current.streak
    if (streak < DOUBLE_START_STREAK) return 0
    const t = Math.min(1, (streak - DOUBLE_START_STREAK) / (DOUBLE_RAMP_STREAK - DOUBLE_START_STREAK))
    return t * DOUBLE_MAX_CHANCE
  }
  const currentTripleChance = () => {
    const streak = engineRef.current.streak
    if (streak < TRIPLE_START_STREAK) return 0
    const t = Math.min(1, (streak - TRIPLE_START_STREAK) / (TRIPLE_RAMP_STREAK - TRIPLE_START_STREAK))
    return t * TRIPLE_MAX_CHANCE
  }
  const currentVariantChance = () => {
    const streak = engineRef.current.streak
    if (streak < VARIANT_START_STREAK) return 0
    const t = Math.min(1, (streak - VARIANT_START_STREAK) / (VARIANT_RAMP_STREAK - VARIANT_START_STREAK))
    return t * VARIANT_MAX_CHANCE
  }

  const pickDiveLane = (fromLane: number) => {
    const eng = engineRef.current
    const candidates: number[] = []
    if (fromLane - 1 >= 0) candidates.push(fromLane - 1)
    if (fromLane + 1 <= 2) candidates.push(fromLane + 1)
    if (candidates.indexOf(eng.playerLane) !== -1) return eng.playerLane
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const pickLanes = (count: number) => {
    const lanes = [0, 1, 2]
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = lanes[i]; lanes[i] = lanes[j]; lanes[j] = tmp
    }
    return lanes.slice(0, count)
  }

  const spawnOne = (lane: number, isWall?: boolean, variant?: 'fast' | 'dive'): DefenderEntry => {
    const eng = engineRef.current
    const field = fieldRef.current
    const el = document.createElement('div')
    let cls = 'dribble-defender'
    if (isWall) cls += ' dribble-wall'
    if (variant === 'fast') cls += ' dribble-fast'
    if (variant === 'dive') cls += ' dribble-diver'
    el.className = cls
    el.innerHTML = '<i class="dribble-leg dribble-leg-l"></i><i class="dribble-leg dribble-leg-r"></i><i class="dribble-p-shorts"></i><i class="dribble-p-jersey"></i><i class="dribble-p-hair"></i>'
    el.style.transitionDuration = '0ms'
    el.style.left = LANES_X[lane] + '%'
    el.style.top = '-8%'
    el.style.transform = 'scale(0.55)'
    field?.appendChild(el)
    void el.offsetWidth

    const entry: DefenderEntry = { el, lane, resolved: false }
    eng.activeDefenders.push(entry)

    const thisTravel = variant === 'fast' ? Math.max(MIN_TRAVEL * 0.75, eng.travel * 0.68) : eng.travel

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transitionDuration = thisTravel + 'ms'
        el.style.transitionTimingFunction = 'linear'
        el.style.top = '82%'
        el.style.transform = 'scale(1)'
      })
    })

    if (variant === 'dive') {
      setTimeout(() => {
        if (entry.resolved || !eng.playing) return
        const newLane = pickDiveLane(entry.lane)
        if (newLane !== entry.lane) {
          entry.lane = newLane
          const remaining = thisTravel * 0.35
          el.style.transition = `top ${remaining}ms linear, transform ${remaining}ms linear, left 160ms ease-out`
          el.style.left = LANES_X[newLane] + '%'
          el.classList.add('dribble-diving')
          setTimeout(() => { el.classList.remove('dribble-diving') }, 220)
        }
      }, thisTravel * 0.65)
    }

    setTimeout(() => { resolveDefender(entry) }, thisTravel)
    return entry
  }

  const spawnTripleWave = () => {
    const eng = engineRef.current
    const entries = [0, 1, 2].map((lane) => spawnOne(lane, true))
    const wave: TripleWave = { entries, ready: false }
    eng.tripleWave = wave
    showWallMsg('3 défenseurs ! Dribble (🌀) au bon moment')
    setTimeout(() => {
      if (eng.tripleWave === wave) {
        wave.ready = true
        dribbleBtnRef.current?.classList.add('dribble-ready')
      }
    }, eng.travel * 0.42)
    setTimeout(() => {
      if (eng.tripleWave === wave) {
        wave.ready = false
        dribbleBtnRef.current?.classList.remove('dribble-ready')
      }
    }, eng.travel * 0.8)
  }

  const spawnWave = () => {
    const eng = engineRef.current
    if (!eng.playing || eng.tripleWave) return
    if (Math.random() < currentTripleChance()) {
      spawnTripleWave()
      return
    }
    const isDouble = Math.random() < currentDoubleChance()
    if (isDouble) {
      pickLanes(2).forEach((lane) => spawnOne(lane))
    } else {
      const lane = pickLanes(1)[0]
      let variant: 'fast' | 'dive' | undefined
      if (Math.random() < currentVariantChance()) variant = Math.random() < 0.5 ? 'fast' : 'dive'
      spawnOne(lane, false, variant)
    }
    eng.spawnTimer = setTimeout(spawnWave, eng.gap)
  }

  const resolveDefender = (entry: DefenderEntry) => {
    const eng = engineRef.current
    if (entry.resolved || !eng.playing) return
    entry.resolved = true

    if (entry.lane === eng.playerLane) {
      entry.el.style.transition = 'none'
      entry.el.style.transform = 'scale(1.35)'
      showFlare('miss', entry.lane)
      fieldRef.current?.classList.add('dribble-shake')
      setTimeout(() => { fieldRef.current?.classList.remove('dribble-shake') }, 360)
      playMiss()
      vibrate(120)
      endGame()
    } else {
      const isLastMoment = eng.laneJustVacated === entry.lane && (Date.now() - eng.lastLaneChangeAt) < LAST_MOMENT_WINDOW
      showFlare('dodge', entry.lane)
      if (isLastMoment) playHola(); else playDodge()
      eng.streak += 1
      if (streakElRef.current) streakElRef.current.textContent = String(eng.streak)
      if (eng.streak <= SPEED_CAP_STREAK) {
        eng.travel = Math.max(MIN_TRAVEL, eng.travel * DECAY)
        eng.gap = Math.max(MIN_GAP, eng.gap * DECAY)
        updateDifficultyBar()
      }
      eng.activeDefenders = eng.activeDefenders.filter((d) => d !== entry)
      if (isLastMoment) {
        showNutmeg(entry)
      } else {
        entry.el.remove()
      }
    }
  }

  const onDirTap = (dir: number) => {
    const eng = engineRef.current
    if (!eng.playing) return
    const next = Math.max(0, Math.min(2, eng.playerLane + dir))
    if (next !== eng.playerLane) setPlayerLane(next)
  }

  const resolveTripleSuccess = () => {
    const eng = engineRef.current
    const wave = eng.tripleWave
    if (!wave) return
    eng.tripleWave = null
    dribbleBtnRef.current?.classList.remove('dribble-ready')
    wave.entries.forEach((entry) => {
      entry.resolved = true
      entry.el.remove()
    })
    eng.activeDefenders = eng.activeDefenders.filter((d) => wave.entries.indexOf(d) === -1)
    const runner = runnerRef.current
    if (runner) {
      runner.classList.remove('dribble-roulette')
      void runner.offsetWidth
      runner.classList.add('dribble-roulette')
    }
    showFlare('dodge', eng.playerLane)
    showWallMsg('Dribble réussi !', 'success')
    playDribbleSuccess()
    playCrowdRoar()
    vibrate([25, 40, 25])
    eng.streak += 3
    if (streakElRef.current) streakElRef.current.textContent = String(eng.streak)
    if (eng.streak <= SPEED_CAP_STREAK) {
      eng.travel = Math.max(MIN_TRAVEL, eng.travel * DECAY)
      eng.gap = Math.max(MIN_GAP, eng.gap * DECAY)
      updateDifficultyBar()
    }
    eng.spawnTimer = setTimeout(spawnWave, eng.gap)
  }

  const resolveTripleFail = () => {
    const eng = engineRef.current
    const wave = eng.tripleWave
    if (!wave) return
    eng.tripleWave = null
    dribbleBtnRef.current?.classList.remove('dribble-ready')
    const entry = wave.entries.filter((e) => e.lane === eng.playerLane)[0] || wave.entries[0]
    entry.resolved = true
    entry.el.style.transition = 'none'
    entry.el.style.transform = 'scale(1.35)'
    showFlare('miss', entry.lane)
    fieldRef.current?.classList.add('dribble-shake')
    setTimeout(() => { fieldRef.current?.classList.remove('dribble-shake') }, 360)
    playMiss()
    vibrate(120)
    endGame()
  }

  const onDribbleTap = () => {
    const eng = engineRef.current
    if (!eng.playing) return
    if (!eng.tripleWave) {
      const btn = dribbleBtnRef.current
      if (btn) {
        btn.classList.remove('dribble-whiff')
        void btn.offsetWidth
        btn.classList.add('dribble-whiff')
      }
      return
    }
    if (eng.tripleWave.ready) {
      resolveTripleSuccess()
    } else {
      resolveTripleFail()
    }
  }

  const clearDefenders = () => {
    const eng = engineRef.current
    eng.activeDefenders.forEach((d) => d.el.remove())
    eng.activeDefenders = []
  }

  const runCountdown = () => {
    const eng = engineRef.current
    const steps = ['3', '2', '1', 'GO !']
    let i = 0
    const countdownEl = countdownRef.current
    if (countdownEl) countdownEl.style.display = 'flex'
    const showStep = () => {
      if (i >= steps.length) {
        if (countdownEl) countdownEl.style.display = 'none'
        eng.playing = true
        setLaneButtonsEnabled(true)
        runnerRef.current?.classList.add('dribble-running')
        startCrowdAmbience()
        eng.spawnTimer = setTimeout(spawnWave, 400)
        return
      }
      if (countdownEl) {
        countdownEl.textContent = steps[i]
        countdownEl.classList.remove('dribble-pop')
        void countdownEl.offsetWidth
        countdownEl.classList.add('dribble-pop')
      }
      if (steps[i] === 'GO !') playGo(); else playTick()
      i += 1
      setTimeout(showStep, 500)
    }
    showStep()
  }

  const startGame = () => {
    ensureAudio()
    const eng = engineRef.current
    eng.playing = false
    if (eng.spawnTimer) clearTimeout(eng.spawnTimer)
    eng.streak = 0
    eng.travel = START_TRAVEL
    eng.gap = START_GAP
    eng.tripleWave = null
    eng.laneJustVacated = null
    eng.lastLaneChangeAt = 0
    dribbleBtnRef.current?.classList.remove('dribble-ready')
    if (streakElRef.current) streakElRef.current.textContent = '0'
    updateDifficultyBar()
    if (idleMsgRef.current) idleMsgRef.current.style.display = 'none'
    if (endMsgRef.current) endMsgRef.current.style.display = 'none'
    clearDefenders()
    setPlayerLane(1)
    setLaneButtonsEnabled(false)
    runnerRef.current?.classList.remove('dribble-running')
    runCountdown()

    // Préviens les autres membres du groupe (bandeau partagé avec les autres
    // mini-jeux, via App.tsx) que la partie démarre.
    if (user) {
      wizzChannelRef.current?.send({
        type: 'broadcast',
        event: 'playing',
        payload: { action: 'start', profileId: user.id, pseudo: myPseudo || 'Un coéquipier', game: 'dribble' },
      })
      supabase.rpc('notify_dribble_start', { p_group_id: groupId })
    }
  }

  const endGame = () => {
    const eng = engineRef.current
    const finalStreak = Math.min(eng.streak, MAX_SCORE)
    eng.playing = false
    eng.tripleWave = null
    dribbleBtnRef.current?.classList.remove('dribble-ready')
    if (eng.spawnTimer) clearTimeout(eng.spawnTimer)
    setLaneButtonsEnabled(false)
    runnerRef.current?.classList.remove('dribble-running')
    stopCrowdAmbience()
    if (endScoreRef.current) endScoreRef.current.textContent = String(finalStreak)
    if (endLabelRef.current) {
      endLabelRef.current.textContent = finalStreak <= 1
        ? (finalStreak === 1 ? 'défenseur évité avant le contact.' : 'Aucun défenseur évité avant le contact.')
        : 'défenseurs évités avant le contact.'
    }
    setTimeout(() => {
      clearDefenders()
      if (endMsgRef.current) endMsgRef.current.style.display = 'flex'
    }, 500)

    if (user) {
      wizzChannelRef.current?.send({
        type: 'broadcast',
        event: 'playing',
        payload: { action: 'stop', profileId: user.id },
      })
      supabase.from('dribble_scores').insert({
        group_id: groupId, profile_id: user.id, week_start: monday(), score: finalStreak,
      }).then(() => { loadScores() })
    }
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Dribble — {groupName}</h2>
      </div>

      <div className={`dribble-app`}>
        <p className="dribble-intro">
          Des défenseurs descendent sur le terrain : ◀ / ▶ pour changer de couloir et les éviter. Certains sont plus rapides (orange) ou plongent vers ton couloir au dernier moment. Chaque défenseur évité accélère le suivant, et passé quelques arrêts d'affilée, 2 défenseurs peuvent débouler sur 2 couloirs en même temps — il en reste toujours un de libre. Parfois les 3 couloirs sont bloqués d'un coup : impossible d'esquiver, il faut alors appuyer sur 🌀 au bon moment pour passer en dribble (roulette), qui rapporte plus qu'une esquive classique. Trop tôt, trop tard, ou pas de dribble : contact, la course s'arrête.
        </p>

        <div className="dribble-stat-row">
          <div className="dribble-stat"><b ref={streakElRef as any}>0</b><span>Série en cours</span></div>
        </div>

        <div className="dribble-stage">
          <div className="dribble-field" ref={fieldRef}>
            <div className="dribble-goal-strip" />
            <div className="dribble-lane-line dribble-lane-1" />
            <div className="dribble-lane-line dribble-lane-2" />
            <div className="dribble-flare" ref={flareRef} />
            <div className="dribble-wall-msg" ref={wallMsgRef} />
            <div className="dribble-countdown" ref={countdownRef} />
            <div className="dribble-runner" ref={runnerRef} style={{ left: '50%' }}>
              <i className="dribble-leg dribble-leg-l" /><i className="dribble-leg dribble-leg-r" /><i className="dribble-p-shorts" /><i className="dribble-p-jersey" /><i className="dribble-p-hair" /><i className="dribble-ball" />
            </div>

            <div className="dribble-idle-msg" ref={idleMsgRef}>
              <span style={{ fontSize: 28 }}>⚽</span>
              <p className="dribble-sub">Prêt à percer la défense ?</p>
              <button className="dribble-cta" onPointerDown={startGame}>Commencer</button>
            </div>
            <div className="dribble-end-msg" ref={endMsgRef} style={{ display: 'none' }}>
              <span className="dribble-big" ref={endScoreRef}>0</span>
              <p className="dribble-sub" ref={endLabelRef}>défenseurs évités avant le contact.</p>
              <button className="dribble-cta" onPointerDown={startGame}>Rejouer</button>
            </div>
          </div>
        </div>

        <div className="dribble-lanes-ctl">
          <button ref={leftBtnRef} className="dribble-lane-btn" disabled onPointerDown={() => onDirTap(-1)}>◀</button>
          <button ref={dribbleBtnRef} className="dribble-lane-btn dribble-roulette-btn" disabled onPointerDown={onDribbleTap}>🌀</button>
          <button ref={rightBtnRef} className="dribble-lane-btn" disabled onPointerDown={() => onDirTap(1)}>▶</button>
        </div>

        <div className="dribble-difficulty">
          <span>Vitesse de course</span>
          <div className="dribble-bar"><i ref={diffBarRef as any} style={{ width: '8%' }} /></div>
        </div>
      </div>

      {(allTimeBest || lastWeekBest) && (
        <div className="juggle-palmares">
          <p className="predictions-period">🏆 Palmarès</p>
          {allTimeBest && (
            <p className="juggle-palmares-row">Record du groupe : <b>{allTimeBest.score}</b> ({allTimeBest.pseudo})</p>
          )}
          {lastWeekBest && (
            <p className="juggle-palmares-row">Semaine dernière : <b>{lastWeekBest.score}</b> ({lastWeekBest.pseudo})</p>
          )}
        </div>
      )}

      {scores.length > 0 && (
        <div className="roulette-teammates">
          <p className="predictions-period">Meilleures séries de la semaine :</p>
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
