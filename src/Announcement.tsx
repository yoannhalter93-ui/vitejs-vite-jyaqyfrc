import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Annonce affichée une seule fois par joueur (mémorisée en base, donc pas
// revue sur un autre téléphone), à la prochaine ouverture de l'appli.
// Pour une nouvelle annonce : changer ANNOUNCEMENT_KEY et le contenu.
const ANNOUNCEMENT_KEY = 'podium-jeu-semaine-2026-10'
const SHOW_UNTIL = new Date('2026-10-26T00:00:00+01:00')

export default function Announcement({ userId }: { userId: string | null | undefined }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!userId || Date.now() > SHOW_UNTIL.getTime()) return
    let cancelled = false
    supabase.from('announcements_seen').select('key').eq('profile_id', userId).eq('key', ANNOUNCEMENT_KEY).maybeSingle()
      .then(({ data, error }) => { if (!cancelled && !error && !data) setOpen(true) })
    return () => { cancelled = true }
  }, [userId])

  if (!open || !userId) return null
  const close = () => {
    setOpen(false)
    supabase.from('announcements_seen').insert({ profile_id: userId, key: ANNOUNCEMENT_KEY }).then(() => {})
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
          <p>👀 Regarde tes potes jouer au toro en direct et réagis avec des emoji 🔥😂👏</p>
          <p>🤝 Les duos du week-end sont maintenant équilibrés selon le classement</p>
        </div>
        <button className="announcement-cta" onClick={close}>C'est parti !</button>
      </div>
    </div>
  )
}
