import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

const ZONES: { value: string; label: string }[] = [
  { value: 'haut-gauche', label: 'Haut gauche' },
  { value: 'haut-droite', label: 'Haut droite' },
  { value: 'milieu', label: 'Milieu' },
  { value: 'bas-gauche', label: 'Bas gauche' },
  { value: 'bas-droite', label: 'Bas droite' },
]

// coordonnées (en % de la cage) de chaque zone, partagées par le ballon et
// le gardien pour que les deux animations restent cohérentes entre elles
const ZONE_POS: Record<string, { left: string; top: string }> = {
  'haut-gauche': { left: '20%', top: '22%' },
  'haut-droite': { left: '80%', top: '22%' },
  'milieu': { left: '50%', top: '46%' },
  'bas-gauche': { left: '20%', top: '78%' },
  'bas-droite': { left: '80%', top: '78%' },
}

function useSynth() {
  const ctxRef = useRef<AudioContext | null>(null)
  const getCtx = () => {
    if (!ctxRef.current) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      ctxRef.current = new AC()
    }
    return ctxRef.current!
  }
  const tone = (freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.15) => {
    try {
      const ctx = getCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
      gain.gain.setValueAtTime(vol, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur + 0.02)
    } catch { /* audio non disponible, tant pis */ }
  }
  const playGoal = () => { tone(180, 0, 0.08, 'square', 0.12);[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.08 + i * 0.07, 0.18, 'triangle', 0.13)) }
  const playPanenka = () => { tone(180, 0, 0.08, 'square', 0.12); tone(300, 0.1, 0.1, 'sine', 0.1); tone(220, 0.18, 0.1, 'sine', 0.1);[392, 523, 659, 784, 988, 1175].forEach((f, i) => tone(f, 0.3 + i * 0.06, 0.22, 'triangle', 0.14)) }
  const playSave = () => { tone(140, 0, 0.1, 'square', 0.14); tone(220, 0.05, 0.12, 'sawtooth', 0.1); tone(160, 0.16, 0.18, 'sawtooth', 0.09) }
  const playKick = () => { tone(300, 0, 0.05, 'square', 0.1) }
  const playVictory = () => {[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.14)) }
  const playDefeat = () => {[392, 349, 293, 220].forEach((f, i) => tone(f, i * 0.16, 0.35, 'sawtooth', 0.1)) }
  return { playGoal, playPanenka, playSave, playKick, playVictory, playDefeat }
}

interface Duel {
  id: string
  player_a_id: string
  player_b_id: string
  phase: string
  score_a: number
  score_b: number
  winner_id: string | null
  finished_at: string | null
}

interface Attempt {
  attempt_number: number
  phase_number: number
  shooter_id: string
  keeper_id: string
  shooter_zone: string | null
  keeper_zone: string | null
  scored: boolean | null
  points: number | null
  resolved: boolean
  shot_taken: boolean
}

interface Props {
  groupId: string
  groupName: string
}

// lundi (UTC) de la semaine en cours, même convention que le tirage au sort
// côté base (date_trunc('week', now())) — sert à filtrer "tous les duels de
// la semaine" puisque penalty_duels n'a pas de colonne week_start dédiée
function mondayUtcISO(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return monday.toISOString().slice(0, 10)
}

export default function PenaltyDuel({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [duels, setDuels] = useState<Duel[]>([])
  const [allDuels, setAllDuels] = useState<Duel[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // animation en cours (tir aveugle ou plongeon du gardien)
  const [animMode, setAnimMode] = useState<'shoot' | 'keep' | null>(null)
  const [animBusy, setAnimBusy] = useState(false)
  const [animZone, setAnimZone] = useState<string | null>(null)
  const [animStage, setAnimStage] = useState<'start' | 'flying' | 'sent' | 'reveal' | 'result' | null>(null)
  const [animResult, setAnimResult] = useState<{ scored: boolean; points: number; shooterZone: string } | null>(null)
  const [finishedSoundPlayed, setFinishedSoundPlayed] = useState<string | null>(null)

  const { playGoal, playPanenka, playSave, playKick, playVictory, playDefeat } = useSynth()

  const loadList = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: gm } = await supabase
      .from('group_members').select('profile_id').eq('group_id', groupId)
    const ids = (gm ?? []).map((m) => m.profile_id)
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
      setPseudos(Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo])))
    }

    const { data: d, error: dErr } = await supabase
      .from('penalty_duels').select('id, player_a_id, player_b_id, phase, score_a, score_b, winner_id, finished_at')
      .eq('group_id', groupId).or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
    if (dErr) setError(dErr.message)
    setDuels(d ?? [])

    // tous les duels du groupe pour la semaine en cours (qui affronte qui,
    // et où ils en sont), pas seulement les miens
    const { data: all } = await supabase
      .from('penalty_duels').select('id, player_a_id, player_b_id, phase, score_a, score_b, winner_id, finished_at')
      .eq('group_id', groupId).gte('created_at', mondayUtcISO())
      .order('created_at', { ascending: true })
    setAllDuels(all ?? [])

    setLoading(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const openDuel = async (id: string) => {
    setSelected(id)
    setError(null)
    const { data, error: err } = await supabase.rpc('get_penalty_duel_attempts', { p_duel_id: id })
    if (err) setError(err.message)
    setAttempts((data ?? []) as Attempt[])
  }

  const duel = duels.find((d) => d.id === selected)

  // son de victoire/défaite une seule fois quand le duel vient de se terminer
  useEffect(() => {
    if (duel?.phase === 'done' && selected && finishedSoundPlayed !== selected) {
      setFinishedSoundPlayed(selected)
      if (duel.winner_id === user?.id) playVictory()
      else if (duel.winner_id && duel.winner_id !== user?.id) playDefeat()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel?.phase, duel?.winner_id, selected])

  const isPlayerA = duel?.player_a_id === user?.id
  const myShooterPhase = isPlayerA ? 1 : 2
  const myKeeperPhase = isPlayerA ? 2 : 1

  const myShotAttempts = attempts.filter((a) => a.phase_number === myShooterPhase && a.shooter_id === user?.id)
  const myKeepAttempts = attempts.filter((a) => a.phase_number === myKeeperPhase && a.keeper_id === user?.id)

  const iHaveShot = myShotAttempts.length > 0 && myShotAttempts.every((a) => a.shot_taken)
  const opponentHasShot = myKeepAttempts.length > 0 && myKeepAttempts.every((a) => a.shot_taken)
  const iHaveFinishedKeeping = myKeepAttempts.length > 0 && myKeepAttempts.every((a) => a.resolved)

  const myTurnToShoot = !!duel && duel.phase !== 'done' && !iHaveShot
  const myTurnToSave = !!duel && duel.phase !== 'done' && opponentHasShot && !iHaveFinishedKeeping

  const nextShotAttempt = myShotAttempts.find((a) => a.shooter_zone === null) ?? null
  const nextKeepAttempt = myKeepAttempts.find((a) => a.shot_taken && !a.resolved) ?? null
  const shotsDone = myShotAttempts.filter((a) => a.shooter_zone !== null).length
  const savesDone = myKeepAttempts.filter((a) => a.resolved).length

  const pickShotZone = async (zone: string) => {
    if (!selected || animBusy || !nextShotAttempt) return
    setAnimBusy(true)
    setAnimMode('shoot')
    setAnimZone(zone)
    setAnimStage('start')
    playKick()
    // laisse le ballon partir de son point de départ avant de lancer la
    // transition CSS vers la cible (sinon pas d'animation, juste un saut)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimStage('flying')))

    const { error: err } = await supabase.rpc('submit_shot', {
      p_duel_id: selected, p_attempt_number: nextShotAttempt.attempt_number, p_zone: zone,
    })
    if (err) {
      setError(err.message)
      setAnimBusy(false); setAnimMode(null); setAnimStage(null); setAnimZone(null)
      return
    }

    setTimeout(() => {
      setAnimStage('sent')
      setTimeout(async () => {
        setAnimBusy(false); setAnimMode(null); setAnimStage(null); setAnimZone(null)
        await openDuel(selected)
        await loadList()
      }, 750)
    }, 550)
  }

  const pickSaveZone = async (zone: string) => {
    if (!selected || animBusy || !nextKeepAttempt) return
    setAnimBusy(true)
    setAnimMode('keep')
    setAnimZone(zone)
    setAnimResult(null)
    setAnimStage('start')
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimStage('flying')))

    const attemptRef = nextKeepAttempt
    const { error: err } = await supabase.rpc('submit_save', {
      p_duel_id: selected, p_attempt_number: attemptRef.attempt_number, p_zone: zone,
    })
    if (err) {
      setError(err.message)
      setAnimBusy(false); setAnimMode(null); setAnimStage(null); setAnimZone(null)
      return
    }

    const { data } = await supabase.rpc('get_penalty_duel_attempts', { p_duel_id: selected })
    const fresh = (data ?? []) as Attempt[]
    setAttempts(fresh)
    const resolved = fresh.find(
      (a) => a.phase_number === attemptRef.phase_number && a.attempt_number === attemptRef.attempt_number
    )

    // le gardien plonge d'abord (on ne sait pas encore où le tir est parti),
    // puis seulement une fois la plongée terminée le ballon arrive
    // visiblement vers sa vraie zone — sinon il "apparaît" directement dans
    // le coin et on ne voit jamais où l'adversaire a réellement tiré
    setTimeout(() => {
      setAnimStage('reveal')
      setTimeout(() => {
        if (resolved) {
          const shooterZone = resolved.shooter_zone || zone
          const scored = !!resolved.scored
          setAnimResult({ scored, points: resolved.points ?? 0, shooterZone })
          setAnimStage('result')
          if (scored) (shooterZone === 'milieu' ? playPanenka() : playGoal())
          else playSave()
        }
        setTimeout(async () => {
          setAnimBusy(false); setAnimMode(null); setAnimStage(null); setAnimZone(null); setAnimResult(null)
          await openDuel(selected)
          await loadList()
        }, 2200)
      }, 600)
    }, 550)
  }

  const zoneBtn = (value: string) => {
    const z = ZONES.find((zz) => zz.value === value)!
    return (
      <button
        key={value}
        className="groups-action-btn groups-action-btn-secondary"
        disabled={animBusy}
        onClick={() => (myTurnToShoot ? pickShotZone(value) : pickSaveZone(value))}
      >{z.label}</button>
    )
  }

  if (selected) {
    const opponentId = duel && (duel.player_a_id === user?.id ? duel.player_b_id : duel.player_a_id)

    // pendant l'animation : ballon/gardien vers la zone choisie ; sinon,
    // ballon posé au point de départ (bas de la cage) et gardien au centre
    const ballTarget = animMode === 'shoot'
      ? (animStage === 'start' ? { left: '50%', top: '96%' } : ZONE_POS[animZone!])
      : (animStage === 'result' && animResult ? ZONE_POS[animResult.shooterZone] : { left: '50%', top: '96%' })
    const keeperTarget = animMode === 'keep' && animZone && (animStage === 'flying' || animStage === 'reveal' || animStage === 'result')
      ? ZONE_POS[animZone]
      : { left: '50%', top: '50%' }
    // en tir : le ballon est visible dès le départ. En arrêt : il ne
    // "sort" qu'à la phase reveal (une fois le gardien déjà plongé sur sa
    // zone devinée), puis on le laisse visiblement voler jusqu'à sa vraie
    // zone à la phase result — sinon il apparaît directement dans le coin
    // et on ne voit jamais où l'adversaire a réellement tiré
    const showBall = animMode === 'shoot'
      ? animStage !== null
      : (animStage === 'reveal' || animStage === 'result')
    const netShake = animStage === 'result' && animResult?.scored

    return (
      <div className="predictions-screen">
        <div className="predictions-header">
          <button className="predictions-back" onClick={() => setSelected(null)}>← Duels</button>
          <h2>vs {opponentId ? pseudos[opponentId] ?? '???' : '???'}</h2>
        </div>
        {error && <p className="groups-error">{error}</p>}

        {duel?.phase === 'done' ? (
          <p className="match-result">Score final : {duel.score_a} - {duel.score_b}
            {duel.winner_id ? (duel.winner_id === user?.id ? ' — Tu as gagné !' : ' — Tu as perdu.') : ' — Match nul.'}</p>
        ) : myTurnToShoot || myTurnToSave ? (
          <div className="roulette-result">
            <div className={"penalty-cage" + (netShake ? ' penalty-cage-shake' : '')}>
              {animMode === 'keep' && (
                <div className="penalty-keeper" style={{ left: keeperTarget.left, top: keeperTarget.top }}>🧤</div>
              )}
              {showBall && (
                <div className="penalty-ball" style={{ left: ballTarget.left, top: ballTarget.top }}>⚽</div>
              )}
              {animStage === 'result' && animResult && (
                <div className={"penalty-flash " + (animResult.scored ? 'penalty-flash-goal' : 'penalty-flash-save')} />
              )}
            </div>

            {animStage === 'result' && animResult ? (
              <p className={"penalty-anim-caption " + (animResult.scored ? 'penalty-caption-goal' : 'penalty-caption-save')}>
                {animResult.scored
                  ? (animResult.shooterZone === 'milieu' ? '🎩 Panenka ! But au milieu (+2)' : '⚽ But dans le coin ! (+1)')
                  : '🧤 Arrêté ! (+0)'}
              </p>
            ) : animMode === 'keep' && animStage === 'reveal' ? (
              <p className="penalty-anim-caption">👀 Le tir arrive...</p>
            ) : animMode === 'keep' && animStage === 'flying' ? (
              <p className="penalty-anim-caption">🧤 Plongeon...</p>
            ) : animMode === 'shoot' && animStage ? (
              <p className="penalty-anim-caption">⚽ Tir envoyé, à l'aveugle...</p>
            ) : myTurnToShoot ? (
              <p className="predictions-period">Choisis où viser (tir {shotsDone + 1} / 3, l'adversaire ne le voit pas) :</p>
            ) : (
              <p className="predictions-period">Devine où l'adversaire a tiré (arrêt {savesDone + 1} / 3) :</p>
            )}

            <div className="penalty-zone-grid">
              <div className="penalty-zone-row">
                {zoneBtn('haut-gauche')}
                {zoneBtn('haut-droite')}
              </div>
              <div className="penalty-zone-row penalty-zone-row-center">
                {zoneBtn('milieu')}
              </div>
              <div className="penalty-zone-row">
                {zoneBtn('bas-gauche')}
                {zoneBtn('bas-droite')}
              </div>
            </div>

            <div className="penalty-progress-dots">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={
                    "penalty-dot" +
                    (i < (myTurnToShoot ? shotsDone : savesDone) ? " penalty-dot-done" : "") +
                    (i === (myTurnToShoot ? shotsDone : savesDone) && !animBusy ? " penalty-dot-current" : "")
                  }
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="groups-empty">
            {iHaveShot && !opponentHasShot
              ? "Tes tirs sont enregistrés, en attente que l'adversaire tire les siens..."
              : "En attente de l'adversaire..."}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Duel de penaltys — {groupName}</h2>
      </div>
      <p className="predictions-period">
        Chaque semaine, un adversaire différent t'est tiré au sort automatiquement (jamais deux fois la même personne tant que tu n'as pas croisé tout le groupe). Tu peux tirer tes 3 penaltys dès que tu veux, sans attendre l'adversaire.
      </p>
      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : duels.length === 0 ? (
        <p className="groups-empty">Ton premier duel de penaltys arrive au prochain tirage au sort hebdomadaire.</p>
      ) : (
        <ul className="matches-list">
          {duels.map((d) => {
            const opponentId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
            return (
              <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                <div className="match-teams">
                  <span>vs {pseudos[opponentId] ?? '???'}</span>
                </div>
                {d.phase === 'done' ? (
                  <div className="match-result">Terminé : {d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">En cours</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {allDuels.length > 0 && (
        <>
          <h3 className="rules-section-title">Tous les duels de la semaine</h3>
          <ul className="matches-list">
            {allDuels.map((d) => (
              <li className="match-card" key={d.id}>
                <div className="match-teams">
                  <span>{pseudos[d.player_a_id] ?? '???'} vs {pseudos[d.player_b_id] ?? '???'}</span>
                </div>
                {d.phase === 'done' ? (
                  <div className="match-result">{d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">En cours ({d.score_a} - {d.score_b})</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
