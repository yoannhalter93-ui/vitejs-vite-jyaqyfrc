import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import TeamBadge from './TeamBadge'
import { SketchBall, SketchTrophy, Squiggle } from './Icons'

interface MatchRow {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: 'open' | 'resolved' | 'cancelled'
}

interface RankRow {
  profile_id: string
  pseudo: string
  points: number
}

interface Props {
  groupId: string
  groupName: string
  onNavigate: (screen: 'pronostics' | 'classement' | 'penalty' | 'quiz') => void
}

export default function Home({ groupId, groupName, onNavigate }: Props) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [periodLabel, setPeriodLabel] = useState<string | null>(null)
  const [upcoming, setUpcoming] = useState<MatchRow[]>([])
  const [donePredIds, setDonePredIds] = useState<Set<string>>(new Set())
  const [myNextPred, setMyNextPred] = useState<{ home: number; away: number } | null>(null)
  const [ranking, setRanking] = useState<RankRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!user) return
      setLoading(true)

      const { data: period } = await supabase
        .from('group_periods')
        .select('id, label')
        .eq('group_id', groupId)
        .eq('is_current', true)
        .maybeSingle()

      if (cancelled) return
      setPeriodLabel(period?.label ?? null)

      if (period) {
        const { data: matchesData } = await supabase
          .from('matches')
          .select('id, home_team, away_team, kickoff_at, status')
          .eq('group_id', groupId)
          .eq('period_id', period.id)
          .neq('status', 'cancelled')
          .gt('kickoff_at', new Date().toISOString())
          .order('kickoff_at', { ascending: true })

        if (cancelled) return
        const list = matchesData ?? []
        setUpcoming(list)

        const matchIds = list.map((m) => m.id)
        if (matchIds.length > 0) {
          const { data: predsData } = await supabase
            .from('match_predictions')
            .select('match_id, pred_home_score, pred_away_score')
            .eq('profile_id', user.id)
            .in('match_id', matchIds)

          if (cancelled) return
          const done = new Set((predsData ?? []).map((p) => p.match_id))
          setDonePredIds(done)
          const firstId = list[0]?.id
          const mine = (predsData ?? []).find((p) => p.match_id === firstId)
          setMyNextPred(mine ? { home: mine.pred_home_score, away: mine.pred_away_score } : null)
        } else {
          setDonePredIds(new Set())
          setMyNextPred(null)
        }

        const { data: mem } = await supabase
          .from('group_members')
          .select('profile_id, profiles(pseudo)')
          .eq('group_id', groupId)

        if (cancelled) return
        type MemberRow = { profile_id: string; profiles: { pseudo: string } | { pseudo: string }[] | null }
        const members = ((mem ?? []) as unknown as MemberRow[]).map((m) => {
          const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
          return { profile_id: m.profile_id, pseudo: prof?.pseudo ?? '???' }
        })

        const { data: ledger } = await supabase
          .from('points_ledger')
          .select('profile_id, points')
          .eq('group_id', groupId)
          .eq('period_id', period.id)

        if (cancelled) return
        const totals: Record<string, number> = {}
        for (const row of ledger ?? []) {
          totals[row.profile_id] = (totals[row.profile_id] ?? 0) + row.points
        }
        const rank = members
          .map((m) => ({ ...m, points: totals[m.profile_id] ?? 0 }))
          .sort((a, b) => b.points - a.points || a.pseudo.localeCompare(b.pseudo))
          .slice(0, 3)
        setRanking(rank)
      } else {
        setUpcoming([])
        setDonePredIds(new Set())
        setRanking([])
      }

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [groupId, user])

  const totalCount = upcoming.length
  const doneCount = upcoming.filter((m) => donePredIds.has(m.id)).length
  const todoCount = totalCount - doneCount
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const nextMatch = upcoming[0]
  const nextKickoff = nextMatch ? new Date(nextMatch.kickoff_at) : null
  const medal = ['🥇', '🥈', '🥉']

  if (loading) {
    return <p className="groups-loading">Chargement...</p>
  }

  return (
    <div className="dash-screen">
      <div className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-hero-eyebrow">Saison {new Date().getFullYear()}{periodLabel ? ` • ${periodLabel}` : ''}</span>
          <h2 className="dash-hero-title">{groupName}</h2>
          {totalCount > 0 ? (
            <>
              <p className="dash-hero-sub">{doneCount}/{totalCount} pronostics faits</p>
              <div className="dash-progress-track">
                <div className="dash-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              {nextKickoff && (
                <p className="dash-hero-next">
                  🗓 Prochain match {nextKickoff.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {nextKickoff.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <button className="dash-cta-btn" onClick={() => onNavigate('pronostics')}>
                Continuer mes pronos →
              </button>
            </>
          ) : (
            <>
              <p className="dash-hero-sub">Aucun match à venir pour l'instant</p>
              <button className="dash-cta-btn" onClick={() => onNavigate('pronostics')}>
                Voir les pronostics →
              </button>
            </>
          )}
          <span className="dash-hero-caption">On joue entre nous</span>
        </div>
        <SketchBall size={104} className="dash-hero-ball" />
      </div>

      <div className="dash-section">
        <div className="dash-section-title">
          <h3>À toi de jouer</h3>
          <Squiggle />
        </div>
        <div className="dash-actions">
          <button className="dash-action-card" onClick={() => onNavigate('pronostics')}>
            <span className="dash-action-icon">⚽</span>
            <span className="dash-action-label">Pronos</span>
            <span className="dash-action-sub">{todoCount > 0 ? `${todoCount} match${todoCount > 1 ? 's' : ''} à faire` : 'À jour'}</span>
          </button>
          <button className="dash-action-card dash-action-card-accent" onClick={() => onNavigate('penalty')}>
            <span className="dash-action-icon">🥅</span>
            <span className="dash-action-label">Duel penalty</span>
            <span className="dash-action-sub">Défie tes potes</span>
          </button>
          <button className="dash-action-card" onClick={() => onNavigate('quiz')}>
            <span className="dash-action-icon">🧠</span>
            <span className="dash-action-label">Quiz</span>
            <span className="dash-action-sub">Nouveau duel</span>
          </button>
        </div>
      </div>

      {nextMatch && (
        <div className="dash-section">
          <div className="dash-section-title">
            <h3>Matchs à venir</h3>
            <Squiggle />
            <button className="dash-section-link" onClick={() => onNavigate('pronostics')}>Voir tout →</button>
          </div>
          <div className="dash-match-card">
            <div className="dash-match-team">
              <TeamBadge name={nextMatch.home_team} size={38} />
              <span>{nextMatch.home_team}</span>
            </div>
            {myNextPred ? (
              <div className="dash-match-pred">
                <span className="dash-match-pred-label">Mon pronostic</span>
                <span className="dash-match-pred-score">{myNextPred.home} - {myNextPred.away}</span>
              </div>
            ) : (
              <div className="dash-match-pred">
                <span className="dash-match-pred-score dash-match-pred-empty">VS</span>
              </div>
            )}
            <div className="dash-match-team dash-match-team-away">
              <span>{nextMatch.away_team}</span>
              <TeamBadge name={nextMatch.away_team} size={38} />
            </div>
          </div>
        </div>
      )}

      <div className="dash-section">
        <div className="dash-section-title">
          <h3>Classement</h3>
          <Squiggle />
          <button className="dash-section-link" onClick={() => onNavigate('classement')}>Voir le classement →</button>
        </div>
        {ranking.length === 0 ? (
          <p className="groups-empty">Pas encore de points marqués ce trimestre.</p>
        ) : (
          <div className="dash-ranking-card">
            <ul className="dash-ranking-list">
              {ranking.map((r, i) => (
                <li key={r.profile_id} className={r.profile_id === user?.id ? 'dash-ranking-row-me' : ''}>
                  <span className="dash-ranking-medal">{medal[i]}</span>
                  <span className="dash-ranking-pseudo">{r.pseudo}</span>
                  <span className="dash-ranking-pts">{r.points} pts</span>
                </li>
              ))}
            </ul>
            <SketchTrophy size={40} className="dash-ranking-trophy" />
          </div>
        )}
      </div>
    </div>
  )
}
