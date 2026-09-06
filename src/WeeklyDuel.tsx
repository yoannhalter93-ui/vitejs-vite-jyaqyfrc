import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Duel {
  id: string
  player_a_id: string
  player_b_id: string
  status: string
  score_a: number | null
  score_b: number | null
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
      .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b')
      .eq('group_id', groupId).or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
    if (dErr) setError(dErr.message)
    setDuels(d ?? [])

    // tous les duels du groupe pour la semaine en cours (qui affronte qui,
    // et où ils en sont), pas seulement les miens
    const { data: latest } = await supabase
      .from('weekly_duels').select('week_start')
      .eq('group_id', groupId).order('week_start', { ascending: false }).limit(1).maybeSingle()
    if (latest?.week_start) {
      const { data: all } = await supabase
        .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b')
        .eq('group_id', groupId).eq('week_start', latest.week_start)
        .order('created_at', { ascending: true })
      setAllDuels(all ?? [])
    } else {
      setAllDuels([])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

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
      .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b')
      .eq('id', id).maybeSingle()
    setDuel((d as Duel) ?? null)

    const { data: ans } = await supabase.from('duel_answers').select('profile_id').eq('duel_id', id)
    const mine = (ans ?? []).filter((a) => a.profile_id === user?.id).length
    setOppAnswered((ans ?? []).length - mine)

    if (d && d.status !== 'done' && mine < 10) {
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
          <h2>vs {opponentId ? pseudos[opponentId] ?? '???' : '???'}</h2>
        </div>
        {error && <p className="groups-error">{error}</p>}

        {duel?.status === 'done' ? (
          <>
            <p className="match-result">Score final : {duel.score_a} - {duel.score_b}
              {(duel.score_a ?? 0) === (duel.score_b ?? 0) ? ' — Match nul.' : ((duel.player_a_id === user?.id) === ((duel.score_a ?? 0) > (duel.score_b ?? 0)) ? ' — Tu as gagné !' : ' — Tu as perdu.')}</p>

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
            <p className="match-teams">{question.question}</p>
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
        <p className="groups-loading">Chargement...</p>
      ) : duels.length === 0 ? (
        <p className="groups-empty">Ton premier quiz-duel arrive au prochain tirage au sort hebdomadaire.</p>
      ) : (
        <ul className="matches-list">
          {duels.map((d) => {
            const opponentId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
            return (
              <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                <div className="match-teams"><span>vs {pseudos[opponentId] ?? '???'}</span></div>
                {d.status === 'done' ? (
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
                {d.status === 'done' ? (
                  <div className="match-result">{d.score_a} - {d.score_b}</div>
                ) : (
                  <div className="match-kickoff">
                    {d.score_a === null && d.score_b === null ? 'Pas encore commencé' : 'En cours'}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
