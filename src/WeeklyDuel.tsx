import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import LoadingSkeleton from './LoadingSkeleton'

interface Duel {
  id: string
  player_a_id: string
  player_b_id: string | null
  status: string
  score_a: number | null
  score_b: number | null
  week_start: string
}

interface CurrentQuestion {
  order: number
  question: string
  options: string[]
}

interface ReviewRow {
  question_order: number
  question: string
  options: string[]
  correct_index: number
  my_index: number
  opp_index: number | null
}

interface Props {
  groupId: string
  groupName: string
}

export default function WeeklyDuel({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [duels, setDuels] = useState<Duel[]>([])
  const [allDuels, setAllDuels] = useState<Duel[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [duel, setDuel] = useState<Duel | null>(null)
  const [oppAnswered, setOppAnswered] = useState(0)
  const [question, setQuestion] = useState<CurrentQuestion | null>(null)
  const [timeLeft, setTimeLeft] = useState(10)
  const [answering, setAnswering] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewRow[] | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [revancheBusy, setRevancheBusy] = useState(false)
  // le week_start le plus récent pour ce groupe : sert à savoir si le duel
  // actuellement ouvert est bien celui de la semaine en cours, seul cas où
  // le bonus Revanche est proposé (même convention que côté serveur dans
  // use_bonus_revanche_quiz)
  const [latestWeekStart, setLatestWeekStart] = useState<string | null>(null)
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [answerCounts, setAnswerCounts] = useState<{ duel_id: string; profile_id: string; answered_count: number }[]>([])

  const loadList = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: gm } = await supabase.from('group_members').select('profile_id').eq('group_id', groupId)
    const ids = (gm ?? []).map((m) => m.profile_id)
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
      setPseudos(Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo])))
    }

    const { data: d, error: dErr } = await supabase
      .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b, week_start')
      .eq('group_id', groupId).or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
    if (dErr) setError(dErr.message)
    setDuels(d ?? [])

    // tous les duels du groupe pour la semaine en cours (qui affronte qui,
    // et où ils en sont), pas seulement les miens
    const { data: latest } = await supabase
      .from('weekly_duels').select('week_start')
      .eq('group_id', groupId).order('week_start', { ascending: false }).limit(1).maybeSingle()
    setLatestWeekStart(latest?.week_start ?? null)
    let all: Duel[] = []
    if (latest?.week_start) {
      const { data: allData } = await supabase
        .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b, week_start')
        .eq('group_id', groupId).eq('week_start', latest.week_start)
        .order('created_at', { ascending: true })
      all = allData ?? []
      setAllDuels(all)
    } else {
      setAllDuels([])
    }

    // duels en cours (ni terminés, ni en attente d'adversaire) : on va
    // chercher qui a déjà commencé à répondre, pour afficher un statut
    // précis plutôt qu'un simple "En cours" générique
    const inProgressIds = [...new Set([...(d ?? []), ...all]
      .filter((x) => x.status !== 'done' && x.status !== 'waiting_opponent')
      .map((x) => x.id))]
    if (inProgressIds.length > 0) {
      const { data: counts } = await supabase.rpc('get_duel_answer_counts', { p_duel_ids: inProgressIds })
      setAnswerCounts((counts ?? []) as { duel_id: string; profile_id: string; answered_count: number }[])
    } else {
      setAnswerCounts([])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const hasPlayed = (duelId: string, profileId: string) =>
    answerCounts.some((a) => a.duel_id === duelId && a.profile_id === profileId && a.answered_count > 0)

  const myDuelStatusLabel = (d: Duel) => {
    if (d.status === 'waiting_opponent') return "⏳ En attente d'un adversaire"
    const oppId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
    const oppName = oppId ? (pseudos[oppId] ?? '???') : '???'
    const meP = user ? hasPlayed(d.id, user.id) : false
    const oppP = oppId ? hasPlayed(d.id, oppId) : false
    if (meP && oppP) return 'En cours'
    if (meP) return `Tu as commencé, en attente de ${oppName}`
    if (oppP) return `${oppName} a commencé, à toi de jouer !`
    return "Personne n'a encore commencé"
  }

  const weekDuelStatusLabel = (d: Duel) => {
    if (d.status === 'done') return `${d.score_a} - ${d.score_b}`
    if (d.status === 'waiting_opponent') return "En attente d'un adversaire"
    const aName = pseudos[d.player_a_id] ?? '???'
    const bName = d.player_b_id ? (pseudos[d.player_b_id] ?? '???') : 'en attente…'
    const aP = hasPlayed(d.id, d.player_a_id)
    const bP = d.player_b_id ? hasPlayed(d.id, d.player_b_id) : false
    if (aP && bP) return 'En cours'
    if (aP) return `${aName} a commencé, en attente de ${bName}`
    if (bP) return `${bName} a commencé, en attente de ${aName}`
    return "Personne n'a encore commencé"
  }

  const loadNextQuestion = async (id: string, order: number) => {
    const { data, error: err } = await supabase
      .rpc('request_duel_question', { p_duel_id: id, p_order: order })
      .single()
    if (err || !data) {
      setError(err?.message ?? 'Erreur')
      setQuestion(null)
      return
    }
    // le serveur renvoie le temps RÉELLEMENT restant (pas toujours 10) :
    // si on avait quitté l'appli pendant cette question et qu'on y revient
    // après le délai, il renvoie 0, ce qui déclenche l'auto-passage
    // immédiat à la question suivante au lieu d'un faux compte à rebours
    // flambant neuf
    const q = data as { question: string; options: string[]; seconds_left: number }
    setQuestion({ order, question: q.question, options: q.options })
    setTimeLeft(q.seconds_left ?? 10)
  }

  const refresh = async (id: string) => {
    const { data: d } = await supabase
      .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b, week_start')
      .eq('id', id).maybeSingle()
    setDuel((d as Duel) ?? null)

    const { data: ans } = await supabase.from('duel_answers').select('profile_id').eq('duel_id', id)
    const mine = (ans ?? []).filter((a) => a.profile_id === user?.id).length
    setOppAnswered((ans ?? []).length - mine)

    if (d && d.status !== 'done' && d.status !== 'waiting_opponent' && mine < 10) {
      await loadNextQuestion(id, mine + 1)
    } else {
      setQuestion(null)
    }
  }

  const openDuel = async (id: string) => {
    setSelected(id)
    setError(null)
    setQuestion(null)
    setReview(null)
    await refresh(id)
  }

  // Bonus "Revanche" (5 jetons, 1x/semaine/joueur) : remet ce duel entier à
  // zéro pour les 2 joueurs avec de nouvelles questions, comme s'il n'avait
  // jamais eu lieu — n'apparaît que si je n'ai pas gagné (perdu ou match
  // nul) ET que le duel ouvert est celui de la semaine en cours (pas un
  // ancien duel), mêmes conditions que côté serveur dans use_bonus_revanche_quiz.
  const useRevanche = async () => {
    if (!selected || revancheBusy) return
    setRevancheBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('use_bonus_revanche_quiz', { p_duel_id: selected })
    setRevancheBusy(false)
    if (err) { setError(err.message); return }
    setReview(null)
    await openDuel(selected)
    await loadList()
  }

  const loadReview = async () => {
    if (!selected) return
    setReviewLoading(true)
    const { data, error: err } = await supabase.rpc('get_duel_review', { p_duel_id: selected })
    if (err) setError(err.message)
    setReview((data ?? []) as ReviewRow[])
    setReviewLoading(false)
  }

  const answer = async (order: number, index: number) => {
    if (!selected || answering) return
    setAnswering(true)
    setQuestion(null)
    const { error: err } = await supabase.rpc('submit_duel_answer', {
      p_duel_id: selected, p_question_order: order, p_answered_index: index,
    })
    if (err) setError(err.message)
    setAnswering(false)
    await refresh(selected)
    await loadList()
  }

  useEffect(() => {
    if (!question) return
    if (timeLeft <= 0) {
      answer(question.order, 0)
      return
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, timeLeft])

  if (selected) {
    const opponentId = duel && (duel.player_a_id === user?.id ? duel.player_b_id : duel.player_a_id)

    return (
      <div className="predictions-screen">
        <div className="predictions-header">
          <button className="predictions-back" onClick={() => setSelected(null)}>← Duels</button>
          <h2>{duel?.status === 'waiting_opponent' ? '🎲 Duel de la semaine' : `vs ${opponentId ? pseudos[opponentId] ?? '???' : '???'}`}</h2>
        </div>
        {error && <p className="groups-error">{error}</p>}

        {duel?.status === 'waiting_opponent' ? (
          <div className="roulette-result">
            <p className="quiz-question-live">En attente d'un adversaire…</p>
            <p className="predictions-period">Dès qu'un nouveau joueur rejoint le groupe, le duel sera créé automatiquement.</p>
          </div>
        ) : duel?.status === 'done' ? (
          <>
            <p className="match-result">Score final : {duel.score_a} - {duel.score_b}
              {(duel.score_a ?? 0) === (duel.score_b ?? 0) ? ' — Match nul.' : ((duel.player_a_id === user?.id) === ((duel.score_a ?? 0) > (duel.score_b ?? 0)) ? ' — Tu as gagné !' : ' — Tu as perdu.')}</p>

            {!((duel.score_a ?? 0) !== (duel.score_b ?? 0) && (duel.player_a_id === user?.id) === ((duel.score_a ?? 0) > (duel.score_b ?? 0))) && duel.week_start === latestWeekStart && (
              <button className="groups-action-btn groups-action-btn-secondary" disabled={revancheBusy} onClick={useRevanche}>
                {revancheBusy ? 'Revanche...' : '🔁 Revanche (5 🪙) — rejouer ce duel'}
              </button>
            )}

            {review === null ? (
              <button className="match-save-btn" disabled={reviewLoading} onClick={loadReview}>
                {reviewLoading ? '...' : 'Voir les réponses'}
              </button>
            ) : (
              <ul className="matches-list">
                {review.map((r) => (
                  <li className="match-card" key={r.question_order}>
                    <div className="match-teams"><span>Q{r.question_order} — {r.question}</span></div>
                    <ul className="rules-points">
                      {r.options.map((opt, i) => {
                        const isCorrect = i === r.correct_index
                        const isMine = i === r.my_index
                        const isOpp = i === r.opp_index
                        let label = opt
                        const tags: string[] = []
                        if (isMine) tags.push('toi')
                        if (isOpp) tags.push('adversaire')
                        if (tags.length) label += ` (${tags.join(' & ')})`
                        return (
                          <li key={i} style={{ color: isCorrect ? '#2F8F5B' : (isMine || isOpp) ? '#C1443C' : undefined, fontWeight: isCorrect ? 700 : undefined }}>
                            {isCorrect ? '✓ ' : ''}{label}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : question ? (
          <div className="roulette-result">
            <p className="predictions-period">Question {question.order} / 10 — {timeLeft}s</p>
            <p className="quiz-question-live">{question.question}</p>
            <ul className="matches-list">
              {question.options.map((opt, i) => (
                <li key={i} className="match-card groups-card-clickable" onClick={() => answer(question.order, i)}>{opt}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="groups-empty">En attente de l'adversaire ({oppAnswered}/10 réponses)...</p>
        )}
      </div>
    )
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Quiz — {groupName}</h2>
      </div>
      <p className="predictions-period">
        Chaque semaine, un adversaire différent t'est tiré au sort automatiquement (jamais deux fois la même personne tant que tu n'as pas croisé tout le groupe).
      </p>
      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : duels.length === 0 ? (
        <p className="groups-empty">Ton premier quiz-duel arrive au prochain tirage au sort hebdomadaire.</p>
      ) : (
        (() => {
          const currentDuels = duels.filter((d) => d.status !== 'done')
          const historyDuels = duels.filter((d) => d.status === 'done')
          const shown = tab === 'current' ? currentDuels : historyDuels
          return (
            <>
              <div className="group-nav-tabs bet-tabs">
                <button
                  className={'group-nav-tab' + (tab === 'current' ? ' group-nav-tab-active' : '')}
                  onClick={() => setTab('current')}
                >
                  En cours ({currentDuels.length})
                </button>
                <button
                  className={'group-nav-tab' + (tab === 'history' ? ' group-nav-tab-active' : '')}
                  onClick={() => setTab('history')}
                >
                  Historique
                </button>
              </div>
              {shown.length === 0 ? (
                <p className="groups-empty">{tab === 'current' ? 'Aucun duel en cours.' : 'Aucun duel terminé pour le moment.'}</p>
              ) : (
                <ul className="matches-list">
                  {shown.map((d) => {
                    const opponentId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
                    return (
                      <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                        {d.status === 'waiting_opponent' ? (
                          <>
                            <div className="match-teams"><span>⏳ En attente d'un adversaire</span></div>
                            <div className="match-kickoff">Duel créé dès qu'un nouveau joueur rejoint</div>
                          </>
                        ) : (
                          <>
                            <div className="match-teams"><span>vs {opponentId ? pseudos[opponentId] ?? '???' : '???'}</span></div>
                            {d.status === 'done' ? (
                              <div className="match-result">
                                Terminé : {d.score_a} - {d.score_b}
                                <span className="match-kickoff"> · Semaine du {new Date(d.week_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                              </div>
                            ) : (
                              <div className="match-kickoff">{myDuelStatusLabel(d)}</div>
                            )}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )
        })()
      )}

      {allDuels.length > 0 && (
        <>
          <h3 className="rules-section-title">Tous les duels de la semaine</h3>
          <ul className="matches-list">
            {allDuels.map((d) => (
              <li className="match-card" key={d.id}>
                <div className="match-teams">
                  <span>{pseudos[d.player_a_id] ?? '???'} vs {d.player_b_id ? (pseudos[d.player_b_id] ?? '???') : 'en attente…'}</span>
                </div>
                {d.status === 'done' ? (
                  <div className="match-result">{d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">{weekDuelStatusLabel(d)}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
