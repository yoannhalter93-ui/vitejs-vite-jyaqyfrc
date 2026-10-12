import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useFloatingReactions, FloatingReactions, ReactionBar } from './ToroReactions'
import { useAuth } from './AuthContext'
import { paintJuggle, JUGGLE_W, JUGGLE_H } from './JuggleGame'

// ============================================================================
// Regarder un pote jongler en direct (même principe que ToroSpectator).
//
// Le joueur diffuse ses ballons sur le canal `juggle-live-<son id>` (voir
// JuggleGame) dès qu'au moins un spectateur y est présent ; ici on signale sa
// présence, on reçoit ces états (~10 par seconde) et on redessine les
// ballons en interpolant. On peut réagir (emoji) et envoyer un wizz : on voit
// alors les ballons partir dans tous les sens chez le joueur.
// ============================================================================

interface Props {
  profileId: string
  pseudo: string
  onExit: () => void
}

type BallState = [number, number, number] // x, y, raté (1/0)

interface Frame {
  ph: 'play' | 'over'
  b: BallState[]
  s: number
  n: number
  wz?: boolean
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export default function JuggleSpectator({ profileId, pseudo, onExit }: Props) {
  const { user } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const framesRef = useRef<{ prev: Frame | null; last: Frame | null; at: number; gap: number }>({ prev: null, last: null, at: 0, gap: 100 })
  const [status, setStatus] = useState<'waiting' | 'live' | 'over' | 'gone'>('waiting')
  const [score, setScore] = useState(0)
  const [balls, setBalls] = useState(1)
  const [wizzing, setWizzing] = useState(false)
  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [others, setOthers] = useState<string[]>([])
  const reactions = useFloatingReactions()
  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const myPseudoRef = useRef<string | null>(null)
  const joinedRef = useRef(false)
  // « ciel » au-dessus de la zone de jeu, comme chez le joueur
  const skyRef = useRef(0)
  const [sky, setSky] = useState(0)

  useEffect(() => {
    myPseudoRef.current = myPseudo
    if (myPseudo && joinedRef.current && chanRef.current) chanRef.current.track({ watching: true, pseudo: myPseudo })
  }, [myPseudo])

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('pseudo').eq('id', user.id).maybeSingle()
      .then(({ data }) => setMyPseudo(data?.pseudo ?? null))
  }, [user])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const sendReaction = (emoji: string) => {
    if (!chanRef.current) return
    chanRef.current.send({ type: 'broadcast', event: 'react', payload: { emoji, from: myPseudo || 'Un pote' } })
    reactions.add(emoji, 'Toi')
  }

  const sendWizz = () => {
    if (cooldown > 0 || !chanRef.current) return
    chanRef.current.send({ type: 'broadcast', event: 'wizz', payload: { from: myPseudo || 'Un pote' } })
    setCooldown(15)
  }

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`juggle-live-${profileId}`, { config: { presence: { key: user.id } } })
    ch.on('broadcast', { event: 'react' }, ({ payload }) => {
      reactions.add(String(payload?.emoji ?? ''), String(payload?.from ?? 'Un pote'))
    })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, { pseudo?: string | null }[]>
      setOthers(Object.keys(state).filter((k) => k !== 'player' && k !== user.id)
        .map((k) => [...(state[k] ?? [])].reverse().find((m) => m.pseudo)?.pseudo || 'Un pote'))
    })
    ch.on('broadcast', { event: 'frame' }, ({ payload }) => {
      const f = payload as Frame
      const fr = framesRef.current
      const now = performance.now()
      // nouvelle partie (ou nouveau ballon) : pas d'interpolation sur ce saut
      const restarted = !fr.last || fr.last.ph === 'over' || f.b.length !== fr.last.b.length
      fr.gap = fr.last && !restarted ? Math.min(250, Math.max(50, now - fr.at)) : 100
      fr.prev = restarted ? null : fr.last
      fr.last = f
      fr.at = now
      setScore(f.s)
      setBalls(f.n)
      setStatus(f.ph === 'over' ? 'over' : 'live')
      setWizzing(!!f.wz)
    }).subscribe((st) => {
      if (st !== 'SUBSCRIBED') return
      joinedRef.current = true
      ch.track({ watching: true, pseudo: myPseudoRef.current })
    })
    chanRef.current = ch
    return () => { chanRef.current = null; joinedRef.current = false; supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, user])

  const [idleLong, setIdleLong] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setIdleLong(true), 5000)
    return () => clearTimeout(id)
  }, [profileId])

  useEffect(() => {
    const id = setInterval(() => {
      const fr = framesRef.current
      if (fr.last && fr.last.ph !== 'over' && performance.now() - fr.at > 6000) setStatus('gone')
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // hauteur du ciel selon la place disponible
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const r = wrap.getBoundingClientRect()
      if (r.width <= 0) return
      const next = Math.max(0, Math.round((JUGGLE_W * r.height) / r.width - JUGGLE_H))
      if (next !== skyRef.current) { skyRef.current = next; setSky(next) }
    }
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    measure()
    return () => ro.disconnect()
  }, [])

  // dessin (interpolation entre les deux derniers états reçus)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const loop = () => {
      const fr = framesRef.current
      const f = fr.last
      const k = Math.min(1, (performance.now() - fr.at) / fr.gap)
      const shown = f
        ? f.b.map((b, i) => {
            const p = fr.prev?.b[i]
            return { x: p ? lerp(p[0], b[0], k) : b[0], y: p ? lerp(p[1], b[1], k) : b[1], missed: b[2] === 1 }
          })
        : [{ x: JUGGLE_W / 2, y: 200, missed: false }]
      paintJuggle(ctx, canvas.width, canvas.height, skyRef.current, shown)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sky])

  return (
    <div className={`predictions-screen juggle-page juggle-spectator${wizzing && status === 'live' ? ' juggle-wizz-shake' : ''}`}>
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Jeux</button>
        <h2>👀 {pseudo} jongle</h2>
      </div>

      <div className="juggle-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={JUGGLE_W}
          height={JUGGLE_H + sky}
          style={{ background: '#171b24', borderRadius: 12, border: '1px solid #2a2f3a', width: '100%', maxWidth: '100%', height: '100%', position: 'absolute', inset: 0, boxSizing: 'border-box' }}
        />
        <FloatingReactions items={reactions.items} corners />
        {others.length > 0 && (
          <div className="toro-viewers">
            👀 {others.length <= 3
              ? others.join(', ').replace(/, ([^,]*)$/, ' et $1')
              : `${others.slice(0, 3).join(', ')} et ${others.length - 3} autre${others.length - 3 > 1 ? 's' : ''}`}
            {others.length > 1 ? ' regardent' : ' regarde'} aussi
          </div>
        )}
        {wizzing && status === 'live' && (
          <div className="juggle-wizz-overlay">
            <span className="juggle-wizz-overlay-text">⚡ WIZZ !</span>
          </div>
        )}
        {status === 'waiting' && (
          <div className="dribble-idle-msg">
            <span style={{ fontSize: 30 }}>👀</span>
            <p className="dribble-sub">
              {idleLong
                ? `${pseudo} n'est pas en pleine partie en ce moment. Reste sur cet écran : dès qu'il relance une partie, tu la verras ici en direct.`
                : `Connexion à la partie de ${pseudo}…`}
            </p>
          </div>
        )}
        {(status === 'over' || status === 'gone') && (
          <div className="dribble-end-msg">
            <span className="dribble-big">{score}</span>
            <p className="dribble-sub">
              {status === 'over'
                ? `jonglage${score > 1 ? 's' : ''} pour ${pseudo}. S'il relance une partie, tu la verras ici.`
                : `${pseudo} a quitté la partie.`}
            </p>
            <button className="dribble-cta" onClick={onExit}>Retour aux jeux</button>
          </div>
        )}
      </div>

      <div className="match-predict juggle-stats juggle-spectator-stats">
        <span>Score : {score}</span>
        <span>Ballons : {balls}</span>
        <span>{status === 'live' ? '🔴 En direct' : 'Direct'}</span>
      </div>
      {status === 'live' && <ReactionBar onReact={sendReaction} />}
      {status === 'live' && (
        <button type="button" className="dribble-cta toro-wizz-btn" disabled={cooldown > 0} onClick={sendWizz}>
          {cooldown > 0 ? `⚡ Wizz (encore ${cooldown} s)` : `⚡ Envoyer un wizz à ${pseudo}`}
        </button>
      )}
    </div>
  )
}
