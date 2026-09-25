import { useEffect, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Rules from './Rules'
import { shareInvite } from './invite'
import { Squiggle, SketchFootball, SketchPeople, SketchTactics } from './Icons'
import LoadingSkeleton from './LoadingSkeleton'

// Petit hash stable (pas besoin de cryptographique, juste répartir les
// groupes sur une pastille d'icône et une citation de façon consistante
// d'un rendu à l'autre, sans stocker quoi que ce soit en base).
function hashGroupId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Touche décorative façon maquette : une petite citation différente par
// groupe (choisie dans une liste fixe, stable selon l'id du groupe) — pas
// de vraie donnée derrière, même esprit que le sous-titre "Petits paris,
// grands débats" de l'écran Paris libres.
const GROUP_TAGLINES = [
  "Toujours une excuse pour jouer.",
  "Une équipe, une famille.",
  "On teste aujourd'hui, on joue mieux demain.",
  "Le foot, c'est mieux entre potes.",
  "Ici, même les paris sont sérieux.",
  "Chaque journée compte.",
]

const GROUP_ICONS = [SketchFootball, SketchPeople, SketchTactics]

function taglineForGroup(id: string) {
  return GROUP_TAGLINES[hashGroupId(id) % GROUP_TAGLINES.length]
}

function iconForGroup(id: string) {
  return GROUP_ICONS[hashGroupId(id) % GROUP_ICONS.length]
}

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

function periodKeyForGroup(periodType: string, periodCustomDays: number | null) {
  const match = PERIOD_OPTIONS.find(
    (o) => o.period_type === periodType && (o.period_custom_days ?? null) === (periodCustomDays ?? null)
  )
  return match ? match.key : PERIOD_OPTIONS[0].key
}

export default function Groups({ onSelectGroup }: Props) {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // nombre de membres par groupe (id -> total), affiché sur chaque carte —
  // un seul aller-retour supplémentaire pour tous les groupes plutôt qu'une
  // requête par groupe
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [periodKey, setPeriodKey] = useState(PERIOD_OPTIONS[0].key)
  const [creating, setCreating] = useState(false)

  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  const [showRules, setShowRules] = useState(false)

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editPeriodKey, setEditPeriodKey] = useState(PERIOD_OPTIONS[0].key)
  const [savingPeriod, setSavingPeriod] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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
      const rows = (data as unknown as Membership[]) ?? []
      setMemberships(rows)

      const groupIds = rows.map((m) => m.groups.id)
      if (groupIds.length > 0) {
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('group_id')
          .in('group_id', groupIds)
        const counts: Record<string, number> = {}
        for (const r of (memberRows ?? []) as { group_id: string }[]) {
          counts[r.group_id] = (counts[r.group_id] ?? 0) + 1
        }
        setMemberCounts(counts)
      } else {
        setMemberCounts({})
      }
    }
    setLoading(false)
  }

  // Copie le code d'invitation dans le presse-papier — silencieusement
  // ignoré si l'API n'est pas disponible (contexte non sécurisé, vieux
  // navigateur...) : le code reste de toute façon visible et copiable à la
  // main dans ce cas.
  const copyInviteCode = async (code: string, e: MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      window.setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500)
    } catch {
      // ignoré
    }
  }

  // Lien d'invitation (partage natif ou copie, voir invite.ts)
  const [sharedCode, setSharedCode] = useState<string | null>(null)
  const handleShareInvite = async (name: string, code: string) => {
    const result = await shareInvite(name, code)
    if (result === 'copied') {
      setSharedCode(code)
      window.setTimeout(() => setSharedCode((c) => (c === code ? null : c)), 2000)
    }
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

  const openPeriodEditor = (group: GroupRow) => {
    setDeleteConfirmId(null)
    setEditingGroupId(group.id)
    setEditPeriodKey(periodKeyForGroup(group.period_type, group.period_custom_days))
  }

  const handleSavePeriod = async (groupId: string) => {
    setError(null)
    setSavingPeriod(true)

    const option = PERIOD_OPTIONS.find((o) => o.key === editPeriodKey) ?? PERIOD_OPTIONS[0]

    const { error: updateError } = await supabase.rpc('update_group_period', {
      p_group_id: groupId,
      p_period_type: option.period_type,
      p_period_custom_days: option.period_custom_days,
    })

    if (updateError) {
      setError(updateError.message)
      setSavingPeriod(false)
      return
    }

    setEditingGroupId(null)
    setSavingPeriod(false)
    await fetchGroups()
  }

  const handleDeleteGroup = async (groupId: string) => {
    setError(null)
    setDeleting(true)

    const { error: deleteError } = await supabase.rpc('delete_group', {
      p_group_id: groupId,
    })

    if (deleteError) {
      setError(deleteError.message)
      setDeleting(false)
      return
    }

    setDeleteConfirmId(null)
    setDeleting(false)
    await fetchGroups()
  }

  if (showRules) {
    return <Rules onBack={() => setShowRules(false)} />
  }

  return (
    <div className="groups-screen">
      <div className="groups-hero">
        <h2 className="groups-hero-title">Mes groupes</h2>
        <Squiggle className="groups-hero-underline" width={90} />
        <p className="groups-hero-subtitle">Organise tes matchs, retrouve tes potes, et fais vivre le foot ensemble.</p>
      </div>

      <div className="groups-actions">
        <button
          className="groups-action-btn groups-action-btn-hero"
          onClick={() => {
            setShowCreate((v) => !v)
            setShowJoin(false)
          }}
        >
          <span className="groups-action-btn-hero-icon">+</span>
          <span className="groups-action-btn-hero-text">
            <span className="groups-action-btn-hero-label">Créer un groupe</span>
            <span className="groups-action-btn-hero-sub">Lance ton équipe</span>
          </span>
        </button>
        <button
          className="groups-action-btn groups-action-btn-secondary groups-action-btn-hero"
          onClick={() => {
            setShowJoin((v) => !v)
            setShowCreate(false)
          }}
        >
          <span className="groups-action-btn-hero-icon">👥</span>
          <span className="groups-action-btn-hero-text">
            <span className="groups-action-btn-hero-label">Rejoindre un groupe</span>
            <span className="groups-action-btn-hero-sub">Avec un code</span>
          </span>
        </button>
      </div>

      <button className="groups-rules-btn" onClick={() => setShowRules(true)}>
        <span>📖 Règles du jeu</span>
        <span className="groups-rules-btn-chevron">›</span>
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
        <LoadingSkeleton rows={3} />
      ) : memberships.length === 0 ? (
        <p className="groups-empty">Tu n'as pas encore de groupe. Crée-en un ou rejoins-en un avec un code.</p>
      ) : (
        <ul className="groups-list">
          {memberships.map((m) => {
            const GroupIcon = iconForGroup(m.groups.id)
            const memberCount = memberCounts[m.groups.id]
            return (
              <li
                className="groups-card groups-card-clickable"
                key={m.groups.id}
                onClick={() => onSelectGroup(m.groups.id, m.groups.name)}
              >
                <div className="groups-card-icon-badge">
                  <GroupIcon size={24} />
                </div>
                <div className="groups-card-body">
                  <div className="groups-card-top">
                    <span className="groups-card-name">{m.groups.name}</span>
                    <div className="groups-card-top-right">
                      <span className="groups-card-role">{m.role === 'owner' ? '👑 Propriétaire' : 'Membre'}</span>
                      <span className="groups-card-chevron">›</span>
                    </div>
                  </div>
                  <div className="groups-card-meta">
                    <span>📅 Période : {formatPeriod(m.groups.period_type, m.groups.period_custom_days)}</span>
                    <span className="groups-card-meta-sep">·</span>
                    <span>👥 {memberCount ?? '…'} membre{memberCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="groups-card-invite">
                    <span className="groups-card-invite-label">Code d'invitation</span>
                    <div className="groups-card-invite-row" onClick={(e) => e.stopPropagation()}>
                      <code>{m.groups.invite_code}</code>
                      <button
                        type="button"
                        className="groups-card-copy-btn"
                        onClick={(e) => copyInviteCode(m.groups.invite_code, e)}
                        title="Copier le code"
                      >
                        {copiedCode === m.groups.invite_code ? '✓' : '📋'}
                      </button>
                      <button
                        type="button"
                        className="groups-card-share-btn"
                        onClick={(e) => { e.stopPropagation(); handleShareInvite(m.groups.name, m.groups.invite_code) }}
                      >
                        {sharedCode === m.groups.invite_code ? 'Lien copié ✓' : '📤 Inviter'}
                      </button>
                    </div>
                  </div>
                  {m.role === 'owner' && (
                    <div className="groups-card-owner-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="groups-card-action-btn"
                        onClick={() => openPeriodEditor(m.groups)}
                      >
                        ⚙️ Modifier la durée
                      </button>
                      {deleteConfirmId === m.groups.id ? (
                        <>
                          <span className="groups-delete-confirm-text">Supprimer définitivement ?</span>
                          <button
                            type="button"
                            className="groups-card-action-btn groups-card-action-danger"
                            onClick={() => handleDeleteGroup(m.groups.id)}
                            disabled={deleting}
                          >
                            {deleting ? '...' : 'Oui, supprimer'}
                          </button>
                          <button
                            type="button"
                            className="groups-card-action-btn"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Annuler
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="groups-card-action-btn groups-card-action-danger"
                          onClick={() => setDeleteConfirmId(m.groups.id)}
                        >
                          🗑️ Supprimer
                        </button>
                      )}
                    </div>
                  )}
                  {editingGroupId === m.groups.id && (
                    <div className="groups-card-period-editor" onClick={(e) => e.stopPropagation()}>
                      <div className="groups-card-period-label">Nouvelle durée :</div>
                      <div className="groups-period-options">
                        {PERIOD_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className={
                              option.key === editPeriodKey
                                ? 'groups-card-period-btn groups-card-period-btn-active'
                                : 'groups-card-period-btn'
                            }
                            onClick={() => setEditPeriodKey(option.key)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="groups-card-owner-actions">
                        <button
                          type="button"
                          className="groups-card-action-btn groups-card-action-primary"
                          onClick={() => handleSavePeriod(m.groups.id)}
                          disabled={savingPeriod}
                        >
                          {savingPeriod ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                        <button
                          type="button"
                          className="groups-card-action-btn"
                          onClick={() => setEditingGroupId(null)}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="groups-card-tagline">« {taglineForGroup(m.groups.id)} »</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
