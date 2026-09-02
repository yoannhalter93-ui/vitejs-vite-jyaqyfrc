import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Bet {
  id: string
  text: string
  deadline: string
  status: string
  validation_mode: string
  validator_id: string | null
  actual_result: string | null
}

interface Props {
  groupId: string
  groupName: string
  onBonusUsed?: () => void
}

export default function FreeBets({ groupId, groupName, onBonusUsed }: Props) {
  const { user } = useAuth()
  const [isOwner, setIsOwner] = useState(false)
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [bets, setBets] = useState<Bet[]>([])
  const [myVotes, setMyVotes] = useState<Record<string, string>>({})
  const [myBoosts, setMyBoosts] = useState<Record<string, boolean>>({})
  const [voteCounts, setVoteCounts] = useState<Record<string, { oui: number; non: number }>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [text, setText] = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: mem } = await supabase.from('group_members').select('role').eq('group_id', groupId).eq('profile_id', user.id).maybeSingle()
    setIsOwner(mem?.role === 'owner')

    const { data: period } = await supabase.from('group_periods').select('id').eq('group_id', groupId).eq('is_current', true).maybeSingle()
    setPeriodId(period?.id ?? null)

    const { data: b, error: bErr } = await supabase
      .from('free_bets').select('id, text, deadline, status, validation_mode, validator_id, actual_result')
      .eq('group_id', groupId).order('created_at', { ascending: false })
    if (bErr) {
      setError(bErr.message)
      setLoading(false)
      return
    }
    setBets(b ?? [])

    const ids = (b ?? []).map((x) => x.id)
    if (ids.length > 0) {
      const { data: votes } = await supabase.from('free_bet_votes').select('bet_id, profile_id, side').in('bet_id', ids)
      const mine: Record<string, string> = {}
      const counts: Record<string, { oui: number; non: number }> = {}
      for (const v of votes ?? []) {
        counts[v.bet_id] = counts[v.bet_id] ?? { oui: 0, non: 0 }
        if (v.side === 'oui') counts[v.bet_id].oui++
        else counts[v.bet_id].non++
        if (v.profile_id === user.id) mine[v.bet_id] = v.side
      }
      setMyVotes(mine)
      setVoteCounts(counts)

      const { data: boosts } = await supabase.from('free_bet_boosts').select('bet_id').eq('profile_id', user.id).in('bet_id', ids)
      const boostSet: Record<string, boolean> = {}
      for (const bo of boosts ?? []) boostSet[bo.bet_id] = true
      setMyBoosts(boostSet)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const createBet = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !periodId || !text.trim() || !deadline) return
    setError(null)
    const { error: err } = await supabase.from('free_bets').insert({
      group_id: groupId, author_id: user.id, text: text.trim(),
      deadline: new Date(deadline).toISOString(), validation_mode: 'majorite', status: 'open', period_id: periodId,
    })
    if (err) setError(err.message)
    setText('')
    setDeadline('')
    setShowCreate(false)
    await load()
  }

  const vote = async (betId: string, side: string) => {
    if (!user) return
    setError(null)
    const { error: err } = await supabase.from('free_bet_votes').insert({ bet_id: betId, profile_id: user.id, side })
    if (err) setError(err.message)
    await load()
  }

  const boostBet = async (betId: string) => {
    if (!user) return
    setError(null)
    const { error: err } = await supabase.rpc('use_bonus_double_ou_rien', { p_bet_id: betId })
    if (err) { setError(err.message); return }
    await load()
    onBonusUsed?.()
  }

  const confirmResult = async (betId: string, side: string) => {
    if (!user) return
    setError(null)
    const { error: err } = await supabase.from('free_bet_resolutions').insert({ bet_id: betId, profile_id: user.id, confirmed_side: side })
    if (err) setError(err.message)
    await load()
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Paris libres — {groupName}</h2>
      </div>
      {error && <p className="groups-error">{error}</p>}

      {isOwner && (
        <button className="groups-action-btn" onClick={() => setShowCreate((v) => !v)}>+ Proposer un pari</button>
      )}

      {showCreate && (
        <form className="groups-form" onSubmit={createBet}>
          <input className="groups-input" placeholder="Ex: Mbappé marque ce week-end" value={text} onChange={(e) => setText(e.target.value)} required />
          <input className="groups-input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
          <button className="groups-submit" type="submit">Publier</button>
        </form>
      )}

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : bets.length === 0 ? (
        <p className="groups-empty">Aucun pari pour l'instant.</p>
      ) : (
        <ul className="matches-list">
          {bets.map((b) => {
            const counts = voteCounts[b.id] ?? { oui: 0, non: 0 }
            const canVote = b.status === 'open' && new Date() < new Date(b.deadline) && !myVotes[b.id]
            return (
              <li className="match-card" key={b.id}>
                <div className="match-teams">{b.text}</div>
                <div className="match-kickoff">Échéance : {new Date(b.deadline).toLocaleString('fr-FR')} — statut : {b.status}</div>
                <div className="match-my-pred">Votes : {counts.oui} oui / {counts.non} non {myVotes[b.id] ? `(toi : ${myVotes[b.id]})` : ''}</div>
                {myVotes[b.id] && (b.status === 'open' || b.status === 'closed') && !myBoosts[b.id] && (
                  <button className="groups-action-btn groups-action-btn-secondary bet-boost-btn" onClick={() => boostBet(b.id)}>Doubler (2 jetons)</button>
                )}
                {myBoosts[b.id] && <div className="bet-boosted-tag">Boosté : double ou rien 🪙</div>}
                {canVote && (
                  <div className="match-predict">
                    <button className="groups-action-btn groups-action-btn-secondary" onClick={() => vote(b.id, 'oui')}>Oui</button>
                    <button className="groups-action-btn groups-action-btn-secondary" onClick={() => vote(b.id, 'non')}>Non</button>
                  </div>
                )}
                {b.status === 'closed' && (
                  <div className="match-predict">
                    <span>Confirmer le résultat :</span>
                    <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'oui')}>Oui</button>
                    <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'non')}>Non</button>
                  </div>
                )}
                {b.actual_result && <div className="match-result">Résultat : {b.actual_result}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
