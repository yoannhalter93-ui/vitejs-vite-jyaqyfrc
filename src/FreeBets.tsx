import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Avatar from './Avatar'

// Aperçu en direct de la cote (mêmes calculs que close_expired_free_bets()
// côté base) : le camp majoritaire rapporte 1 point, le camp minoritaire
// jusqu'à 5 selon à quel point il est minoritaire. Tant qu'il n'y a aucun
// vote, la cote n'est pas encore calculable.
function computeLiveOdds(ouiCount: number, nonCount: number): { oui: number; non: number } | null {
  const total = ouiCount + nonCount
  if (total === 0) return null
  let oddsOui = Math.round(1 + ((100 - (ouiCount / total) * 100) / 100) * 4)
  let oddsNon = Math.round(1 + ((ouiCount / total) * 100 / 100) * 4)
  if (ouiCount > nonCount) oddsOui = 1
  else if (nonCount > ouiCount) oddsNon = 1
  return { oui: Math.max(1, oddsOui), non: Math.max(1, oddsNon) }
}

// Petite animation de comptage : à chaque changement de valeur (quelqu'un
// vote, la cote bouge), le chiffre défile jusqu'à la nouvelle valeur au lieu
// de sauter brutalement.
function AnimatedPoints({ value }: { value: number }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) { setDisplay(to); return }
    const start = performance.now()
    const duration = 420
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <span className="bet-odds-value">{display}</span>
}

interface Bet {
  id: string
  text: string
  deadline: string
  status: string
  validation_mode: string
  validator_id: string | null
  actual_result: string | null
  author_id: string | null
}

interface Reveal {
  profile_id: string
  pseudo: string
  side: string
}

interface Voter {
  profile_id: string
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

// Un des groupes (ligues) du joueur, pour le sélecteur "publier dans" —
// permet à quelqu'un qui a plusieurs groupes de proposer le même pari
// simultanément dans plusieurs d'entre eux plutôt que de le recréer à la
// main dans chacun.
interface GroupOption {
  id: string
  name: string
}

interface Props {
  groupId: string
  groupName: string
  onBonusUsed?: () => void
  onVoteOrCreate?: () => void
}

// Libellé + couleur du badge de statut affiché sur chaque carte de pari
// (voir maquette envoyée par Yoann) — un badge par valeur possible de
// free_bets.status (voir close_expired_free_bets / try_resolve_free_bet /
// resolve_contested_bet côté base pour le cycle de vie complet).
const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: 'Ouvert', className: 'bet-status-open' },
  closed: { label: 'En attente', className: 'bet-status-pending' },
  contested: { label: 'En litige', className: 'bet-status-contested' },
  resolved: { label: 'Résolu', className: 'bet-status-resolved' },
  voided: { label: 'Annulé', className: 'bet-status-voided' },
}

export default function FreeBets({ groupId, groupName, onBonusUsed, onVoteOrCreate }: Props) {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [bets, setBets] = useState<Bet[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [myVotes, setMyVotes] = useState<Record<string, string>>({})
  const [myBoosts, setMyBoosts] = useState<Record<string, boolean>>({})
  const [voteCounts, setVoteCounts] = useState<Record<string, { oui: number; non: number }>>({})
  // qui a voté (sans dire quoi) sur les paris encore ouverts, pour montrer
  // la participation sans influencer les votes en cours — le détail
  // oui/non par personne reste réservé aux paris verrouillés (voir reveal)
  const [voters, setVoters] = useState<Record<string, Voter[]>>({})
  // confirmations du résultat (après échéance) : ce que MOI j'ai confirmé
  // pour chaque pari, et le décompte de tout le monde pour les paris en
  // mode "majorité" — avant ce correctif, rien n'indiquait qu'un clic sur
  // Oui/Non avait bien été pris en compte, ni combien de confirmations
  // manquaient encore, donc ça semblait ne "rien faire"
  const [myConfirmations, setMyConfirmations] = useState<Record<string, string>>({})
  const [confirmCounts, setConfirmCounts] = useState<Record<string, { oui: number; non: number }>>({})
  const [groupSize, setGroupSize] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [text, setText] = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // tous les groupes du joueur (pas seulement celui-ci), pour proposer un
  // même pari dans plusieurs ligues à la fois — pré-coché sur le groupe
  // actuellement affiché seulement, le reste est un ajout volontaire
  const [myGroups, setMyGroups] = useState<GroupOption[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([groupId])

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
    setIsOwner(mem?.role === 'owner')

    // tous les groupes où je suis membre, pour le sélecteur "publier dans"
    const { data: mships } = await supabase
      .from('group_members').select('groups(id, name)').eq('profile_id', user.id)
    setMyGroups(
      ((mships ?? []) as unknown as { groups: GroupOption | null }[])
        .map((m) => m.groups)
        .filter((g): g is GroupOption => g !== null)
    )

    // pseudos des membres du groupe, pour afficher qui a proposé chaque pari
    const { data: gm } = await supabase.from('group_members').select('profile_id').eq('group_id', groupId)
    const memberIds = (gm ?? []).map((m) => m.profile_id)
    setGroupSize(memberIds.length)
    if (memberIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', memberIds)
      setPseudos(Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo])))
    }

    const { data: b, error: bErr } = await supabase
      .from('free_bets').select('id, text, deadline, status, validation_mode, validator_id, actual_result, author_id')
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

      // liste des votants (sans le côté), avec avatar, pour tous les paris
      // du groupe — affichée en rangée d'avatars sur les paris en cours
      const { data: votersRows } = await supabase.rpc('get_free_bet_voters', { p_group_id: groupId })
      const votersMap: Record<string, Voter[]> = {}
      for (const v of (votersRows ?? []) as any[]) {
        if (!votersMap[v.bet_id]) votersMap[v.bet_id] = []
        votersMap[v.bet_id].push({ profile_id: v.profile_id, pseudo: v.pseudo, avatar_url: v.avatar_url, avatar_emoji: v.avatar_emoji })
      }
      setVoters(votersMap)

      // mon propre vote reste toujours lisible, peu importe le statut
      const { data: mineRows } = await supabase.from('free_bet_votes').select('bet_id, side').eq('profile_id', user.id).in('bet_id', ids)
      const mine: Record<string, string> = {}
      for (const v of mineRows ?? []) mine[v.bet_id] = v.side
      setMyVotes(mine)

      const { data: boosts } = await supabase.from('free_bet_boosts').select('bet_id').eq('profile_id', user.id).in('bet_id', ids)
      const boostSet: Record<string, boolean> = {}
      for (const bo of boosts ?? []) boostSet[bo.bet_id] = true
      setMyBoosts(boostSet)

      // qui a confirmé quoi (après échéance) — visible pour tout membre du
      // groupe, sert à afficher "tu as confirmé : ..." et le décompte en
      // mode majorité au lieu de laisser les boutons Oui/Non sans retour
      const { data: allResolutions } = await supabase.from('free_bet_resolutions').select('bet_id, profile_id, confirmed_side').in('bet_id', ids)
      const confirmCountsMap: Record<string, { oui: number; non: number }> = {}
      const myConfirmMap: Record<string, string> = {}
      for (const r of allResolutions ?? []) {
        const c = confirmCountsMap[r.bet_id] ?? { oui: 0, non: 0 }
        if (r.confirmed_side === 'oui') c.oui++
        else if (r.confirmed_side === 'non') c.non++
        confirmCountsMap[r.bet_id] = c
        if (r.profile_id === user.id) myConfirmMap[r.bet_id] = r.confirmed_side
      }
      setConfirmCounts(confirmCountsMap)
      setMyConfirmations(myConfirmMap)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  // repart d'une sélection propre (juste le groupe affiché) à chaque
  // changement de groupe, pour ne jamais laisser une sélection d'un ancien
  // groupe traîner par erreur
  useEffect(() => {
    setSelectedGroupIds([groupId])
  }, [groupId])

  const toggleGroupSelection = (gid: string) => {
    setSelectedGroupIds((prev) => (prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid]))
  }

  const createBet = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !text.trim() || !deadline) return
    setError(null)
    const targetGroupIds = selectedGroupIds.length > 0 ? selectedGroupIds : [groupId]

    // un même pari peut être publié dans plusieurs groupes (ligues) d'un
    // coup pour ceux qui en ont plusieurs — chaque groupe reçoit sa PROPRE
    // copie indépendante (ses propres votes/sa propre validation), liée à
    // LA période en cours de CE groupe (pas forcément celle du groupe
    // actuellement affiché)
    const { data: periods } = await supabase
      .from('group_periods').select('group_id, id').in('group_id', targetGroupIds).eq('is_current', true)
    const periodByGroup: Record<string, string> = {}
    for (const p of periods ?? []) periodByGroup[p.group_id] = p.id

    // celui qui propose le pari est seul responsable d'en confirmer le
    // résultat une fois l'échéance passée ("mode confiance") — en cas de
    // litige ou d'absence de confirmation, un owner/admin du groupe peut
    // trancher (voir resolveContested)
    const rows = targetGroupIds
      .filter((gid) => periodByGroup[gid])
      .map((gid) => ({
        group_id: gid, author_id: user.id, text: text.trim(),
        deadline: new Date(deadline).toISOString(), validation_mode: 'confiance', validator_id: user.id,
        status: 'open', period_id: periodByGroup[gid],
      }))

    if (rows.length === 0) {
      setError("Aucune période en cours dans le(s) groupe(s) sélectionné(s).")
      return
    }

    const { error: err } = await supabase.from('free_bets').insert(rows)
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
    // RPC plutôt qu'un insert direct : elle fait un upsert, donc voter à
    // nouveau change simplement le choix précédent (permet de changer
    // d'avis librement tant que le pari est ouvert, jusqu'à l'échéance)
    const { error: err } = await supabase.rpc('cast_free_bet_vote', { p_bet_id: betId, p_side: side })
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
    // déjà confirmé par moi (ex: double-clic, ou re-render entre deux
    // clics) : on ne retente pas l'insert, qui échouerait silencieusement
    // sur la contrainte (bet_id, profile_id) et donnait l'impression que
    // le clic "ne faisait rien"
    if (!user || myConfirmations[betId]) return
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
    // on peut voter — et changer d'avis — tant que le pari est ouvert et que
    // l'échéance n'est pas passée, plus seulement au tout premier vote
    const canVote = b.status === 'open' && new Date() < new Date(b.deadline)
    const liveOdds = computeLiveOdds(counts.oui, counts.non)
    const reveal = reveals[b.id]
    const status = STATUS_META[b.status] ?? { label: b.status, className: 'bet-status-open' }
    const voterList = voters[b.id] ?? []
    return (
      <li className="bet-card" key={b.id}>
        <div className="bet-card-top">
          <span className="bet-card-kicker">🎲 Pari libre</span>
          <span className={'bet-status-pill ' + status.className}>
            <span className="bet-status-dot" />
            {status.label}
          </span>
        </div>

        <h3 className="bet-card-text">{b.text}</h3>

        <div className="bet-card-meta">
          <span className="bet-card-meta-item">👤 Proposé par {b.author_id ? (pseudos[b.author_id] ?? '???') : '???'}</span>
          <span className="bet-card-meta-item">📅 Échéance : {new Date(b.deadline).toLocaleString('fr-FR')}</span>
        </div>

        <div className="bet-votes-box">
          <span className="bet-votes-box-icon">👥</span>
          <span className="bet-votes-box-label">Votes actuels</span>
          <strong className="bet-votes-box-count">{counts.oui} oui / {counts.non} non</strong>
          {myVotes[b.id] && <span className="bet-votes-box-mine">(toi : {myVotes[b.id]})</span>}
        </div>

        {!locked && (
          <div className="bet-voters">
            <span className="bet-voters-label">👥 Ont voté ({voterList.length})</span>
            {voterList.length === 0 ? (
              <p className="bet-voters-empty">Personne n'a encore voté</p>
            ) : (
              <div className="bet-voters-row">
                {voterList.map((v) => (
                  <div className="bet-voter" key={v.profile_id}>
                    <Avatar pseudo={v.pseudo} avatarUrl={v.avatar_url} avatarEmoji={v.avatar_emoji} size={44} />
                    <span className="bet-voter-name">{v.pseudo}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {myVotes[b.id] && (b.status === 'open' || b.status === 'closed') && !myBoosts[b.id] && (
          <button className="bet-boost-btn" onClick={() => boostBet(b.id)}>🪙 Doubler (2 jetons)</button>
        )}
        {myBoosts[b.id] && <div className="bet-boosted-tag">Boosté : double ou rien 🪙</div>}

        {canVote && (
          <div className="bet-vote-block">
            <div className="bet-vote-options">
              {(['oui', 'non'] as const).map((side) => {
                const pts = liveOdds ? liveOdds[side] : null
                const active = myVotes[b.id] === side
                return (
                  <button
                    key={side}
                    type="button"
                    className={'bet-vote-btn bet-vote-btn-' + side + (active ? ' bet-vote-btn-active' : '')}
                    onClick={() => vote(b.id, side)}
                  >
                    {active && <span className="bet-vote-check">✓</span>}
                    <span className="bet-vote-label">{side === 'oui' ? 'Oui' : 'Non'}</span>
                    <span className="bet-vote-pts">
                      {pts !== null ? <>+<AnimatedPoints value={pts} /> pts</> : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="bet-vote-hint">
              <span className="bet-vote-hint-icon">ⓘ</span>
              {myVotes[b.id]
                ? "Tu peux changer d'avis jusqu'à l'échéance"
                : liveOdds
                  ? 'La cote évolue selon les votes des autres'
                  : 'La cote apparaît dès le premier pari'}
            </div>
          </div>
        )}
        {b.status === 'closed' && (
          // en mode "confiance" : l'auteur du pari OU le créateur du groupe
          // peuvent confirmer, un seul suffit (peu importe qui des deux le
          // fait en premier) — en mode "majorité" (anciens paris), tout le
          // monde peut voter et il faut une majorité des membres du groupe
          b.validation_mode === 'confiance' && user?.id !== b.validator_id && !isOwner ? (
            <div className="match-cancelled">En attente de la confirmation de l'auteur du pari ou du créateur du groupe</div>
          ) : myConfirmations[b.id] ? (
            <div className="match-cancelled">
              Tu as confirmé : {myConfirmations[b.id]}
              {b.validation_mode === 'majorite' &&
                ` — en attente des autres membres (${confirmCounts[b.id]?.oui ?? 0} oui / ${confirmCounts[b.id]?.non ?? 0} non sur ${groupSize} membres)`}
            </div>
          ) : (
            <div className="match-predict">
              <span>Confirmer le résultat :</span>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'oui')}>Oui</button>
              <button className="groups-action-btn groups-action-btn-secondary" onClick={() => confirmResult(b.id, 'non')}>Non</button>
              {b.validation_mode === 'majorite' && (
                <span className="match-my-pred">
                  ({confirmCounts[b.id]?.oui ?? 0} oui / {confirmCounts[b.id]?.non ?? 0} non confirmés)
                </span>
              )}
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
      <div className="bet-hero">
        <span className="bet-hero-eyebrow">Paris libres · {groupName}</span>
        <h2 className="bet-hero-title">Les paris entre potes</h2>
        <p className="bet-hero-subtitle">Petits paris, grands débats</p>
      </div>

      {error && <p className="groups-error">{error}</p>}
      {revealError && <p className="groups-error">{revealError}</p>}

      <button className="groups-action-btn" onClick={() => setShowCreate((v) => !v)}>+ Proposer un pari</button>

      {showCreate && (
        <form className="groups-form" onSubmit={createBet}>
          <input className="groups-input" placeholder="Ex: Mbappé marque ce week-end" value={text} onChange={(e) => setText(e.target.value)} required />
          <input className="groups-input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
          {myGroups.length > 1 && (
            <div className="bet-groups-picker">
              <span className="bet-groups-picker-label">Publier ce pari dans :</span>
              <div className="bet-groups-picker-list">
                {myGroups.map((g) => (
                  <label className="bet-groups-picker-item" key={g.id}>
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(g.id)}
                      onChange={() => toggleGroupSelection(g.id)}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          )}
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
          <ul className="matches-list bet-list">{openBets.map((b) => renderBet(b, false))}</ul>
        )
      ) : lockedBets.length === 0 ? (
        <p className="groups-empty">Aucun pari verrouillé pour l'instant.</p>
      ) : (
        <ul className="matches-list bet-list">{lockedBets.map((b) => renderBet(b, true))}</ul>
      )}
    </div>
  )
}
