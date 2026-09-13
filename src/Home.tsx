import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import TeamBadge from './TeamBadge'
import { SketchBall } from './Icons'

interface MatchRow {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: 'open' | 'resolved' | 'cancelled'
  matchday: number | null
}

interface RankRow {
  profile_id: string
  pseudo: string
  points: number
}

interface Props {
  groupId: string
  groupName: string
  onNavigate: (screen: 'pronostics' | 'classement' | 'penalty' | 'quiz' | 'jonglages') => void
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
          .select('id, home_team, away_team, kickoff_at, status, matchday')
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
  const remainingCount = Math.max(totalCount - doneCount, 0)
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const nextMatch = upcoming[0]
  const nextKickoff = nextMatch ? new Date(nextMatch.kickoff_at) : null
  const currentMatchday = upcoming.find((match) => match.matchday != null)?.matchday ?? null
  const heroTitle = currentMatchday ? `Journée ${currentMatchday}` : 'Journée en cours'

  const nextDateLabel = nextKickoff
    ? nextKickoff.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')
    : null
  const nextTimeLabel = nextKickoff
    ? nextKickoff.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null

  if (loading) {
    return <p className="groups-loading">Chargement...</p>
  }

  return (
    <div className="dash-screen">
      <div className="dash-v3-ambient" aria-hidden="true">
        <span className="dash-v3-crown">♔</span>
        <span>Plus qu'un jeu<br />entre potes</span>
      </div>

      <section className="dash-v2-hero" aria-labelledby="dashboard-title">
        <div className="dash-v2-hero-top">
          <span className="dash-v2-eyebrow">
            Saison {new Date().getFullYear()}{periodLabel ? ` • ${periodLabel}` : ''}
          </span>
        </div>

        <div className="dash-v2-hero-main">
          <div>
            <h2 id="dashboard-title" className="dash-v2-title">{heroTitle}</h2>
            <p className="dash-v2-subtitle">
              {totalCount > 0
                ? `${doneCount}/${totalCount} pronostic${totalCount > 1 ? 's' : ''} fait${doneCount > 1 ? 's' : ''}`
                : 'Les prochains matchs arrivent bientôt'}
            </p>
          </div>

          <div className="dash-v2-ball-wrap">
            <span className="dash-v2-ball-lines dash-v2-ball-lines-left" aria-hidden="true"><span /><span /></span>
            <SketchBall size={106} className="dash-v2-hero-ball" />
            <span className="dash-v2-ball-lines dash-v2-ball-lines-right" aria-hidden="true"><span /><span /></span>
            <span className="dash-v2-ball-caption">On joue<br />entre nous</span>
          </div>
        </div>

        {totalCount > 0 ? (
          <>
            <div className="dash-v2-progress-wrap">
              <div className="dash-v2-progress-track" aria-label={`${progressPct}% des pronostics complétés`}>
                <div className="dash-v2-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="dash-v3-progress-value">{progressPct}%</span>
            </div>

            {nextDateLabel && nextTimeLabel && (
              <p className="dash-v2-nextline">
                <span className="dash-v2-nextline-icon" aria-hidden="true">▣</span>
                <span>Prochain match {nextDateLabel} à {nextTimeLabel}</span>
              </p>
            )}

            <button className="dash-v2-cta" onClick={() => onNavigate('pronostics')}>
              {remainingCount > 0 ? 'Continuer mes pronos  →' : 'Voir mes pronos  →'}
            </button>
          </>
        ) : (
          <button className="dash-v2-cta" onClick={() => onNavigate('pronostics')}>
            Voir les pronostics  →
          </button>
        )}

        <div className="dash-v3-pitch-strip" aria-hidden="true">
          <span className="dash-v3-pitch-line" />
          <span className="dash-v3-pitch-arc" />
        </div>
      </section>

      <section className="dash-v2-section" aria-labelledby="play-title">
        <div className="dash-v2-section-heading">
          <h3 id="play-title">À toi de jouer</h3>
        </div>
        <div className="dash-v2-actions">
          <button className="dash-v2-action dash-v2-action-primary" onClick={() => onNavigate('pronostics')}>
            <span className="dash-v2-action-icon" aria-hidden="true">⚽</span>
            <span className="dash-v2-action-title">Pronos</span>
            <span className="dash-v2-action-sub">{remainingCount > 0 ? `${remainingCount} match${remainingCount > 1 ? 's' : ''} à faire` : 'Tout est prêt'}</span>
            <span className="dash-v3-action-arrow">›</span>
          </button>
          <button className="dash-v2-action dash-v2-action-accent" onClick={() => onNavigate('penalty')}>
            <span className="dash-v2-action-icon" aria-hidden="true">🥅</span>
            <span className="dash-v2-action-title">Duel penalty</span>
            <span className="dash-v2-action-sub">Un pote t'attend</span>
            <span className="dash-v3-action-arrow">›</span>
          </button>
          <button className="dash-v2-action" onClick={() => onNavigate('quiz')}>
            <span className="dash-v2-action-icon" aria-hidden="true">🧠</span>
            <span className="dash-v2-action-title">Quiz</span>
            <span className="dash-v2-action-sub">Nouveau duel</span>
            <span className="dash-v3-action-arrow">›</span>
          </button>
        </div>
      </section>

      {nextMatch && (
        <section className="dash-v2-section" aria-labelledby="next-match-title">
          <div className="dash-v2-section-heading">
            <h3 id="next-match-title">Matchs à venir</h3>
            <button className="dash-v2-section-link" onClick={() => onNavigate('pronostics')}>Voir tout →</button>
          </div>

          <div className="dash-v2-match-card">
            <div className="dash-v2-match-meta">
              {nextDateLabel && nextTimeLabel && (
                <span className="dash-v2-match-date">▣ {nextDateLabel} {nextTimeLabel}</span>
              )}
              <span className="dash-v2-match-kicker">Ligue 1{nextMatch.matchday ? `  •  Journée ${nextMatch.matchday}` : ''}</span>
            </div>

            <div className="dash-v2-match-body">
              <div className="dash-v2-team dash-v3-team-home">
                <TeamBadge name={nextMatch.home_team} size={56} />
                <span className="dash-v2-team-name">{nextMatch.home_team}</span>
              </div>

              <div className="dash-v2-prediction">
                <span className="dash-v2-prediction-label">Mon pronostic</span>
                {myNextPred ? (
                  <span className="dash-v2-prediction-score">{myNextPred.home} - {myNextPred.away}</span>
                ) : (
                  <span className="dash-v2-prediction-score is-empty">À faire</span>
                )}
              </div>

              <div className="dash-v2-team dash-v3-team-away">
                <span className="dash-v2-team-name">{nextMatch.away_team}</span>
                <TeamBadge name={nextMatch.away_team} size={56} />
              </div>
            </div>

            <button className="dash-v2-match-footer" onClick={() => onNavigate('pronostics')}>
              Voir les pronostics des potes  →
            </button>
          </div>
        </section>
      )}

      <section className="dash-v2-section" aria-labelledby="ranking-title">
        <div className="dash-v2-section-heading">
          <h3 id="ranking-title">Classement</h3>
          <button className="dash-v2-section-link" onClick={() => onNavigate('classement')}>Voir le classement →</button>
        </div>

        {ranking.length === 0 ? (
          <p className="groups-empty">Pas encore de points marqués sur cette période.</p>
        ) : (
          <div className="dash-v2-ranking-card dash-v3-ranking-card">
            <ul className="dash-v2-ranking-list">
              {ranking.map((r, i) => {
                const isMe = r.profile_id === user?.id
                return (
                  <li key={r.profile_id} className={`dash-v2-ranking-row${isMe ? ' is-me' : ''}`}>
                    <span className={`dash-v2-rank rank-${i + 1}`}>{i + 1}</span>
                    <span className="dash-v2-player">
                      <span className="dash-v3-player-avatar">{r.pseudo.slice(0, 1).toUpperCase()}</span>
                      <span>{r.pseudo}</span>
                    </span>
                    <span className="dash-v2-points">{r.points} pts</span>
                  </li>
                )
              })}
            </ul>
            <div className="dash-v3-ranking-note" aria-hidden="true">
              <span className="dash-v3-crown">♔</span>
              <span>Des points<br />mais surtout<br />des potes</span>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
