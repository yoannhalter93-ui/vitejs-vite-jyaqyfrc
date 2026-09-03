import { createElement, Fragment, useEffect, useRef, useState, type PointerEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface ScoreRow {
    profile_id: string
    score: number
    pseudo: string
}

interface Props {
    groupId: string
    groupName: string
}

interface Ball {
    x: number
    y: number
    vx: number
    vy: number
    missed: boolean
}

function monday(): string {
    const d = new Date()
    const day = d.getDay() || 7
    if (day !== 1) d.setDate(d.getDate() - day + 1)
    return d.toISOString().slice(0, 10)
}

// Constantes de jeu — toute la physique tourne dans cet espace fixe en
// pixels "logiques", jamais dans l'espace visuel affiché à l'écran (voir
// handleCanvasTap : le ratio réel est recalculé à chaque tap depuis
// getBoundingClientRect, jamais mis en cache).
const BALL_RADIUS = 14
const CANVAS_W = 300
const CANVAS_H = 340
const GRAVITY = 26 // px/s^2 (mis à l'échelle par le delta-temps réel, pas par frame) — nettement plus lourde : moins de temps pour réagir, on ne peut plus jongler "à l'infini"
const IMPULSE_VY = -460 // px/s — relevé mais pas dans les mêmes proportions que la gravité : le temps de suspension du ballon se réduit exprès
const HIT_RADIUS = 32 // tolérance resserrée : il faut vraiment viser le ballon, pas juste taper dans sa direction
const H_SENSITIVITY = 18 // px/s de vitesse horizontale par pixel d'écart au tap — quasi doublé : un tap décentré envoie vraiment le ballon sur le côté
const MAX_VX = 520 // px/s
const WALL_DAMPING = 0.75
const MAX_SCORE = 2000 // garde-fou de bon sens côté client (au-delà, score jugé irréaliste)
// Fini le chrono fixe de 30s qui faisait plafonner tout le monde au même
// score : la partie est désormais infinie, et c'est la difficulté qui monte
// — un nouveau ballon entre en jeu toutes les 30 secondes. La partie ne
// s'arrête que quand un ballon touche le sol (raté). Ça différencie
// vraiment les joueurs : certains tiennent avec 2 ballons, d'autres avec 3.
const BALL_SPAWN_INTERVAL = 30 // secondes entre deux nouveaux ballons
const MAX_BALLS = 3 // on plafonne à 3 ballons (2e à 30s, 3e à 60s) : au-delà ça devient injouable, pas de 4e ballon

function spawnBall(): Ball {
  // Tombe du haut de l'écran (hors du canvas, y négatif) plutôt qu'au milieu
      // comme le ballon de départ : sinon le nouveau ballon apparaît collé à
      // celui déjà en jeu et c'est injouable. x aléatoire pour ne pas réapparaître
      // toujours au même endroit.
  return { x: 60 + Math.random() * 180, y: -BALL_RADIUS, vx: 0, vy: 0, missed: false }
}

export default function JuggleGame({ groupId, groupName }: Props) {
    const { user } = useAuth()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [playing, setPlaying] = useState(false)
    const [score, setScore] = useState(0)
    const [elapsed, setElapsed] = useState(0)
    const [ballCount, setBallCount] = useState(1)
    const [finalScore, setFinalScore] = useState<number | null>(null)
    const [scores, setScores] = useState<ScoreRow[]>([])
    const [wizzShake, setWizzShake] = useState(false)
    const [wizzCooldown, setWizzCooldown] = useState(0)
    const [wizzFrom, setWizzFrom] = useState<string | null>(null)
    const [myPseudo, setMyPseudo] = useState<string | null>(null)
    // balles en jeu (x/y/vx/vy en pixels "logiques", espace fixe 300x340, et en
  // px/s pour les vitesses) + score + horloge d'apparition du prochain ballon
  const stateRef = useRef<{ balls: Ball[]; running: boolean; score: number; nextSpawnAt: number }>({
        balls: [],
        running: false,
        score: 0,
        nextSpawnAt: BALL_SPAWN_INTERVAL,
  })
    const lastTimeRef = useRef<number | null>(null)
    // Miroir de wizzCooldown en ref : l'abonnement temps réel ci-dessous ne se
  // ré-exécute pas à chaque changement de cooldown (dépendances [groupId,
  // user]), donc son callback aurait sinon une closure figée sur la valeur du
  // premier rendu — même piège que stateRef pour la boucle de physique.
  const wizzCooldownRef = useRef(0)
    // Canal temps réel partagé avec App.tsx (même nom `wizz-<groupId>`) : sert à
  // prévenir les autres membres du groupe qu'une partie démarre/s'arrête, et à
  // recevoir les wizz qu'ils nous envoient pendant qu'on joue.
  const wizzChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const loadScores = async () => {
        const { data: period } = await supabase.from('group_periods').select('id').eq('group_id', groupId).eq('is_current', true).maybeSingle()
        const { data: s } = await supabase.from('juggle_scores').select('profile_id, score')
          .eq('group_id', groupId).eq('week_start', monday()).order('score', { ascending: false })
        const ids = [...new Set((s ?? []).map((r) => r.profile_id))]
        let pseudos: Record<string, string> = {}
              if (ids.length > 0) {
                      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
                      pseudos = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
              }
        const best: Record<string, number> = {}
              for (const r of s ?? []) best[r.profile_id] = Math.max(best[r.profile_id] ?? 0, r.score)
        const rows = Object.entries(best).map(([profile_id, sc]) => ({ profile_id, score: sc, pseudo: pseudos[profile_id] ?? '???' }))
        rows.sort((a, b) => b.score - a.score)
        setScores(rows)
        void period
  }

  useEffect(() => {
        loadScores()
        // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // Récupère mon propre pseudo une fois, pour l'inclure dans le message
  // "X joue aux Jonglages !" diffusé aux autres membres du groupe.
  useEffect(() => {
        if (!user) return
        supabase.from('profiles').select('pseudo').eq('id', user.id).maybeSingle()
          .then(({ data }) => setMyPseudo(data?.pseudo ?? null))
  }, [user])

  // Abonnement au canal temps réel du groupe, pour toute la durée où l'écran
  // Jonglages est ouvert (pas seulement pendant qu'on joue) : ça permet de
  // recevoir un wizz même juste avant/après une partie, et surtout de pouvoir
  // diffuser le début/fin de partie dès qu'on appuie sur "Commencer".
  useEffect(() => {
        const channel = supabase.channel(`wizz-${groupId}`)
        channel.on('broadcast', { event: 'wizz' }, ({ payload }) => {
                if (!user || !payload || payload.targetProfileId !== user.id) return
                if (!stateRef.current.running) return
                if (wizzCooldownRef.current > 0) return
                triggerWizzEffect(payload.fromPseudo || 'Un ami')
        }).subscribe()
        wizzChannelRef.current = channel
        return () => {
                // Si on quitte l'écran en pleine partie (navigation ailleurs), on
                // prévient quand même que la partie s'arrête, pour ne pas laisser le
                // bandeau "X joue aux Jonglages" affiché indéfiniment chez les autres.
                if (user && stateRef.current.running) {
                          channel.send({ type: 'broadcast', event: 'playing', payload: { action: 'stop', profileId: user.id } })
                }
                supabase.removeChannel(channel)
                wizzChannelRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const paint = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, balls: Ball[]) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#171b24'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        for (const b of balls) drawBallGraphic(ctx, b.x, b.y, b.missed)
  }
    const drawBallGraphic = (ctx: CanvasRenderingContext2D, x: number, y: number, miss: boolean) => {
          const r = BALL_RADIUS
          ctx.save()
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.clip()
          const grad = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.15, x, y, r)
          grad.addColorStop(0, '#ffffff')
          grad.addColorStop(1, '#c7c7c7')
          ctx.fillStyle = grad
          ctx.fillRect(x - r, y - r, r * 2, r * 2)
          ctx.fillStyle = miss ? '#e74c3c' : '#1b1b1f'
          ctx.beginPath()
          for (let i = 0; i < 5; i++) {
                  const a = -Math.PI / 2 + i * ((Math.PI * 2) / 5)
                  const px = x + Math.cos(a) * r * 0.42
                  const py = y + Math.sin(a) * r * 0.42
                  if (i === 0) ctx.moveTo(px, py)
                  else ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.fill()
          ctx.restore()
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
          ctx.lineWidth = 1
          ctx.stroke()
    }

  const drawIdle = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        paint(ctx, canvas, [{ x: 150, y: 200, vx: 0, vy: 0, missed: false }])
  }

  useEffect(() => {
        if (!playing) drawIdle()
        // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  useEffect(() => {
        wizzCooldownRef.current = wizzCooldown
        if (wizzCooldown <= 0) return
        const t = setTimeout(() => setWizzCooldown((c) => c - 1), 1000)
        return () => clearTimeout(t)
  }, [wizzCooldown])

  // Effet de wizz partagé : déclenché par un wizz reçu en direct d'un
  // coéquipier pendant qu'on joue. Ne se contente pas de secouer l'écran :
  // si une partie est en cours, TOUS les ballons actuellement en jeu reçoivent
  // un coup aléatoire (vitesse horizontale ET verticale) pour casser le
  // timing du joueur, pas juste son écran — plus il y a de ballons, plus le
  // chaos est grand.
  const triggerWizzEffect = (fromPseudo: string) => {
        setWizzShake(true)
        setWizzFrom(fromPseudo)
        if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 120, 60, 220])

        const st = stateRef.current
        if (st.running) {
                for (const b of st.balls) {
                          const kick = (260 + Math.random() * 220) * (Math.random() < 0.5 ? -1 : 1)
                          b.vx += kick
                          if (b.vx > MAX_VX) b.vx = MAX_VX
                          if (b.vx < -MAX_VX) b.vx = -MAX_VX
                          b.vy -= 90 + Math.random() * 90
                }
        }

        setTimeout(() => { setWizzShake(false); setWizzFrom(null) }, 900)
        setWizzCooldown(15)
  }

  const startGame = () => {
        setFinalScore(null)
        setScore(0)
        setElapsed(0)
        setBallCount(1)
        stateRef.current = { balls: [{ x: 150, y: 200, vx: 0, vy: -120, missed: false }], running: true, score: 0, nextSpawnAt: BALL_SPAWN_INTERVAL }
        lastTimeRef.current = null
        setPlaying(true)

        // Préviens les autres membres du groupe (bandeau + bouton "Envoyer un
        // wizz" affiché sur tous leurs écrans, via App.tsx) que la partie démarre.
        if (user) {
                wizzChannelRef.current?.send({
                          type: 'broadcast',
                          event: 'playing',
                          payload: { action: 'start', profileId: user.id, pseudo: myPseudo || 'Un coéquipier' },
                })
                // notification persistée + push, pour les membres du groupe qui
                // n'ont pas l'appli ouverte en ce moment (le broadcast temps réel
                // ci-dessus ne les atteint pas)
                supabase.rpc('notify_juggle_start', { p_group_id: groupId })
        }

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let raf: number
        const startTime = Date.now()

        // La physique était auparavant calculée "par frame" (donc 1,5 à 2x plus
        // vite en temps réel sur un écran 90/120Hz mobile que sur un écran 60Hz).
        // On calcule ici le delta-temps RÉEL entre deux images (timestamp fourni
        // par requestAnimationFrame) et on l'applique en px/s, pour un ressenti
        // identique quel que soit le taux de rafraîchissement de l'appareil.
        // Le delta est plafonné à 50ms pour éviter un bond si l'onglet était en
        // arrière-plan (changement d'écran, verrouillage, etc.).
        const loop = (timestamp: number) => {
                const st = stateRef.current
                if (!st.running) return

                if (lastTimeRef.current === null) {
                          lastTimeRef.current = timestamp
                          raf = requestAnimationFrame(loop)
                          return
                }
                const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05)
                lastTimeRef.current = timestamp

                for (const b of st.balls) {
                          b.vy += GRAVITY * 60 * dt
                          b.y += b.vy * dt

                  b.x += b.vx * dt
                          b.vx *= Math.pow(0.99, dt * 60)
                          if (b.x < BALL_RADIUS) {
                                      b.x = BALL_RADIUS
                                      b.vx = Math.abs(b.vx) * WALL_DAMPING
                          } else if (b.x > CANVAS_W - BALL_RADIUS) {
                                      b.x = CANVAS_W - BALL_RADIUS
                                      b.vx = -Math.abs(b.vx) * WALL_DAMPING
                          }
                }

                const elapsedSec = (Date.now() - startTime) / 1000
                setElapsed(Math.floor(elapsedSec))

                // Un seul ballon qui touche le sol met fin à la partie : jongler avec
                // plusieurs ballons, c'est ne laisser tomber AUCUN d'entre eux.
                if (st.balls.some((b) => b.y > 320)) {
                          st.running = false
                          endGame(st.score)
                          return
                }

                // Toutes les BALL_SPAWN_INTERVAL secondes, un nouveau ballon entre en
                // jeu (jusqu'à MAX_BALLS) : c'est ça qui fait monter la difficulté au
                // lieu d'un chrono fixe. Une fois le plafond atteint, la partie continue
                // sans nouveau ballon — juste tenir le plus longtemps possible.
                if (st.balls.length < MAX_BALLS && elapsedSec >= st.nextSpawnAt) {
                          st.balls.push(spawnBall())
                          st.nextSpawnAt += BALL_SPAWN_INTERVAL
                          setBallCount(st.balls.length)
                }

                paint(ctx, canvas, st.balls)
                for (const b of st.balls) b.missed = false

                raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        ;(canvas as any)._raf = raf
  }

  const hit = (clickX: number, clickY: number) => {
        const st = stateRef.current
        if (!st.running || st.balls.length === 0) return
        // Fenêtre de hauteur assez large + distance réelle (x ET y) au ballon,
        // plutôt qu'une simple bande horizontale : plus fidèle à "as-tu vraiment
        // tapé sur le ballon", et plus tolérant pour un doigt qui vise large.
        // Avec plusieurs ballons en jeu, on prend le plus proche du tap parmi
        // ceux qui retombent (vy > 0) et qui sont dans le rayon de tolérance.
        let best: Ball | null = null
        let bestDist = Infinity
        for (const b of st.balls) {
                if (b.vy <= 0) continue
                const dist = Math.hypot(clickX - b.x, clickY - b.y)
                if (dist <= HIT_RADIUS && dist < bestDist) {
                          best = b
                          bestDist = dist
                }
        }
        if (best) {
                best.vy = IMPULSE_VY
                // Taper à GAUCHE du ballon l'envoie à DROITE (et inversement) — comme
          // un vrai contact qui dévie la trajectoire à l'opposé du point touché.
          const offset = best.x - clickX
                best.vx += Math.sign(offset) * H_SENSITIVITY * Math.min(Math.abs(offset), 45)
                if (best.vx > MAX_VX) best.vx = MAX_VX
                if (best.vx < -MAX_VX) best.vx = -MAX_VX
                st.score += 1
                setScore(st.score)
        } else {
                // Raté : on teinte en rouge le ballon le plus proche du tap, pour
          // donner un retour visuel même si on n'a touché personne.
          let nearest: Ball | null = null
                let nearestDist = Infinity
                for (const b of st.balls) {
                          const dist = Math.hypot(clickX - b.x, clickY - b.y)
                          if (dist < nearestDist) {
                                      nearest = b
                                      nearestDist = dist
                          }
                }
                if (nearest) nearest.missed = true
        }
  }

  const handleCanvasTap = (e: PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        let clickX = 150
        let clickY = 200
        if (canvas) {
                // Le ratio d'échelle réel est recalculé ICI, au moment précis du tap,
          // directement depuis getBoundingClientRect — jamais depuis une valeur
          // mise en cache dans le state React, qui pourrait être mesurée trop
          // tôt (avant que la mise en page mobile soit stabilisée) et donc
          // désynchronisée au moment exact où le doigt touche l'écran.
          const rect = canvas.getBoundingClientRect()
                clickX = ((e.clientX - rect.left) / rect.width) * CANVAS_W
                clickY = ((e.clientY - rect.top) / rect.height) * CANVAS_H
        }
        if (playing) {
                hit(clickX, clickY)
        } else {
                startGame()
        }
  }

  const endGame = async (finalScRaw: number) => {
        const finalSc = Math.min(finalScRaw, MAX_SCORE)
        setPlaying(false)
        setFinalScore(finalSc)
        if (!user) return
        wizzChannelRef.current?.send({
                type: 'broadcast',
                event: 'playing',
                payload: { action: 'stop', profileId: user.id },
        })
        await supabase.from('juggle_scores').insert({
                group_id: groupId, profile_id: user.id, week_start: monday(), score: finalSc,
        })
        await loadScores()
  }

  // Construit le JSX via createElement plutôt qu'en syntaxe balisée : la
  // partie visuelle est identique, seule la façon de l'écrire change.
  return createElement(
        'div',
    { className: `predictions-screen${wizzShake ? ' juggle-wizz-shake' : ''}` },
        createElement(
                'div',
          { className: 'predictions-header' },
                createElement('h2', null, 'Jonglages — ', groupName)
              ),
        createElement(
                'p',
          { className: 'predictions-period' },
                "Tape sur le ballon pour commencer, puis tape bien dessus à chaque fois qu'il redescend pour le renvoyer en l'air. Un tap trop loin ne compte pas, et s'il te tape de travers il part sur le côté. Pas de chrono : un nouveau ballon entre en jeu toutes les 30 secondes (jusqu'à 3 ballons), et la partie s'arrête dès qu'un seul ballon touche le sol — tiens le plus longtemps possible !"
              ),
        createElement(
                'div',
          { className: 'juggle-canvas-wrap' },
                createElement('canvas', {
                          ref: canvasRef,
                          width: CANVAS_W,
                          height: CANVAS_H,
                          onPointerDown: handleCanvasTap,
                          style: { background: '#171b24', borderRadius: 12, border: '1px solid #2a2f3a', cursor: 'pointer', touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', maxWidth: '100%', height: 'auto' },
                }),
                wizzShake &&
                  createElement(
                              'div',
                    { className: 'juggle-wizz-overlay' },
                              createElement('span', { className: 'juggle-wizz-overlay-text' }, `⚡ WIZZ de ${wizzFrom || 'un ami'} !`)
                            )
              ),
        createElement(
                'div',
          { className: 'match-predict' },
                playing
                  ? createElement(
                                Fragment,
                                null,
                                createElement('span', null, 'Score : ', score),
                                createElement('span', null, 'Temps : ', elapsed, 's'),
                                createElement('span', null, 'Ballons : ', ballCount)
                              )
                  : createElement(
                                'button',
                    { className: 'match-save-btn', onClick: startGame },
                                finalScore !== null ? 'Rejouer' : 'Commencer'
                              )
              ),
        finalScore !== null &&
          !playing &&
          createElement('p', { className: 'match-result' }, 'Score final : ', finalScore, ' jonglages'),
        scores.length > 0 &&
          createElement(
                    'div',
            { className: 'roulette-teammates' },
                    createElement('p', { className: 'predictions-period' }, 'Meilleurs scores de la semaine :'),
                    createElement(
                                'ul',
                      { className: 'matches-list' },
                                scores.map((s, i) =>
                                              createElement(
                                                              'li',
                                                { className: 'match-card roulette-teammate-card', key: s.profile_id },
                                                              createElement('span', null, i + 1, '. ', s.pseudo),
                                                              createElement('span', { className: 'roulette-teammate-team' }, s.score)
                                                            )
                                                     )
                              )
                  )
      )
}
