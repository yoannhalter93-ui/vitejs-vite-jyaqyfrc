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

const LIGUE1_2627_STARTS: Array<[string, number]> = [
  ['2026-08-21', 1],
  ['2026-08-28', 2],
  ['2026-09-04', 3],
  ['2026-09-11', 4],
  ['2026-09-18', 5],
  ['2026-10-09', 6],
  ['2026-10-16', 7],
  ['2026-10-23', 8],
  ['2026-10-30', 9],
  ['2026-11-06', 10],
  ['2026-11-20', 11],
  ['2026-11-27', 12],
  ['2026-12-04', 13],
  ['2026-12-11', 14],
  ['2027-01-02', 15],
  ['2027-01-15', 16],
  ['2027-01-22', 17],
  ['2027-01-29', 18],
  ['2027-02-05', 19],
  ['2027-02-12', 20],
  ['2027-02-19', 21],
  ['2027-02-26', 22],
  ['2027-03-05', 23],
  ['2027-03-12', 24],
  ['2027-03-19', 25],
  ['2027-04-02', 26],
  ['2027-04-09', 27],
  ['2027-04-16', 28],
  ['2027-04-23', 29],
  ['2027-04-30', 30],
  ['2027-05-07', 31],
  ['2027-05-15', 32],
  ['2027-05-22', 33],
  ['2027-05-29', 34],
]

function inferLigue1Matchday(date: Date | null): number | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const stamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  let current: number | null = null
  for (const [iso, matchday] of LIGUE1_2627_STARTS) {
    const [year, month, day] = iso.split('-').map(Number)
    const start = new Date(year, month - 1, day).getTime()
    if (stamp >= start) current = matchday
    else break
  }
  return current
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`dash-v4-calendar ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.25" y="5.25" width="17.5" height="15.25" rx="2.25" />
      <path d="M7 3.5v4M17 3.5v4M3.5 9.25h17" />
      <rect x="7" y="12" width="3" height="2.7" rx=".45" className="dash-v4-calendar-day" />
    </svg>
  )
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
  const storedMatchday = upcoming.find((match) => match.matchday != null)?.matchday ?? null
  const currentMatchday = inferLigue1Matchday(new Date()) ?? storedMatchday
  const nextMatchday = nextMatch?.matchday ?? inferLigue1Matchday(nextKickoff)
  const heroTitle = currentMatchday ? `Journée ${currentMatchday}` : 'Journée'

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

      <svg className="dash-v4-field-sketch" viewBox="0 0 120 160" aria-hidden="true">
        <g transform="rotate(8 60 80)">
          <rect x="13" y="8" width="94" height="144" rx="1" />
          <path d="M13 80h94" />
          <circle cx="60" cy="80" r="15" />
          <circle cx="60" cy="80" r="1.7" className="dash-v4-field-dot" />
          <rect x="34" y="8" width="52" height="24" />
          <rect x="45" y="8" width="30" height="10" />
          <rect x="34" y="128" width="52" height="24" />
          <rect x="45" y="142" width="30" height="10" />
        </g>
      </svg>

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
            <svg className="dash-v4-ball-motion" viewBox="0 0 150 150" aria-hidden="true">
              <path d="M35 24C18 36 10 53 10 70" />
              <path d="M43 31C29 41 22 53 21 66" />
              <path d="M50 39C39 47 34 55 33 64" />
              <path d="M43 119C55 132 69 139 84 141" />
              <path d="M51 111C61 121 72 127 84 129" />
              <path d="M60 104C68 111 76 115 85 117" />
            </svg>
            <SketchBall size={106} className="dash-v2-hero-ball" />
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
                <span className="dash-v2-nextline-icon" aria-hidden="true"><CalendarIcon /></span>
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
                <span className="dash-v2-match-date"><CalendarIcon className="dash-v4-calendar-small" /> {nextDateLabel} {nextTimeLabel}</span>
              )}
              <span className="dash-v2-match-kicker">Ligue 1{nextMatchday ? `  •  Journée ${nextMatchday}` : ''}</span>
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
                      <span className="dash-v3-player-name">{r.pseudo}</span>
                    </span>
                    <span className="dash-v2-points">{r.points} pts</span>
                  </li>
                )
              })}
            </ul>
            <div className="dash-v3-ranking-note" aria-hidden="true">
              <svg className="dash-v4-note-crown" viewBox="0 0 48 34">
                <path d="M5 27L2 8l13 10L24 3l9 15L46 8l-3 19z" />
                <path d="M7 31h34" />
              </svg>
              <span>Des points,<br />mais surtout<br />des potes</span>
              <i className="dash-v4-note-underline" />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
