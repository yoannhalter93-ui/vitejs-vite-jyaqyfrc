import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

const ZONES: { value: string; label: string }[] = [
  { value: 'haut-gauche', label: 'Haut gauche' },
  { value: 'haut-droite', label: 'Haut droite' },
  { value: 'milieu', label: 'Milieu' },
  { value: 'bas-gauche', label: 'Bas gauche' },
  { value: 'bas-droite', label: 'Bas droite' },
]

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
}

interface Props {
  groupId: string
  groupName: string
}

export default function PenaltyDuel({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [duels, setDuels] = useState<Duel[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [shots, setShots] = useState<Record<number, string>>({})
  const [saves, setSaves] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    setLoading(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const openDuel = async (id: string) => {
    setSelected(id)
    setShots({})
    setSaves({})
    setError(null)
    const { data, error: err } = await supabase.rpc('get_penalty_duel_attempts', { p_duel_id: id })
    if (err) setError(err.message)
    setAttempts((data ?? []) as Attempt[])
  }

  const submitShots = async () => {
    if (!user || !selected) return
    setError(null)
    for (let n = 1; n <= 3; n++) {
      const zone = shots[n]
      if (!zone) continue
      const { error: err } = await supabase.rpc('submit_shot', { p_duel_id: selected, p_attempt_number: n, p_zone: zone })
      if (err) { setError(err.message); return }
    }
    await openDuel(selected)
    await loadList()
  }

  const submitSaves = async () => {
    if (!user || !selected) return
    setError(null)
    for (let n = 1; n <= 3; n++) {
      const zone = saves[n]
      if (!zone) continue
      const { error: err } = await supabase.rpc('submit_save', { p_duel_id: selected, p_attempt_number: n, p_zone: zone })
      if (err) { setError(err.message); return }
    }
    await openDuel(selected)
    await loadList()
  }

  if (selected) {
    const duel = duels.find((d) => d.id === selected)
    const opponentId = duel && (duel.player_a_id === user?.id ? duel.player_b_id : duel.player_a_id)
    const isPlayerA = duel?.player_a_id === user?.id

    const myTurnToShoot = !!duel && ((duel.phase === 'a_shoots' && isPlayerA) || (duel.phase === 'b_shoots' && !isPlayerA))
    const myTurnToSave = !!duel && ((duel.phase === 'b_keeps' && !isPlayerA) || (duel.phase === 'a_keeps' && isPlayerA))
    const activePhaseNumber = duel?.phase === 'a_shoots' || duel?.phase === 'b_keeps' ? 1 : 2
    const myShotAttempts = attempts.filter((a) => a.phase_number === activePhaseNumber && a.shooter_id === user?.id)
    const mySaveAttempts = attempts.filter((a) => a.phase_number === activePhaseNumber && a.keeper_id === user?.id)
    const allShotsChosen = [1, 2, 3].every((n) => shots[n])
    const allSavesChosen = [1, 2, 3].every((n) => saves[n])

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
        ) : myTurnToShoot ? (
          <div className="roulette-result">
            <p className="predictions-period">Choisis tes 3 tirs (l'adversaire ne les voit pas) :</p>
            {myShotAttempts.map((a) => (
              <div className="match-predict" key={a.attempt_number}>
                <span>Tir {a.attempt_number} :</span>
                {ZONES.map((z) => (
                  <button
                    key={z.value}
                    className={"groups-action-btn groups-action-btn-secondary" + (shots[a.attempt_number] === z.value ? " group-nav-tab-active" : "")}
                    onClick={() => setShots((s) => ({ ...s, [a.attempt_number]: z.value }))}
                  >{z.label}</button>
                ))}
              </div>
            ))}
            <button className="match-save-btn" disabled={!allShotsChosen} onClick={submitShots}>Valider mes tirs</button>
          </div>
        ) : myTurnToSave ? (
          <div className="roulette-result">
            <p className="predictions-period">Devine où l'adversaire a tiré (3 arrêts) :</p>
            {mySaveAttempts.map((a) => (
              <div className="match-predict" key={a.attempt_number}>
                <span>Tir {a.attempt_number} :</span>
                {ZONES.map((z) => (
                  <button
                    key={z.value}
                    className={"groups-action-btn groups-action-btn-secondary" + (saves[a.attempt_number] === z.value ? " group-nav-tab-active" : "")}
                    onClick={() => setSaves((s) => ({ ...s, [a.attempt_number]: z.value }))}
                  >{z.label}</button>
                ))}
              </div>
            ))}
            <button className="match-save-btn" disabled={!allSavesChosen} onClick={submitSaves}>Valider mes arrêts</button>
          </div>
        ) : (
          <p className="groups-empty">En attente de l'adversaire...</p>
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
        Chaque semaine, un adversaire différent t'est tiré au sort automatiquement (jamais deux fois la même personne tant que tu n'as pas croisé tout le groupe).
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
            const isPlayerA = d.player_a_id === user?.id
            const myTurn = (d.phase === 'a_shoots' && isPlayerA) || (d.phase === 'b_shoots' && !isPlayerA)
              || (d.phase === 'b_keeps' && !isPlayerA) || (d.phase === 'a_keeps' && isPlayerA)
            return (
              <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                <div className="match-teams">
                  <span>vs {pseudos[opponentId] ?? '???'}</span>
                </div>
                {d.phase === 'done' ? (
                  <div className="match-result">Terminé : {d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">{myTurn ? 'À toi de jouer !' : 'En attente de l\'adversaire'}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

const ZONES = ['gauche', 'centre', 'droite']

interface Duel {
  id: string
  player_a_id: string
  player_b_id: string
  score_a: number
  score_b: number
  winner_id: string | null
  finished_at: string | null
}

interface Attempt {
  id: string
  duel_id: string
  attempt_number: number
  shooter_id: string
  keeper_id: string
  shooter_zone: string | null
  keeper_zone: string | null
  scored: boolean | null
  points: number | null
}

interface Member {
  profile_id: string
  pseudo: string
}

interface Props {
  groupId: string
  groupName: string
}

export default function PenaltyDuel({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [duels, setDuels] = useState<Duel[]>([]);
  const [members, setMembers] = useState<Member[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [shots, setShots] = useState<string[]>(['', '', ''])
  const [saves, setSaves] = useState<Record<string, string>>({})
  const [showChallenge, setShowChallenge] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: period } = await supabase
      .from('group_periods').select('id').eq('group_id', groupId).eq('is_current', true).maybeSingle()
    setPeriodId(period?.id ?? null)

    const { data: gm } = await supabase
      .from('group_members').select('profile_id').eq('group_id', groupId)
    const ids = (gm ?? []).map((m) => m.profile_id)
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
      const map = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
      setPseudos(map)
      setMembers(ids.filter((id) => id !== user.id).map((id) => ({ profile_id: id, pseudo: map[id] ?? '???' })))
    }

    const { data: d, error: dErr } = await supabase
      .from('penalty_duels').select('id, player_a_id, player_b_id, score_a, score_b, winner_id, finished_at')
      .eq('group_id', groupId).or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
    if (dErr) setError(dErr.message)
    setDuels(d ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const openDuel = async (id: string) => {
    setSelected(id)
    setShots(['', '', ''])
    setSaves({})
    const { data } = await supabase.from('penalty_duel_attempts').select('*').eq('duel_id', id)
    setAttempts((data ?? []) as Attempt[])
  }

  const challenge = async (opponentId: string) => {
    if (!user || !periodId) return
    setError(null)
    const { error: err } = await supabase.from('penalty_duels').insert({
      group_id: groupId, player_a_id: user.id, player_b_id: opponentId, period_id: periodId,
      phase: 'shooting', score_a: 0, score_b: 0,
    })
    if (err) setError(err.message)
    setShowChallenge(false)
    await loadList()
  }

  const submitShots = async () => {
    if (!user || !selected || shots.some((s) => !s)) return
    const opponent = duels.find((d) => d.id === selected)
    if (!opponent) return
    const keeperId = opponent.player_a_id === user.id ? opponent.player_b_id : opponent.player_a_id
    const rows = shots.map((zone, i) => ({
      duel_id: selected, phase_number: 1, attempt_number: i + 1,
      shooter_id: user.id, keeper_id: keeperId, shooter_zone: zone,
    }))
    const { error: err } = await supabase.from('penalty_duel_attempts').insert(rows)
    if (err) setError(err.message)
    await openDuel(selected)
  }

  const submitSaves = async () => {
    if (!user || !selected) return
    const toSave = attempts.filter((a) => a.keeper_id === user.id && a.shooter_zone && !a.keeper_zone)
    for (const a of toSave) {
      const guess = saves[a.id]
      if (!guess) continue
      const scored = guess !== a.shooter_zone
      await supabase.from('penalty_duel_attempts').update({
        keeper_zone: guess, scored, points: scored ? 1 : 0, resolved_at: new Date().toISOString(),
      }).eq('id', a.id)
    }
    await openDuel(selected)
    await maybeFinish(selected)
  }

  const maybeFinish = async (duelId: string) => {
    const { data } = await supabase.from('penalty_duel_attempts').select('*').eq('duel_id', duelId)
    const all = (data ?? []) as Attempt[]
    if (all.length < 6 || all.some((a) => !a.keeper_zone)) return
    const duel = duels.find((d) => d.id === duelId)
    if (!duel || duel.finished_at) return
    const scoreA = all.filter((a) => a.shooter_id === duel.player_a_id).reduce((s, a) => s + (a.points ?? 0), 0)
    const scoreB = all.filter((a) => a.shooter_id === duel.player_b_id).reduce((s, a) => s + (a.points ?? 0), 0)
    const winnerId = scoreA === scoreB ? null : scoreA > scoreB ? duel.player_a_id : duel.player_b_id
    await supabase.from('penalty_duels').update({
      score_a: scoreA, score_b: scoreB, winner_id: winnerId, phase: 'finished', finished_at: new Date().toISOString(),
    }).eq('id', duelId)
    await loadList()
  }

  if (selected) {
    const duel = duels.find((d) => d.id === selected)
    const myShots = attempts.filter((a) => a.shooter_id === user?.id)
    const iHaveShot = myShots.length > 0
    const toSave = attempts.filter((a) => a.keeper_id === user?.id && a.shooter_zone && !a.keeper_zone)
    const opponentId = duel && (duel.player_a_id === user?.id ? duel.player_b_id : duel.player_a_id)

    return (
      <div className="predictions-screen">
        <div className="predictions-header">
          <button className="predictions-back" onClick={() => setSelected(null)}>← Duels</button>
          <h2>vs {opponentId ? pseudos[opponentId] ?? '???' : '???'}</h2>
        </div>
        {error && <p className="groups-error">{error}</p>}

        {duel?.finished_at ? (
          <p className="match-result">Score final : {duel.score_a} - {duel.score_b}
            {duel.winner_id ? (duel.winner_id === user?.id ? ' — Tu as gagné !' : ' — Tu as perdu.') : ' — Match nul.'}</p>
        ) : (
          <>
            {!iHaveShot && (
              <div className="roulette-result">
                <p className="predictions-period">Choisis tes 3 tirs (l'adversaire ne les voit pas) :</p>
                {[0, 1, 2].map((i) => (
                  <div className="match-predict" key={i}>
                    <span>Tir {i + 1} :</span>
                    {ZONES.map((z) => (
                      <button
                        key={z}
                        className={"groups-action-btn groups-action-btn-secondary" + (shots[i] === z ? " group-nav-tab-active" : "")}
                        onClick={() => setShots((s) => s.map((v, idx) => (idx === i ? z : v)))}
                      >{z}</button>
                    ))}
                  </div>
                ))}
                <button className="match-save-btn" disabled={shots.some((s) => !s)} onClick={submitShots}>Valider mes tirs</button>
              </div>
            )}
            {iHaveShot && toSave.length > 0 && (
              <div className="roulette-result">
                <p className="predictions-period">Devine où l'adversaire a tiré (3 arrêts) :</p>
                {toSave.map((a) => (
                  <div className="match-predict" key={a.id}>
                    <span>Tir {a.attempt_number} :</span>
                    {ZONES.map((z) => (
                      <button
                        key={z}
                        className={"groups-action-btn groups-action-btn-secondary" + (saves[a.id] === z ? " group-nav-tab-active" : "")}
                        onClick={() => setSaves((s) => ({ ...s, [a.id]: z }))}
                      >{z}</button>
                    ))}
                  </div>
                ))}
                <button className="match-save-btn" onClick={submitSaves}>Valider mes arrêts</button>
              </div>
            )}
            {iHaveShot && toSave.length === 0 && (
              <p className="groups-empty">En attente de l'adversaire...</p>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Duel de penaltys — {groupName}</h2>
      </div>
      {error && <p className="groups-error">{error}</p>}
      <button className="groups-action-btn" onClick={() => setShowChallenge((v) => !v)}>+ Défier quelqu'un</button>

      {showChallenge && (
        <ul className="matches-list">
          {members.map((m) => (
            <li className="match-card roulette-teammate-card" key={m.profile_id} style={{ cursor: 'pointer' }} onClick={() => challenge(m.profile_id)}>
              <span>{m.pseudo}</span>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : duels.length === 0 ? (
        <p className="groups-empty">Aucun duel pour l'instant.</p>
      ) : (
        <ul className="matches-list">
          {duels.map((d) => {
            const opponentId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
            return (
              <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                <div className="match-teams">
                  <span>vs {pseudos[opponentId] ?? '???'}</span>
                </div>
                {d.finished_at ? (
                  <div className="match-result">Terminé : {d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">En cours</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
