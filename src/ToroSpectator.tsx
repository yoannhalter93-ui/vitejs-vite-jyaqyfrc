import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import { drawToro, LW } from './RondoGame'
import type { ToroView } from './RondoGame'

// ============================================================================
// Regarder un pote jouer au toro en direct.
//
// Le joueur diffuse l'état de sa partie sur le canal `toro-live-<son id>`
// (voir RondoGame) dès qu'au moins un spectateur y est présent ; ici on
// signale sa présence, on reçoit ces états (~10 par seconde) et on redessine
// le terrain avec le même dessin que le jeu, en interpolant entre deux états
// pour que ce soit fluide. Lecture seule : on ne peut pas toucher au jeu.
// ============================================================================

interface Props {
  profileId: string
  pseudo: string
  onExit: () => void
}

type XY = [number, number]

interface Frame {
  t: number
  ph: 'play' | 'lost' | 'over'
  c: number
  to: number
  q: number
  b: XY
  p: XY[]
  u: XY[]
  n: number
  s: number
  m: ToroView['msg']
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpXY = (a: XY | undefined, b: XY, k: number) => ({ x: a ? lerp(a[0], b[0], k) : b[0], y: a ? lerp(a[1], b[1], k) : b[1] })

export default function ToroSpectator({ profileId, pseudo, onExit }: Props) {
  const { user } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  // deux derniers états reçus (et l'heure de réception du dernier)
  const framesRef = useRef<{ prev: Frame | null; last: Frame | null; at: number; gap: number }>({ prev: null, last: null, at: 0, gap: 100 })
  const [status, setStatus] = useState<'waiting' | 'live' | 'over' | 'gone'>('waiting')
  const [points, setPoints] = useState(0)
  const [passes, setPasses] = useState(0)

  // canal du joueur : présence (pour qu'il diffuse) + réception des états
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`toro-live-${profileId}`, { config: { presence: { key: user.id } } })
    ch.on('broadcast', { event: 'frame' }, ({ payload }) => {
      const f = payload as Frame
      const fr = framesRef.current
      const now = performance.now()
      // une nouvelle partie démarre : on repart de zéro (pas d'interpolation)
      const restarted = fr.last && f.t < fr.last.t
      fr.gap = fr.last && !restarted ? Math.min(250, Math.max(50, now - fr.at)) : 100
      fr.prev = restarted ? null : fr.last
      fr.last = f
      fr.at = now
      setPoints(f.s)
      setPasses(f.n)
      setStatus(f.ph === 'over' ? 'over' : 'live')
    }).subscribe((st) => {
      if (st === 'SUBSCRIBED') ch.track({ watching: true })
    })
    return () => { supabase.removeChannel(ch) }
  }, [profileId, user])

  // plus aucun état depuis 6 s pendant une partie : le joueur a quitté
  useEffect(() => {
    const id = setInterval(() => {
      const fr = framesRef.current
      if (fr.last && fr.last.ph !== 'over' && performance.now() - fr.at > 6000) setStatus('gone')
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // dessin
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
      const k = (rect.width / LW) * dpr
      ctx.setTransform(k, 0, 0, k, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(stage)
    let raf = 0
    const loop = () => {
      const fr = framesRef.current
      const viewH = (canvas.height / canvas.width) * LW
      const f = fr.last
      if (f) {
        // on affiche avec un état de retard, en glissant de l'avant-dernier
        // au dernier : mouvement fluide malgré ~10 états par seconde
        const k = Math.min(1, (performance.now() - fr.at) / fr.gap)
        const p = fr.prev
        const view: ToroView = {
          viewH,
          t: f.t + Math.min(2, (performance.now() - fr.at) / 1000),
          players: f.p.map((xy, i) => lerpXY(p?.p[i], xy, k)),
          bulls: f.u.map((xy, i) => lerpXY(p?.u[i], xy, k)),
          ball: { ...lerpXY(p?.b, f.b, k), to: f.to },
          carrier: f.c,
          queued: f.q,
          msg: f.m,
        }
        drawToro(ctx, view)
      } else {
        ctx.fillStyle = '#1d6b45'
        ctx.fillRect(0, 0, LW, viewH)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div className="predictions-screen dribble-page">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onExit}>← Jeux</button>
        <h2>👀 {pseudo} joue au toro</h2>
      </div>

      <div className="dribble-app">
        <div className="dribble-stat-row">
          <div className="dribble-stat"><b>{points}</b><span>Points</span></div>
          <div className="dribble-stat"><b>{passes}</b><span>Passes</span></div>
          <div className="dribble-stat"><b>{status === 'live' ? '🔴' : '—'}</b><span>{status === 'live' ? 'En direct' : 'Direct'}</span></div>
        </div>

        <div className="dribble-stage freekick-stage onetwo-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="freekick-canvas" />
          {status === 'waiting' && (
            <div className="dribble-idle-msg">
              <span style={{ fontSize: 30 }}>👀</span>
              <p className="dribble-sub">Connexion à la partie de {pseudo}…</p>
            </div>
          )}
          {(status === 'over' || status === 'gone') && (
            <div className="dribble-end-msg">
              <span className="dribble-big">{points}</span>
              <p className="dribble-sub">
                {status === 'over'
                  ? `point${points > 1 ? 's' : ''} pour ${pseudo} (${passes} passe${passes > 1 ? 's' : ''}). S'il relance une partie, tu la verras ici.`
                  : `${pseudo} a quitté la partie.`}
              </p>
              <button className="dribble-cta" onClick={onExit}>Retour aux jeux</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
