import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Rules from './Rules'

interface GroupRow {
  id: string
  name: string
  validation_mode: string
  invite_code: string
  period_type: string
  period_custom_days: number | null
  created_by: string
  created_at: string
}

interface Membership {
  role: string
  joined_at: string
  groups: GroupRow
}

interface Props {
  onSelectGroup: (groupId: string, groupName: string) => void
}

interface PeriodOption {
  key: string
  label: string
  period_type: string
  period_custom_days: number | null
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'mensuel', label: '1 mois', period_type: 'mensuel', period_custom_days: null },
  { key: '3mois', label: '3 mois', period_type: 'personnalise', period_custom_days: 90 },
  { key: 'demi_saison', label: 'Demi-saison', period_type: 'demi_saison', period_custom_days: null },
  { key: 'saison_complete', label: 'Saison complète', period_type: 'saison_complete', period_custom_days: null },
  { key: 'illimite', label: 'On verra (illimité)', period_type: 'personnalise', period_custom_days: 36500 },
]

function formatPeriod(periodType: string, periodCustomDays: number | null) {
  if (periodType === 'mensuel') return '1 mois'
  if (periodType === 'demi_saison') return 'Demi-saison'
  if (periodType === 'saison_complete') return 'Saison complète'
  if (periodType === 'personnalise') {
    if (periodCustomDays === 90) return '3 mois'
    if (periodCustomDays && periodCustomDays >= 3650) return 'Illimité'
    if (periodCustomDays) return `${periodCustomDays} jours`
    return 'Personnalisé'
  }
  return periodType
}

export default function Groups({ onSelectGroup }: Props) {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [periodKey, setPeriodKey] = useState(PERIOD_OPTIONS[0].key)
  const [creating, setCreating] = useState(false)

  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  const [showRules, setShowRules] = useState(false)

  const fetchGroups = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('group_members')
      .select('role, joined_at, groups(id, name, validation_mode, invite_code, period_type, period_custom_days, created_by, created_at)')
      .eq('profile_id', user.id)
      .order('joined_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setMemberships((data as unknown as Membership[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !newGroupName.trim()) return
    setError(null)
    setCreating(true)

    const option = PERIOD_OPTIONS.find((o) => o.key === periodKey) ?? PERIOD_OPTIONS[0]

    const { error: createError } = await supabase.rpc('create_group', {
      p_name: newGroupName.trim(),
      p_validation_mode: 'majorite',
      p_validator_id: null,
      p_period_type: option.period_type,
      p_period_custom_days: option.period_custom_days,
    })

    if (createError) {
      setError(createError.message)
      setCreating(false)
      return
    }

    setNewGroupName('')
    setPeriodKey(PERIOD_OPTIONS[0].key)
    setShowCreate(false)
    setCreating(false)
    await fetchGroups()
  }

  const handleJoinGroup = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !joinCode.trim()) return
    setError(null)
    setJoining(true)

    const { error: joinError } = await supabase.rpc('join_group', {
      p_invite_code: joinCode.trim(),
    })

    if (joinError) {
      setError(joinError.message)
      setJoining(false)
      return
    }

    setJoinCode('')
    setShowJoin(false)
    setJoining(false)
    await fetchGroups()
  }

  if (showRules) {
    return <Rules onBack={() => setShowRules(false)} />
  }

  return (
    <div className="groups-screen">
      <div className="groups-actions">
        <button
          className="groups-action-btn"
          onClick={() => {
            setShowCreate((v) => !v)
            setShowJoin(false)
          }}
        >
          + Créer un groupe
        </button>
        <button
          className="groups-action-btn groups-action-btn-secondary"
          onClick={() => {
            setShowJoin((v) => !v)
            setShowCreate(false)
          }}
        >
          Rejoindre un groupe
        </button>
      </div>

      <button className="groups-rules-btn" onClick={() => setShowRules(true)}>
        📖 Règles du jeu
      </button>

      {showCreate && (
        <>
          <div className="groups-period-picker">
            <div className="groups-period-label">Durée de la compétition :</div>
            <div className="groups-period-options">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={
                    option.key === periodKey
                      ? 'groups-period-btn groups-period-btn-active'
                      : 'groups-period-btn'
                  }
                  onClick={() => setPeriodKey(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <form className="groups-form" onSubmit={handleCreateGroup}>
            <input
              className="groups-input"
              placeholder="Nom du groupe"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
            />
            <button className="groups-submit" type="submit" disabled={creating}>
              {creating ? 'Création...' : 'Créer'}
            </button>
          </form>
        </>
      )}

      {showJoin && (
        <form className="groups-form" onSubmit={handleJoinGroup}>
          <input
            className="groups-input"
            placeholder="Code d'invitation"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            required
          />
          <button className="groups-submit" type="submit" disabled={joining}>
            {joining ? 'Un instant...' : 'Rejoindre'}
          </button>
        </form>
      )}

      {error && <p className="groups-error">{error}</p>}

      {loading ? (
        <p className="groups-loading">Chargement des groupes...</p>
      ) : memberships.length === 0 ? (
        <p className="groups-empty">Tu n'as pas encore de groupe. Crée-en un ou rejoins-en un avec un code.</p>
      ) : (
        <ul className="groups-list">
          {memberships.map((m) => (
            <li
              className="groups-card groups-card-clickable"
              key={m.groups.id}
              onClick={() => onSelectGroup(m.groups.id, m.groups.name)}
            >
              <div className="groups-card-top">
                <span className="groups-card-name">{m.groups.name}</span>
                <span className="groups-card-role">{m.role === 'owner' ? 'Propriétaire' : 'Membre'}</span>
              </div>
              <div className="groups-card-meta">
                <span>Validation : {m.groups.validation_mode}</span>
                <span>Période : {formatPeriod(m.groups.period_type, m.groups.period_custom_days)}</span>
              </div>
              {m.role === 'owner' && (
                <div className="groups-card-invite">
                  Code d'invitation : <code>{m.groups.invite_code}</code>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
