import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Annonces affichées une seule fois par joueur (mémorisé en base, donc pas
// revues sur un autre téléphone), à la prochaine ouverture de l'appli.
// Pour une nouvelle annonce : ajouter une clé et son contenu.
const PODIUM_KEY = 'podium-jeu-semaine-2026-10'
const BAREME_KEY = 'bareme-pronos-2026-10'
const SHOW_UNTIL = new Date('2026-10-26T00:00:00+01:00')

function BaremeLine() {
  return (
    <p>
      ⚽ <b>Pronos</b> : la règle du « bon écart de buts » est supprimée. Score exact = <b>5 points</b>, bon résultat = <b>3 points</b>.
    </p>
  )
}

export default function Announcement({ userId }: { userId: string | null | undefined }) {
  // annonce à montrer : le podium (avec la ligne du barème) ou le barème seul
  const [which, setWhich] = useState<'podium' | 'bareme' | null>(null)

  useEffect(() => {
    if (!userId || Date.now() > SHOW_UNTIL.getTime()) return
    let cancelled = false
    supabase.from('announcements_seen').select('key').eq('profile_id', userId).in('key', [PODIUM_KEY, BAREME_KEY])
      .then(({ data, error }) => {
        if (cancelled || error) return
        const seen = new Set((data ?? []).map((r: { key: string }) => r.key))
        if (!seen.has(PODIUM_KEY)) setWhich('podium')
        else if (!seen.has(BAREME_KEY)) setWhich('bareme')
      })
    return () => { cancelled = true }
  }, [userId])

  if (!which || !userId) return null
  const close = () => {
    const keys = which === 'podium' ? [PODIUM_KEY, BAREME_KEY] : [BAREME_KEY]
    setWhich(null)
    supabase.from('announcements_seen').upsert(keys.map((key) => ({ profile_id: userId, key })), { onConflict: 'profile_id,key', ignoreDuplicates: true }).then(() => {})
  }

  if (which === 'bareme') {
    return (
      <div className="bonus-target-overlay announcement-overlay">
        <div className="bonus-target-modal announcement-modal" role="dialog" aria-modal="true">
          <h3>⚽ Changement dans les pronos</h3>
          <p>La règle du « bon écart de buts » est supprimée, à partir de la journée 7 :</p>
          <ul className="announcement-podium">
            <li>🎯 <b>Score exact</b> : 5 points</li>
            <li>✅ <b>Bon résultat</b> (victoire / nul / défaite) : 3 points</li>
            <li>❌ Rien de bon : 0 point</li>
          </ul>
          <p className="announcement-small">Les matchs déjà joués gardent leurs points. Le bon buteur rapporte toujours +1 et le Joker double toujours tes points.</p>
          <button className="announcement-cta" onClick={close}>Compris !</button>
        </div>
      </div>
    )
  }

  return (
    <div className="bonus-target-overlay announcement-overlay">
      <div className="bonus-target-modal announcement-modal" role="dialog" aria-modal="true">
        <h3>🏆 Nouveau : un podium au jeu de la semaine !</h3>
        <p>Yoann est trop fort, alors pour vous laisser une chance on récompense désormais les 3 premiers 😏</p>
        <ul className="announcement-podium">
          <li>🥇 <b>1er</b> : 3 points + 2 🪙</li>
          <li>🥈 <b>2e</b> : 2 points + 1 🪙</li>
          <li>🥉 <b>3e</b> : 1 point</li>
        </ul>
        <p>C'est ton <b>meilleur score de la semaine</b> qui compte, alors rejoue autant que tu veux pour monter sur le podium !</p>
        <p className="announcement-small">Il faut au moins 3 joueurs dans le groupe pour une 2e place, et 4 pour une 3e.</p>
        <div className="announcement-more">
          <b>Aussi nouveau :</b>
          <BaremeLine />
          <p>👀 Regarde tes potes jouer au toro en direct et réagis avec des emoji 🔥😂👏</p>
          <p>🤝 Les duos du week-end sont maintenant équilibrés selon le classement</p>
        </div>
        <button className="announcement-cta" onClick={close}>C'est parti !</button>
      </div>
    </div>
  )
}
