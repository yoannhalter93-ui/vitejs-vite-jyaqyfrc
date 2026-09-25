import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Avatar from './Avatar'

interface Row {
  profile_id: string
  total_points: number
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

interface Props {
  groupId: string
  groupName: string
}

// une entrée par façon de gagner des points, pour comprendre "comment" un
// joueur a construit son classement général — les clés correspondent à
// points_ledger.source_type, sauf 'duels' qui est un onglet fusionné (voir
// pointsForTab plus bas) : les quiz ('duel' en base) et les duels penalty
// ('minijeu' en base) sont deux variantes du même jeu de duels, affichées
// ensemble ici au lieu de deux onglets séparés. 'jonglage_chrono' est
// relabellé "Mini-jeux" pour matcher le nom utilisé dans l'onglet Jeux.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'match', label: 'Pronostics' },
  { key: 'team_assignment', label: 'Mon équipe' },
  { key: 'duels', label: 'Duels' },
  { key: 'jonglage_chrono', label: 'Mini-jeux' },
  { key: 'free_bet', label: 'Paris libres' },
  { key: 'jeu_semaine', label: 'But en or' },
]

// Le classement "Duels" fusionne deux catégories de points_ledger.source_type
// (les quiz et les duels penalty) en un seul total par joueur.
function mergeCategoryPoints(a?: Record<string, number>, b?: Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = { ...a }
  for (const [profileId, pts] of Object.entries(b ?? {})) {
    merged[profileId] = (merged[profileId] ?? 0) + pts
  }
  return merged
}

export default function Classement({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'general' | string>('general')
  const [members, setMembers] = useState<{ profile_id: string; pseudo: string; avatar_url: string | null; avatar_emoji: string | null }[]>([])
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
        .select('profile_id, profiles(pseudo, avatar_url, avatar_emoji)')
        .eq('group_id', groupId)

      if (membersError) {
        setError(membersError.message)
        setLoading(false)
        return
      }

      type MemberRow = {
        profile_id: string
        profiles: { pseudo: string; avatar_url: string | null; avatar_emoji: string | null }
          | { pseudo: string; avatar_url: string | null; avatar_emoji: string | null }[] | null
      }
      const memberRows = ((mem ?? []) as unknown as MemberRow[]).map((m) => {
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return {
          profile_id: m.profile_id,
          pseudo: prof?.pseudo ?? '???',
          avatar_url: prof?.avatar_url ?? null,
          avatar_emoji: prof?.avatar_emoji ?? null,
        }
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

  const pointsForTab = tab === 'general'
    ? generalPoints
    : tab === 'duels'
      ? mergeCategoryPoints(categoryPoints['duel'], categoryPoints['minijeu'])
      : categoryPoints[tab] ?? {}
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
        <>
          <ul className="classement-board">
            {visibleRows.map((r, i) => {
              const rank = i + 1
              const rankClass = rank <= 3 ? ` classement-board-rank-${rank}` : ''
              return (
                <li
                  key={r.profile_id}
                  className={"classement-board-row" + (r.profile_id === user?.id ? " classement-board-row-me" : "")}
                >
                  <span className={"classement-board-rank" + rankClass}>{rank}</span>
                  <Avatar
                    pseudo={r.pseudo}
                    avatarUrl={r.avatar_url}
                    avatarEmoji={r.avatar_emoji}
                    size={38}
                    className="classement-board-avatar"
                  />
                  <span className="classement-board-name">{r.pseudo}</span>
                  <span className={"classement-board-points" + (rank <= 3 ? " classement-board-points-top" : "")}>
                    {r.total_points} pts
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="classement-board-note" aria-hidden="true">
            <svg className="classement-board-crown" viewBox="0 0 48 34">
              <path d="M5 27L2 8l13 10L24 3l9 15L46 8l-3 19z" />
              <path d="M7 31h34" />
            </svg>
            <span>Des points, mais surtout des potes</span>
            <i className="classement-board-underline" />
          </div>
        </>
      )}
    </div>
  )
}
