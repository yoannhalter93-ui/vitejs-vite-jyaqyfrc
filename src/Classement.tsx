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

      const { data: members, error: membersError } = await supabase
        .from('group_members')
        .select('profile_id, profiles(pseudo)')
        .eq('group_id', groupId)

      if (membersError) {
        setError(membersError.message)
        setLoading(false)
        return
      }

      const { data: period } = await supabase
        .from('group_periods')
        .select('id')
        .eq('group_id', groupId)
        .eq('is_current', true)
        .maybeSingle()

      let pointsByProfile: Record<string, number> = {}

      if (period) {
        const { data: lb, error: lbError } = await supabase
          .from('group_leaderboard')
          .select('profile_id, total_points')
          .eq('group_id', groupId)
          .eq('period_id', period.id)

        if (lbError) {
          setError(lbError.message)
          setLoading(false)
          return
        }

        pointsByProfile = Object.fromEntries((lb ?? []).map((r) => [r.profile_id, r.total_points]))
      }

      type MemberRow = { profile_id: string; profiles: { pseudo: string } | { pseudo: string }[] | null }
      const merged: Row[] = ((members ?? []) as unknown as MemberRow[]).map((m) => {
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return {
          profile_id: m.profile_id,
          pseudo: prof?.pseudo ?? '???',
          total_points: pointsByProfile[m.profile_id] ?? 0,
        }
      })

      merged.sort((a, b) => b.total_points - a.total_points || a.pseudo.localeCompare(b.pseudo))

      setRows(merged)
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
        <p className="groups-empty">Aucun membre dans ce groupe pour l'instant.</p>
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
