import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Duel {
  id: string
  player_a_id: string
  player_b_id: string
  status: string
  score_a: number
  score_b: number
}

interface Question {
  id: string
  question: string
  options: string[]
  correct_index: number
}

interface SeqRow {
  question_order: number
  question_id: string
}

interface Member {
  profile_id: string
  pseudo: string
}

interface Props {
  groupId: string
  groupName: string
}

function monday(): string {
  const d = new Date()
  const day = d.getDay() || 7
  if (day !== 1) d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

export default function WeeklyDuel({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [duels, setDuels] = useState<Duel[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [pseudos, setPseudos] = useState<Record<string, string>>({})
  const [showChallenge, setShowChallenge] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [sequence, setSequence] = useState<SeqRow[]>([])
  const [questions, setQuestions] = useState<Record<string, Question>>({})
  const [myAnswers, setMyAnswers] = useState<Record<number, boolean>>({})
  const [oppAnswerCount, setOppAnswerCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: period } = await supabase
      .from('group_periods').select('id').eq('group_id', groupId).eq('is_current', true).maybeSingle()
    setPeriodId(period?.id ?? null)

    const { data: gm } = await supabase.from('group_members').select('profile_id').eq('group_id', groupId)
    const ids = (gm ?? []).map((m) => m.profile_id)
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
      const map = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
      setPseudos(map)
      setMembers(ids.filter((id) => id !== user.id).map((id) => ({ profile_id: id, pseudo: map[id] ?? '???' })))
    }

    const { data: d, error: dErr } = await supabase
      .from('weekly_duels').select('id, player_a_id, player_b_id, status, score_a, score_b')
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

  const challenge = async (opponentId: string) => {
    if (!user || !periodId) return
    setError(null)
    const { data: duel, error: err } = await supabase.from('weekly_duels').insert({
      group_id: groupId, player_a_id: user.id, player_b_id: opponentId,
      week_start: monday(), status: 'in_progress', score_a: 0, score_b: 0, period_id: periodId,
    }).select().single()
    if (err || !duel) {
      setError(err?.message ?? 'Erreur')
      return
    }
    const { data: qs } = await supabase.from('quiz_questions').select('id').limit(30)
    const shuffled = (qs ?? []).sort(() => Math.random() - 0.5).slice(0, 5)
    const rows = shuffled.map((q, i) => ({ duel_id: duel.id, question_order: i + 1, question_id: q.id }))
    await supabase.from('duel_question_sequence').insert(rows)
    setShowChallenge(false)
    await loadList()
  }

  const openDuel = async (id: string) => {
    setSelected(id)
    const { data: seq } = await supabase.from('duel_question_sequence').select('question_order, question_id').eq('duel_id', id).order('question_order')
    setSequence((seq ?? []) as SeqRow[])
    const qids = (seq ?? []).map((s) => s.question_id)
    if (qids.length > 0) {
      const { data: qs } = await supabase.from('quiz_questions').select('id, question, options, correct_index').in('id', qids)
      setQuestions(Object.fromEntries((qs ?? []).map((q) => [q.id, q as Question])))
    }
    const { data: ans } = await supabase.from('duel_answers').select('profile_id, question_order').eq('duel_id', id)
    const mine: Record<number, boolean> = {}
    let oppCount = 0
    for (const a of ans ?? []) {
      if (a.profile_id === user?.id) mine[a.question_order] = true
      else oppCount++
    }
    setMyAnswers(mine)
    setOppAnswerCount(oppCount)
  }

  const answer = async (order: number, index: number) => {
    if (!user || !selected) return
    const { error: err } = await supabase.from('duel_answers').insert({
      duel_id: selected, profile_id: user.id, question_order: order, answered_index: index,
    })
    if (err) setError(err.message)
    await openDuel(selected)
    await maybeFinish(selected)
  }

  const maybeFinish = async (duelId: string) => {
    const { data: ans } = await supabase.from('duel_answers').select('profile_id, is_correct').eq('duel_id', duelId)
    const duel = duels.find((d) => d.id === duelId)
    if (!duel) return
    const aAns = (ans ?? []).filter((a) => a.profile_id === duel.player_a_id)
    const bAns = (ans ?? []).filter((a) => a.profile_id === duel.player_b_id)
    if (aAns.length < 5 || bAns.length < 5) return
    const scoreA = aAns.filter((a) => a.is_correct).length
    const scoreB = bAns.filter((a) => a.is_correct).length
    await supabase.from('weekly_duels').update({ score_a: scoreA, score_b: scoreB, status: 'finished' }).eq('id', duelId)
    await loadList()
  }

  if (selected) {
    const duel = duels.find((d) => d.id === selected)
    const opponentId = duel && (duel.player_a_id === user?.id ? duel.player_b_id : duel.player_a_id)
    const nextQ = sequence.find((s) => !myAnswers[s.question_order])
    const q = nextQ ? questions[nextQ.question_id] : null

    return (
      <div className="predictions-screen">
        <div className="predictions-header">
          <button className="predictions-back" onClick={() => setSelected(null)}>← Duels</button>
          <h2>vs {opponentId ? pseudos[opponentId] ?? '???' : '???'}</h2>
        </div>
        {error && <p className="groups-error">{error}</p>}

        {duel?.status === 'finished' ? (
          <p className="match-result">Score final : {duel.score_a} - {duel.score_b}
            {duel.score_a === duel.score_b ? ' — Match nul.' : ((duel.player_a_id === user?.id) === (duel.score_a > duel.score_b) ? ' — Tu as gagné !' : ' — Tu as perdu.')}</p>
        ) : q ? (
          <div className="roulette-result">
            <p className="predictions-period">Question {nextQ!.question_order} / 5</p>
            <p className="match-teams">{q.question}</p>
            <ul className="matches-list">
              {q.options.map((opt, i) => (
                <li key={i} className="match-card groups-card-clickable" onClick={() => answer(nextQ!.question_order, i)}>{opt}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="groups-empty">En attente de l'adversaire ({oppAnswerCount}/5 réponses)...</p>
        )}
      </div>
    )
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Quiz — {groupName}</h2>
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
        <p className="groups-empty">Aucun quiz-duel pour l'instant.</p>
      ) : (
        <ul className="matches-list">
          {duels.map((d) => {
            const opponentId = d.player_a_id === user?.id ? d.player_b_id : d.player_a_id
            return (
              <li className="match-card groups-card-clickable" key={d.id} onClick={() => openDuel(d.id)}>
                <div className="match-teams"><span>vs {pseudos[opponentId] ?? '???'}</span></div>
                {d.status === 'finished' ? (
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
