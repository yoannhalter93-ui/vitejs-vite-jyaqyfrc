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

    // A tire en phase 1 (B garde), B tire en phase 2 (A garde) : les deux
    // moitiés existent dès la création du duel et avancent indépendamment,
    // pas besoin d'attendre son tour pour tirer ses propres penaltys.
    const myShooterPhase = isPlayerA ? 1 : 2
    const myKeeperPhase = isPlayerA ? 2 : 1

    const myShotAttempts = attempts.filter((a) => a.phase_number === myShooterPhase && a.shooter_id === user?.id)
    const myKeepAttempts = attempts.filter((a) => a.phase_number === myKeeperPhase && a.keeper_id === user?.id)

    const iHaveShot = myShotAttempts.length > 0 && myShotAttempts.every((a) => a.shot_taken)
    const opponentHasShot = myKeepAttempts.length > 0 && myKeepAttempts.every((a) => a.shot_taken)
    const iHaveFinishedKeeping = myKeepAttempts.length > 0 && myKeepAttempts.every((a) => a.resolved)

    const myTurnToShoot = !!duel && duel.phase !== 'done' && !iHaveShot
    const myTurnToSave = !!duel && duel.phase !== 'done' && opponentHasShot && !iHaveFinishedKeeping

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
            {myKeepAttempts.map((a) => (
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
