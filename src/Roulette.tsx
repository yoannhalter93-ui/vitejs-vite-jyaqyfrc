import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Team {
  api_team_id: number
  name: string
}

interface Assignment {
  profile_id: string
  team_name: string
  pseudo?: string
}

interface Props {
  groupId: string
  groupName: string
}

export default function Roulette({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [myTeam, setMyTeam] = useState<string | null>(null)
  const [teammates, setTeammates] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [spinLabel, setSpinLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: period } = await supabase
      .from('group_periods')
      .select('id')
      .eq('group_id', groupId)
      .eq('is_current', true)
      .maybeSingle()

    if (!period) {
      setPeriodId(null)
      setLoading(false)
      return
    }
    setPeriodId(period.id)

    const { data: assigns, error: aErr } = await supabase
      .from('team_assignments')
      .select('profile_id, team_name')
      .eq('group_id', groupId)
      .eq('period_id', period.id)

    if (aErr) {
      setError(aErr.message)
      setLoading(false)
      return
    }

    const mine = (assigns ?? []).find((a) => a.profile_id === user.id)
    setMyTeam(mine ? mine.team_name : null)

    const others = (assigns ?? []).filter((a) => a.profile_id !== user.id)
    const ids = others.map((a) => a.profile_id)
    let pseudos: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
      pseudos = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
    }
    setTeammates(others.map((a) => ({ ...a, pseudo: pseudos[a.profile_id] })))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user])

  const spin = async () => {
    if (!user || !periodId) return
    setError(null)
    setSpinning(true)

    const { data: allTeams } = await supabase.from('ligue1_teams').select('api_team_id, name')
    const { data: taken } = await supabase
      .from('team_assignments')
      .select('team_name')
      .eq('group_id', groupId)
      .eq('period_id', periodId)

    const takenNames = new Set((taken ?? []).map((t) => t.team_name))
    const available = (allTeams ?? []).filter((t: Team) => !takenNames.has(t.name))

    if (available.length === 0) {
      setError('Toutes les équipes ont déjà été attribuées.')
      setSpinning(false)
      return
    }

    let count = 0
    const spinInterval = setInterval(() => {
      const r = available[Math.floor(Math.random() * available.length)]
      setSpinLabel(r.name)
      count++
      if (count > 12) {
        clearInterval(spinInterval)
        finish(available)
      }
    }, 100)
  }

  const finish = async (available: Team[]) => {
    if (!user || !periodId) return
    const chosen = available[Math.floor(Math.random() * available.length)]

    const { error: insErr } = await supabase.from('team_assignments').insert({
      group_id: groupId,
      profile_id: user.id,
      team_name: chosen.name,
      api_team_id: chosen.api_team_id,
      period_id: periodId,
      inverted: false,
    })

    if (insErr) {
      setError(insErr.message)
    } else {
      setSpinLabel(chosen.name)
      setMyTeam(chosen.name)
    }
    setSpinning(false)
    await load()
  }

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Roulette d'équipe — {groupName}</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement...</p>
      ) : !periodId ? (
        <p className="groups-empty">Aucune période en cours.</p>
      ) : myTeam ? (
        <div className="roulette-result">
          <p className="roulette-label">Ton équipe attitrée pour cette période :</p>
          <div className="roulette-team-badge">{myTeam}</div>
        </div>
      ) : (
        <div className="roulette-result">
          {spinning ? (
            <div className="roulette-team-badge roulette-spinning">{spinLabel || '...'}</div>
          ) : (
            <button className="match-save-btn roulette-btn" onClick={spin}>
              🎰 Lancer la roulette
            </button>
          )}
        </div>
      )}

      {teammates.length > 0 && (
        <div className="roulette-teammates">
          <p className="predictions-period">Équipes des autres membres :</p>
          <ul className="matches-list">
            {teammates.map((t) => (
              <li className="match-card roulette-teammate-card" key={t.profile_id}>
                <span>{t.pseudo ?? '???'}</span>
                <span className="roulette-teammate-team">{t.team_name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
