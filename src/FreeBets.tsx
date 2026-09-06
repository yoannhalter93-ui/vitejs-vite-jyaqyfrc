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

interface Reveal {
  profile_id: string
  pseudo: string
  side: string
}

interface Props {
  groupId: string
  groupName: string
  onBonusUsed?: () => void
  onVoteOrCreate?: () => void
}

export default function FreeBets({ groupId, groupName, onBonusUsed, onVoteOrCreate }: Props) {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
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

  // "En cours" = paris encore ouverts, votables. "Historique" = paris
  // verrouillés (échéance passée) : plus votable, mais on peut y voir qui a
  // voté quoi — jamais avant, pour ne pas influencer les votes en cours.
  const [tab, setTab] = useState<'ouverts' | 'historique'>('ouverts')
  const [reveals, setReveals] = useState<Record<string, Reveal[]>>({})
  const [revealLoading, setRevealLoading] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: mem } = await supabase.from('group_members').select('role').eq('group_id', groupId).eq('profile_id', user.id).maybeSingle()
    setIsAdmin(mem?.role === 'owner' || mem?.role === 'admin')

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
      // le compte oui/non est calculé côté serveur (RPC) pour rester
      // disponible même sur un pari encore ouvert, sans jamais exposer qui
      // a voté quoi tant qu'il n'est pas verrouillé
      const { data: counts } = await supabase.rpc('get_free_bet_vote_counts', { p_group_id: groupId })
      const countsMap: Record<string, { oui: number; non: number }> = {}
      for (const c of (counts ?? []) as any[]) {
        countsMap[c.bet_id] = { oui: c.oui_count, non: c.non_count }
      }
      setVoteCounts(countsMap)

      // mon propre vote reste toujours lisible, peu importe le statut
      const { data: mineRows } = await supabase.from('free_bet_votes').select('bet_id, side').eq('profile_id', user.id).in('bet_id', ids)
      const mine: Record<string, string> = {}
      for (const v of mineRows ?? []) mine[v.bet_id] = v.side
      setMyVotes(mine)

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
    // celui qui propose le pari est seul responsable d'en confirmer le
    // résultat une fois l'échéance passée ("mode confiance") — en cas de
    // litige ou d'absence de confirmation, un owner/admin du groupe peut
    // trancher (voir resolveContested)
    const { error: err } = await supabase.from('free_bets').insert({
      group_id: groupId, author_id: user.id, text: text.trim(),
      deadline: new Date(deadline).toISOString(), validation_mode: 'confiance', validator_id: user.id,
      status: 'open', period_id: periodId,
    })
    if (err) setError(err.message)
    setText('')
    setDeadline('')
    setShowCreate(false)
    await load()
    onVoteOrCreate?.()
  }

  const vote = async (betId: string, side: string) => {
    if (!user) return
    setError(null)
    const { error: err } = await supabase.from('free_bet_votes').insert({ bet_id: betId, profile_id: user.id, side })
    if (err) setError(err.message)
    await load()
    onVoteOrCreate?.()
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

  // un pari passe en litige si personne n'a confirmé à temps (ou, pour les
  // anciens paris en mode "majorité", en cas d'égalité) — seul un owner/admin
  // du groupe peut alors trancher définitivement
  const resolveContested = async (betId: string, side: string) => {
    if (!user) return
    setError(null)
    const { error: err } = await supabase.rpc('resolve_contested_bet', { p_bet_id: betId, p_winning_side: side })
    if (err) setError(err.message)
    await load()
  }

  const toggleReveal = async (betId: string) => {
    if (reveals[betId]) {
      // déjà chargé : on referme simplement en le retirant
      setReveals((prev) => {
        const next = { ...prev }
        delete next[betId]
        return next
      })
      return
    }
    setRevealLoading(betId)
    setRevealError(null)
    const { data, error: err } = await supabase.rpc('get_free_bet_reveal', { p_bet_id: betId })
    if (err) setRevealError(err.message)
    setReveals((prev) => ({ ...prev, [betId]: (data ?? []) as Reveal[] }))
    setRevealLoading(null)
  }

  const openBets = bets.filter((b) => b.status === 'open')
  const lockedBets = bets.filter((b) => b.status !== 'open')

  const renderBet = (b: Bet, locked: boolean) => {
    const counts = voteCounts[b.id] ?? { oui: 0, non: 0 }
    const canVote = b.status === 'open' && new Date() < new Date(b.deadline) && !myVotes[b.id]
    const reveal = reveals[b.id]
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
          b.validation_mode === 'confiance' && user?.id !== b.validator_id ? (
            <div className="match-cancelled">En attente de la confirmation de l'auteur du pari</div>
          ) : (
            <div className="match-predict">
              <span>Confirmer le résultat :</span>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'oui')}>Oui</button>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'non')}>Non</button>
            </div>
          )
        )}
        {b.status === 'contested' && (
          isAdmin ? (
            <div className="match-predict">
              <span>Pari en litige — trancher :</span>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => resolveContested(b.id, 'oui')}>Oui</button>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => resolveContested(b.id, 'non')}>Non</button>
            </div>
          ) : (
            <div className="match-cancelled">Pari en litige — en attente de la décision d'un admin du groupe</div>
          )
        )}
        {b.actual_result && <div className="match-result">Résultat : {b.actual_result}</div>}
        {locked && (
          <>
            <button className="groups-action-btn groups-action-btn-secondary bet-reveal-btn" disabled={revealLoading === b.id} onClick={() => toggleReveal(b.id)}>
              {revealLoading === b.id ? '...' : reveal ? 'Masquer les votes' : 'Voir qui a voté quoi'}
            </button>
            {reveal && (
              <ul className="bet-reveal-list">
                {reveal.length === 0 ? (
                  <li className="groups-empty">Personne n'a voté.</li>
                ) : (
                  reveal.map((r) => (
                    <li key={r.profile_id} className={"bet-reveal-row" + (r.side === 'oui' ? ' bet-reveal-oui' : ' bet-reveal-non')}>
                      {r.pseudo} — {r.side}
                    </li>
                  ))
                )}
              </ul>
            )}
          </>
        )}
      </li>
    )
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Paris libres — {groupName}</h2>
      </div>
      {error && <p className="groups-error">{error}</p>}
      {revealError && <p className="groups-error">{revealError}</p>}

      <button className="groups-action-btn" onClick={() => setShowCreate((v) => !v)}>+ Proposer un pari</button>

      {showCreate && (
        <form className="groups-form" onSubmit={createBet}>
          <input className="groups-input" placeholder="Ex: Mbappé marque ce week-end" value={text} onChange={(e) => setText(e.target.value)} required />
          <input className="groups-input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
          <button className="groups-submit" type="submit">Publier</button>
        </form>
      )}

      <div className="group-nav-tabs bet-tabs">
        <button className={"group-nav-tab" + (tab === 'ouverts' ? ' group-nav-tab-active' : '')} onClick={() => setTab('ouverts')}>
          En cours{openBets.length > 0 ? ` (${openBets.length})` : ''}
        </button>
        <button className={"group-nav-tab" + (tab === 'historique' ? ' group-nav-tab-active' : '')} onClick={() => setTab('historique')}>
          Historique
        </button>
      </div>

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : tab === 'ouverts' ? (
        openBets.length === 0 ? (
          <p className="groups-empty">Aucun pari en cours pour l'instant.</p>
        ) : (
          <ul className="matches-list">{openBets.map((b) => renderBet(b, false))}</ul>
        )
      ) : lockedBets.length === 0 ? (
        <p className="groups-empty">Aucun pari verrouillé pour l'instant.</p>
      ) : (
        <ul className="matches-list">{lockedBets.map((b) => renderBet(b, true))}</ul>
      )}
    </div>
  )
}
