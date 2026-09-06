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

// une entrée par façon de gagner des points, pour comprendre "comment" un
// joueur a construit son classement général — les clés correspondent à
// points_ledger.source_type
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'match', label: 'Pronostics' },
  { key: 'team_assignment', label: 'Mon équipe' },
  { key: 'duel', label: 'Quiz' },
  { key: 'minijeu', label: 'Duel penalty' },
  { key: 'jonglage_chrono', label: 'Jonglages' },
  { key: 'free_bet', label: 'Paris libres' },
]

export default function Classement({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'general' | string>('general')
  const [members, setMembers] = useState<{ profile_id: string; pseudo: string }[]>([])
  const [generalPoints, setGeneralPoints] = useState<Record<string, number>>({})
  const [categoryPoints, setCategoryPoints] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const { data: mem, error: membersError } = await supabase
        .from('group_members')
        .select('profile_id, profiles(pseudo)')
        .eq('group_id', groupId)

      if (membersError) {
        setError(membersError.message)
        setLoading(false)
        return
      }

      type MemberRow = { profile_id: string; profiles: { pseudo: string } | { pseudo: string }[] | null }
      const memberRows = ((mem ?? []) as unknown as MemberRow[]).map((m) => {
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return { profile_id: m.profile_id, pseudo: prof?.pseudo ?? '???' }
      })
      setMembers(memberRows)

      const { data: period } = await supabase
        .from('group_periods')
        .select('id')
        .eq('group_id', groupId)
        .eq('is_current', true)
        .maybeSingle()

      if (!period) {
        setGeneralPoints({})
        setCategoryPoints({})
        setLoading(false)
        return
      }

      // un seul aller-retour : chaque ligne de points_ledger de la période,
      // avec sa catégorie (source_type) — sert à la fois au total général
      // et au détail par catégorie, pas besoin de requêtes séparées
      const { data: ledger, error: ledgerError } = await supabase
        .from('points_ledger')
        .select('profile_id, source_type, points')
        .eq('group_id', groupId)
        .eq('period_id', period.id)

      if (ledgerError) {
        setError(ledgerError.message)
        setLoading(false)
        return
      }

      const general: Record<string, number> = {}
      const byCategory: Record<string, Record<string, number>> = {}
      for (const row of ledger ?? []) {
        general[row.profile_id] = (general[row.profile_id] ?? 0) + row.points
        byCategory[row.source_type] = byCategory[row.source_type] ?? {}
        byCategory[row.source_type][row.profile_id] = (byCategory[row.source_type][row.profile_id] ?? 0) + row.points
      }
      setGeneralPoints(general)
      setCategoryPoints(byCategory)
      setLoading(false)
    }
    load()
  }, [groupId])

  const pointsForTab = tab === 'general' ? generalPoints : categoryPoints[tab] ?? {}
  const rows: Row[] = members
    .map((m) => ({ ...m, total_points: pointsForTab[m.profile_id] ?? 0 }))
    .sort((a, b) => b.total_points - a.total_points || a.pseudo.localeCompare(b.pseudo))

  // en détail par catégorie, un membre à 0 point dans cette catégorie
  // précise n'apporte rien à l'affichage (souvent la majorité du groupe) —
  // on ne montre que ceux qui ont vraiment marqué là-dedans, sauf en
  // "Général" où tout le monde doit apparaître
  const visibleRows = tab === 'general' ? rows : rows.filter((r) => r.total_points !== 0)

  return (
    <div className="predictions-screen">
      <div className="predictions-header">
        <h2>Classement — {groupName}</h2>
      </div>

      {error && <p className="groups-error">{error}</p>}

      <div className="group-nav-tabs classement-tabs">
        <button className={"group-nav-tab" + (tab === 'general' ? ' group-nav-tab-active' : '')} onClick={() => setTab('general')}>
          Général
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.key} className={"group-nav-tab" + (tab === c.key ? ' group-nav-tab-active' : '')} onClick={() => setTab(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="groups-loading">Chargement du classement...</p>
      ) : members.length === 0 ? (
        <p className="groups-empty">Aucun membre dans ce groupe pour l'instant.</p>
      ) : visibleRows.length === 0 ? (
        <p className="groups-empty">Personne n'a encore marqué de points ici.</p>
      ) : (
        <ul className="matches-list">
          {visibleRows.map((r, i) => (
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
