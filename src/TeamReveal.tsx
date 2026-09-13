import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

interface Team {
  api_team_id: number
  name: string
}

interface Props {
  groupId: string
  groupName: string
  onDone: () => void
}

// Écran affiché une seule fois, la toute première fois qu'un membre entre
// dans un groupe : explique qu'une équipe de Ligue 1 lui a été attribuée au
// hasard, puis mime une "roulette" qui s'arrête sur cette équipe (déjà
// tirée côté serveur par ensure_team_assignment lors de l'inscription/du
// join, avant même que ce composant ne s'affiche).
export default function TeamReveal({ groupId, groupName, onDone }: Props) {
  const { user } = useAuth()
  const [myTeam, setMyTeam] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [spinLabel, setSpinLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
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
        if (!cancelled) setLoading(false)
        return
      }

      const { data: assign } = await supabase
        .from('team_assignments')
        .select('team_name')
        .eq('group_id', groupId)
        .eq('period_id', period.id)
        .eq('profile_id', user.id)
        .maybeSingle()

      if (cancelled) return
      setMyTeam(assign?.team_name ?? null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [groupId, user])

  const finishAndContinue = async () => {
    if (user) {
      await supabase.rpc('mark_team_reveal_seen', { p_group_id: groupId })
    }
    onDone()
  }

  const spin = async () => {
    if (!myTeam) return
    setSpinning(true)

    const { data: allTeams } = await supabase.from('ligue1_teams').select('api_team_id, name')
    const pool: Team[] = (allTeams && allTeams.length > 0) ? allTeams : [{ api_team_id: 0, name: myTeam }]

    let count = 0
    const spinInterval = setInterval(() => {
      const r = pool[Math.floor(Math.random() * pool.length)]
      setSpinLabel(r.name)
      count++
      if (count > 14) {
        clearInterval(spinInterval)
        setSpinLabel(myTeam)
        setSpinning(false)
        setRevealed(true)
      }
    }, 90)
  }

  return (
    <div className="team-reveal-screen">
      <div className="team-reveal-card">
        <span className="team-reveal-emoji">🎉</span>
        <h2 className="team-reveal-title">Bienvenue dans {groupName} !</h2>

        {loading ? (
          <p className="groups-loading">Chargement...</p>
        ) : !myTeam ? (
          <>
            <p className="team-reveal-text">
              Ton équipe n'a pas encore pu être tirée au sort (aucune période en cours). Pas de souci,
              tu pourras la découvrir depuis l'onglet Jeux dès qu'une période sera ouverte.
            </p>
            {error && <p className="groups-error">{error}</p>}
            <button className="dash-cta-btn" onClick={finishAndContinue}>
              Continuer →
            </button>
          </>
        ) : (
          <>
            <p className="team-reveal-text">
              Dans ce groupe, chaque joueur se voit attribuer au hasard une équipe de Ligue 1 pour
              toute la période en cours. C'est <b>ta</b> équipe : elle te rapporte des points bonus
              quand elle gagne, en plus de tes pronostics. Fais tourner la roue pour découvrir
              laquelle est tombée sur toi !
            </p>
            {error && <p className="groups-error">{error}</p>}
            <div className="roulette-result">
              {spinning ? (
                <div className="roulette-team-badge roulette-spinning">{spinLabel || '...'}</div>
              ) : revealed ? (
                <div className="roulette-team-badge">{spinLabel}</div>
              ) : (
                <button className="match-save-btn roulette-btn" onClick={spin}>
                  🎰 Lancer la roue
                </button>
              )}
            </div>
            {revealed && (
              <button className="dash-cta-btn" onClick={finishAndContinue}>
                Continuer →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
