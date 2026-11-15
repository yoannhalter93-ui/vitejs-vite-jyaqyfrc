import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from './supabaseClient'
import { previousGameWeek } from './minigameWeeks'
import { useAuth } from './AuthContext'
import { useWizzChannel } from './wizzChannel'
import { dribbleSpriteVars, dribbleImages } from './dribblePixel'
import { createDribbleEngine } from './dribbleEngine'
import './dribble-pixel.css'

interface Props {
  groupId: string
  groupName: string
  autoApplyAllLeagues: boolean
  onExit: () => void
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
  // Calcul entièrement en UTC (cf. mondayUtcISO() dans PenaltyDuel.tsx) :
  // l'ancienne version mélangeait getDay()/setDate() en heure LOCALE avec un
  // rendu toISOString() en UTC, ce qui décalait week_start d'un jour (au
  // dimanche au lieu du lundi) pour toute partie jouée juste après minuit
  // heure locale mais encore la veille en UTC — bug confirmé en base
  // (22/09/2026, scores réels mal datés côté Dribble et Jonglage).
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return d.toISOString().slice(0, 10)
}

// Constantes de jeu — reprises telles quelles du prototype validé
// (jeu-de-dribble.html), réglées au fil des retours de playtest.

const MAX_SCORE = 2000 // garde-fou de bon sens côté client, comme pour les jonglages

export default function DribbleGame({ groupId, groupName, autoApplyAllLeagues, onExit }: Props) {
  const { user } = useAuth()

  const fieldRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const wallMsgRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
  const idleMsgRef = useRef<HTMLDivElement>(null)
  const endMsgRef = useRef<HTMLDivElement>(null)
  const endScoreRef = useRef<HTMLSpanElement>(null)
  const endLabelRef = useRef<HTMLParagraphElement>(null)
  const streakElRef = useRef<HTMLElement>(null)
  const staminaBarRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const leftBtnRef = useRef<HTMLButtonElement>(null)
  const rightBtnRef = useRef<HTMLButtonElement>(null)
  const dribbleBtnRef = useRef<HTMLButtonElement>(null)

  const audio = useRef<{ audioCtx: AudioContext | null; crowdNodes: { src: AudioBufferSourceNode; gain: GainNode } | null }>({ audioCtx: null, crowdNodes: null })
  const engine = useRef<ReturnType<typeof createDribbleEngine> | null>(null)
  const playingRef = useRef(false)

  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [lastWeekBest, setLastWeekBest] = useState<BestScore | null>(null)
  const [allTimeBest, setAllTimeBest] = useState<BestScore | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showBoard, setShowBoard] = useState(false)

  const loadScores = async () => {
    const { data: s } = await supabase.from('dribble_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', monday()).order('score', { ascending: false })
    const { data: lastWeekRows } = await supabase.from('dribble_scores').select('profile_id, score')
      .eq('group_id', groupId).eq('week_start', await previousGameWeek('dribble', monday())).order('score', { ascending: false }).limit(1)
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
  const sendOnWizzChannel = useWizzChannel(groupId)

  useEffect(() => {
    return () => {
      if (user && playingRef.current) {
        sendOnWizzChannel('playing', { action: 'stop', profileId: user.id })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  // ---- son (bips synthétiques, sans fichier) + vibration mobile ----
  const ensureAudio = () => {
    const eng = audio.current
    try {
      if (!eng.audioCtx) eng.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      else if (eng.audioCtx.state === 'suspended') eng.audioCtx.resume()
    } catch { /* ignore */ }
  }

  const beep = (freq: number, dur: number, type: OscillatorType, vol?: number, delay?: number) => {
    const ctx = audio.current.audioCtx
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
    } catch { /* ignore */ }
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
    const ctx = audio.current.audioCtx
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
    } catch { /* ignore */ }
  }
  const playCrowdRoar = () => noiseBurst(0.9, 0.35, 1100)
  const vibrate = (pattern: number | number[]) => {
    try { if (navigator.vibrate) navigator.vibrate(pattern) } catch { /* ignore */ }
  }

  const stopCrowdAmbience = () => {
    const eng = audio.current
    if (eng.crowdNodes) {
      try { eng.crowdNodes.src.stop() } catch { /* ignore */ }
      eng.crowdNodes = null
    }
  }
  const startCrowdAmbience = () => {
    const eng = audio.current
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
    } catch { /* ignore */ }
  }
  const setCrowdIntensity = (pct: number) => {
    const eng = audio.current
    if (eng.crowdNodes && eng.audioCtx) {
      const g = 0.05 + pct * 0.14
      eng.crowdNodes.gain.gain.setTargetAtTime(g, eng.audioCtx.currentTime, 0.3)
    }
  }

  // ---- jeu (moteur sur canvas : voir dribbleEngine.ts) ----
  const showWallMsg = (text: string, kind?: 'success') => {
    const el = wallMsgRef.current
    if (!el) return
    if (wallTimer.current) clearTimeout(wallTimer.current)
    el.textContent = text
    el.classList.toggle('dribble-success', kind === 'success')
    el.classList.add('dribble-show')
    wallTimer.current = setTimeout(() => { el.classList.remove('dribble-show') }, 1100)
  }
  const wallTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpScore = () => {
    const el = streakElRef.current
    if (!el) return
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump')
  }
  const setButtonsEnabled = (on: boolean) => {
    for (const b of [leftBtnRef.current, rightBtnRef.current, dribbleBtnRef.current]) if (b) b.disabled = !on
  }

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const imgs = dribbleImages()
    const e = createDribbleEngine(cv, imgs, {
      onPoint: (sc) => {
        if (streakElRef.current) streakElRef.current.textContent = String(sc)
        bumpScore(); playDodge()
      },
      onLose: (sc) => endGameRef.current(sc),
      onDribble: (kind) => {
        const btn = dribbleBtnRef.current
        if (kind === 'perfect') { playDribbleSuccess(); playCrowdRoar(); vibrate([20, 30, 40]) }
        else if (kind === 'good') { playDribbleSuccess(); vibrate([20, 30, 20]) }
        else if (kind === 'early') { playTick(); vibrate(40) }
        else if (btn) {
          btn.classList.remove('dribble-whiff'); void btn.offsetWidth; btn.classList.add('dribble-whiff')
          if (kind === 'tired') showWallMsg('Plus assez d\'endurance !')
        }
      },
      onStamina: (v) => {
        if (staminaBarRef.current) staminaBarRef.current.style.width = v + '%'
        dribbleBtnRef.current?.classList.toggle('px-tired', v < 35)
      },
      onLevel: (_lv, msg) => { void msg; playHola() },
      onSpeed: (pct) => setCrowdIntensity(pct),
    })
    engine.current = e
    e.reset()
    // les images arrivent après le premier dessin
    Object.values(imgs).forEach((im) => { if (!im.complete) im.addEventListener('load', () => e.redraw(), { once: true }) })
    const onResize = () => e.resize()
    window.addEventListener('resize', onResize)
    return () => { e.stop(); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // doigt sur le terrain : le joueur suit le doigt
  const onFieldPointer = (e: ReactPointerEvent<HTMLCanvasElement>, down: boolean) => {
    if (!playingRef.current) return
    if (e.type === 'pointerdown') { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ } }
    engine.current?.pointer(e.clientX, e.clientY, down)
  }

  // bande de contrôle : gauche (maintenir) = ◀, milieu = DRIBBLE, droite (maintenir) = ▶
  const flashButton = (btn: HTMLButtonElement | null) => {
    if (!btn) return
    btn.classList.remove('is-pressed')
    void btn.offsetWidth
    btn.classList.add('is-pressed')
    setTimeout(() => btn.classList.remove('is-pressed'), 120)
  }
  const onControlsDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!playingRef.current) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const third = (e.clientX - rect.left) / rect.width
    if (third < 1 / 3) { leftBtnRef.current?.classList.add('is-held'); engine.current?.hold(-1) }
    else if (third > 2 / 3) { rightBtnRef.current?.classList.add('is-held'); engine.current?.hold(1) }
    else { flashButton(dribbleBtnRef.current); engine.current?.dribble() }
  }
  const onControlsUp = () => {
    leftBtnRef.current?.classList.remove('is-held'); rightBtnRef.current?.classList.remove('is-held')
    engine.current?.hold(0)
  }

  useEffect(() => {
    const down = new Set<string>()
    const onKey = (e: KeyboardEvent) => {
      if (!playingRef.current) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.type === 'keydown') down.add(e.key); else down.delete(e.key)
        engine.current?.hold(down.has('ArrowLeft') ? -1 : down.has('ArrowRight') ? 1 : 0)
      } else if ((e.key === ' ' || e.key === 'ArrowUp') && e.type === 'keydown') {
        e.preventDefault(); flashButton(dribbleBtnRef.current); engine.current?.dribble()
      }
    }
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey) }
  }, [])

  const runCountdown = () => {
    const steps = ['3', '2', '1', 'GO !']
    let i = 0
    const countdownEl = countdownRef.current
    if (countdownEl) countdownEl.style.display = 'flex'
    const showStep = () => {
      if (i >= steps.length) {
        if (countdownEl) countdownEl.style.display = 'none'
        playingRef.current = true
        setButtonsEnabled(true)
        startCrowdAmbience()
        engine.current?.start()
        showWallMsg('DRIBBLE quand le cercle devient doré !')
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
    // empêche le défilement de la page pendant la partie
    wrapperRef.current?.classList.add('dribble-locked')
    ensureAudio()
    playingRef.current = false
    engine.current?.reset()
    if (streakElRef.current) streakElRef.current.textContent = '0'
    if (idleMsgRef.current) idleMsgRef.current.style.display = 'none'
    if (endMsgRef.current) endMsgRef.current.style.display = 'none'
    setButtonsEnabled(false)
    runCountdown()
    // Préviens les autres membres du groupe (bandeau partagé avec les autres
    // mini-jeux, via App.tsx) que la partie démarre.
    if (user) {
      sendOnWizzChannel('playing', { action: 'start', profileId: user.id, pseudo: myPseudo || 'Un coéquipier', game: 'dribble' })
      supabase.rpc('notify_dribble_start', { p_group_id: groupId }).then(() => {})
    }
  }

  const endGame = (sc: number) => {
    wrapperRef.current?.classList.remove('dribble-locked')
    const finalStreak = Math.min(sc, MAX_SCORE)
    playingRef.current = false
    setButtonsEnabled(false)
    onControlsUp()
    stopCrowdAmbience()
    playMiss(); vibrate(120)
    fieldRef.current?.classList.add('dribble-shake')
    setTimeout(() => { fieldRef.current?.classList.remove('dribble-shake') }, 360)
    if (endScoreRef.current) endScoreRef.current.textContent = String(finalStreak)
    if (endLabelRef.current) {
      endLabelRef.current.textContent = finalStreak <= 1
        ? (finalStreak === 1 ? 'point avant de perdre le ballon.' : 'Aucun point cette fois.')
        : 'points avant de perdre le ballon.'
    }
    setTimeout(() => { if (endMsgRef.current) endMsgRef.current.style.display = 'flex' }, 700)

    if (user) {
      sendOnWizzChannel('playing', { action: 'stop', profileId: user.id })
      // Réglage "Pronostics dans toutes mes ligues" actif : la RPC
      // submit_dribble_score_all_leagues enregistre le même score dans
      // toutes les ligues où je suis membre (le jeu de la semaine est
      // identique pour tout le monde, voir get_active_minigame). Sinon,
      // comportement inchangé : un seul insert sur cette ligue.
      if (autoApplyAllLeagues) {
        supabase.rpc('submit_dribble_score_all_leagues', { p_score: finalStreak }).then(() => { loadScores() })
      } else {
        supabase.from('dribble_scores').insert({
          group_id: groupId, profile_id: user.id, week_start: monday(), score: finalStreak,
        }).then(() => { loadScores() })
      }
    }
  }
  // le moteur appelle toujours la dernière version (user, ligue… à jour)
  const endGameRef = useRef(endGame)
  endGameRef.current = endGame

  return (
    <div className="predictions-screen dribble-page dribble-px" ref={wrapperRef} style={dribbleSpriteVars() as CSSProperties}>
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Accueil</button>
        <h2>Dribble — {groupName}</h2>
      </div>

      <div className="dribble-app">
        <button type="button" className="dribble-rules-toggle" onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Masquer les règles ▲' : 'Voir les règles ▼'}
        </button>
        {showRules && (
          <p className="dribble-intro">
            Ton joueur remonte le terrain sans fin : va le plus loin possible sans perdre le ballon. Glisse le doigt (ou ◀ / ▶) pour te déplacer. Après les 6 premiers points (pour prendre le coup de main), les défenseurs deviennent malins : ils te temporisent au lieu de foncer, ne se font plus avoir par les zigzags, repèrent ton côté préféré, se couvrent entre eux, et taclent dès que tu t'engages. Chaque défenseur a sa façon de défendre : il te marque et se met devant toi, glisse de côté, qui change de ligne, qui charge, qui feinte puis tacle, ou deux qui ferment deux couloirs. Autour de chaque défenseur, un cercle au sol = la zone de duel : appuie sur DRIBBLE quand le cercle devient doré → PARFAIT +2 ; un peu avant (cercle blanc) → BIEN +1. Trop tôt, il se replace devant toi ; trop tard, il prend le ballon. L'éviter sans dribbler = +1. Le dribble coûte de l'endurance (jauge sous les boutons). Tous les 10 points : niveau suivant, un peu plus vite, avec de nouveaux défenseurs. Ton meilleur score de la semaine compte pour le classement.
          </p>
        )}

        <div className="px-scorebar">
          <svg className="px-laurel" viewBox="0 0 22 34" aria-hidden="true"><path fill="currentColor" d="M15 33C7 29 3 22 4 12l2 0c0 9 3 15 10 19zM3 9c-2-3-1-6 1-8 2 3 1 6-1 8zm1 7c-3-1-4-4-4-7 3 1 4 4 4 7zm2 7c-3 0-5-3-6-6 3 0 5 3 6 6zm4 6c-3 1-6-1-7-4 3-1 6 1 7 4zM8 13c-1-3 0-6 3-8 1 3 0 6-3 8zm1 7c-1-3 1-6 3-7 1 3-1 6-3 7z"/></svg>
          <div className="px-score-lbl">Score</div>
          <span className="px-sep" />
          <b className="px-score" ref={streakElRef as any}>0</b>
          <svg className="px-laurel r" viewBox="0 0 22 34" aria-hidden="true"><path fill="currentColor" d="M15 33C7 29 3 22 4 12l2 0c0 9 3 15 10 19zM3 9c-2-3-1-6 1-8 2 3 1 6-1 8zm1 7c-3-1-4-4-4-7 3 1 4 4 4 7zm2 7c-3 0-5-3-6-6 3 0 5 3 6 6zm4 6c-3 1-6-1-7-4 3-1 6 1 7 4zM8 13c-1-3 0-6 3-8 1 3 0 6-3 8zm1 7c-1-3 1-6 3-7 1 3-1 6-3 7z"/></svg>
        </div>

        <div className="dribble-stage">
          <div className="dribble-field" ref={fieldRef}>
            <canvas className="px-canvas" ref={canvasRef}
              onPointerDown={(e) => onFieldPointer(e, true)} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onFieldPointer(e, true) }}
              onPointerUp={(e) => onFieldPointer(e, false)} onPointerCancel={(e) => onFieldPointer(e, false)} />
            <div className="dribble-wall-msg" ref={wallMsgRef} />
            <div className="dribble-countdown" ref={countdownRef} />
            <div className="dribble-idle-msg" ref={idleMsgRef}>
              <span style={{ fontSize: 28 }}>⚽</span>
              <p className="dribble-sub">Glisse le doigt pour slalomer entre les défenseurs. Dribble quand ça bouche !</p>
              <button className="dribble-cta" onPointerDown={startGame}>Commencer</button>
            </div>
            <div className="dribble-end-msg" ref={endMsgRef} style={{ display: 'none' }}>
              <span className="dribble-big" ref={endScoreRef}>0</span>
              <p className="dribble-sub" ref={endLabelRef}>points avant de perdre le ballon.</p>
              <button className="dribble-cta" onPointerDown={startGame}>Rejouer</button>
            </div>
          </div>
        </div>

        {/* bande tactile coupée en 3 : ◀ (maintenir) · DRIBBLE · ▶ (maintenir) */}
        <div className="dribble-lanes-ctl" onPointerDown={onControlsDown} onPointerUp={onControlsUp} onPointerCancel={onControlsUp} onPointerLeave={onControlsUp}>
          <button ref={leftBtnRef} className="dribble-lane-btn" disabled tabIndex={-1}>◀</button>
          <button ref={dribbleBtnRef} className="dribble-lane-btn dribble-roulette-btn" disabled tabIndex={-1}>
            <svg className="px-spiral-svg" viewBox="0 0 32 32" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" d="M16 16.5c0-1.4 1.6-1.9 2.6-1 1.5 1.3.6 4-1.6 4.4-3 .6-5.2-2.4-4.4-5.2 1-3.6 5.6-4.7 8.4-2.6 3.6 2.6 3.2 8.2-.4 10.6-4.4 2.9-10.6.9-12.4-4-2-5.6 1.8-11.6 7.6-12.4"/></svg>
            <span className="px-btn-lbl">DRIBBLE</span>
          </button>
          <button ref={rightBtnRef} className="dribble-lane-btn" disabled tabIndex={-1}>▶</button>
        </div>

        <div className="dribble-difficulty">
          <span>⚡ Endurance</span>
          <div className="dribble-bar px-stamina"><i ref={staminaBarRef as any} style={{ width: '100%' }} /></div>
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
          {allTimeBest && (
            <p className="juggle-palmares-row">Record du groupe : <b>{allTimeBest.score}</b> ({allTimeBest.pseudo})</p>
          )}
          {lastWeekBest && (
            <p className="juggle-palmares-row">Édition précédente : <b>{lastWeekBest.score}</b> ({lastWeekBest.pseudo})</p>
          )}
        </div>
      )}

      {showBoard && scores.length > 0 && (
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
