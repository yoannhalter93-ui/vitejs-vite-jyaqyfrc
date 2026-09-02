import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Row {
  profile_id: string
  total_points: number
  pseudo: string
}

interface Props {
  groupId: string
  groupName: string
}

export default function Classement({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const { data: period } = await supabase
        .from('group_periods')
        .select('id')
        .eq('group_id', groupId)
        .eq('is_current', true)
        .maybeSingle()

      if (!period) {
        setRows([])
        setLoading(false)
        return
      }

      const { data: lb, error: lbError } = await supabase
        .from('group_leaderboard')
        .select('profile_id, total_points')
        .eq('group_id', groupId)
        .eq('period_id', period.id)
        .order('total_points', { ascending: false })

      if (lbError) {
        setError(lbError.message)
        setLoading(false)
        return
      }

      const ids = (lb ?? []).map((r) => r.profile_id)
      let pseudos: Record<string, string> = {}
      if (ids.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, pseudo').in('id', ids)
        pseudos = Object.fromEntries((profs ?? []).map((p) => [p.id, p.pseudo]))
      }

      setRows((lb ?? []).map((r) => ({ ...r, pseudo: pseudos[r.profile_id] ?? '???' })))
      setLoading(false)
    }
    load()
  }, [groupId])

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Classement — {groupName}</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement du classement...</p>
      ) : rows.length === 0 ? (
        <p className="groups-empty">Aucun point marqué pour l'instant.</p>
      ) : (
        <ul className="matches-list">
          {rows.map((r, i) => (
            <li className={"match-card classement-row" + (r.profile_id === user?.id ? " classement-row-me" : "")} key={r.profile_id}>
              <span className="classement-rank">{i + 1}.</span>
              <span className="classement-pseudo">{r.pseudo}</span>
              <span className="classement-points">{r.total_points} pts</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
