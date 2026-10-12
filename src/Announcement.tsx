import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Annonces affichées une seule fois par joueur (mémorisé en base, donc pas
// revues sur un autre téléphone), à la prochaine ouverture de l'appli.
// Pour une nouvelle annonce : ajouter une clé et son contenu.
const PODIUM_KEY = 'podium-jeu-semaine-2026-10'
const BAREME_KEY = 'bareme-pronos-2026-10'
const SHOW_UNTIL = new Date('2026-10-26T00:00:00+01:00')
// barème « Mon équipe » +3 / +1 / 0 : pour fermer, le joueur doit donner
// son avis (👍 / 👎, colonne announcements_seen.vote)
export const EQUIPE_KEY = 'equipe-3-1-0-2026-10'
const EQUIPE_UNTIL = new Date('2026-11-16T00:00:00+01:00')

function BaremeLine() {
  return (
    <p>
      ⚽ <b>Pronos</b> : la règle du « bon écart de buts » est supprimée. Score exact = <b>5 points</b>, bon résultat = <b>3 points</b>.
    </p>
  )
}

export default function Announcement({ userId }: { userId: string | null | undefined }) {
  // annonce à montrer : le podium (avec la ligne du barème) ou le barème seul
  const [which, setWhich] = useState<'equipe' | 'podium' | 'bareme' | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.from('announcements_seen').select('key').eq('profile_id', userId).in('key', [EQUIPE_KEY, PODIUM_KEY, BAREME_KEY])
      .then(({ data, error }) => {
        if (cancelled || error) return
        const seen = new Set((data ?? []).map((r: { key: string }) => r.key))
        const now = Date.now()
        if (!seen.has(EQUIPE_KEY) && now < EQUIPE_UNTIL.getTime()) setWhich('equipe')
        else if (now > SHOW_UNTIL.getTime()) return
        else if (!seen.has(PODIUM_KEY)) setWhich('podium')
        else if (!seen.has(BAREME_KEY)) setWhich('bareme')
      })
    return () => { cancelled = true }
  }, [userId])

  if (!which || !userId) return null

  if (which === 'equipe') {
    const vote = (v: 1 | -1) => {
      setWhich(null)
      supabase.from('announcements_seen')
        .upsert({ profile_id: userId, key: EQUIPE_KEY, vote: v }, { onConflict: 'profile_id,key', ignoreDuplicates: true })
        .then(() => {})
    }
    return (
      <div className="bonus-target-overlay announcement-overlay">
        <div className="bonus-target-modal announcement-modal" role="dialog" aria-modal="true">
          <h3>🎡 Mon équipe : nouveau barème !</h3>
          <p>Ton équipe de Ligue 1 tirée au sort rapporte maintenant <b>beaucoup plus</b>, comme au vrai foot :</p>
          <table className="announcement-compare">
            <thead>
              <tr><th></th><th>Avant</th><th>Maintenant</th></tr>
            </thead>
            <tbody>
              <tr><td>✅ Victoire</td><td>+1</td><td><b>+3</b></td></tr>
              <tr><td>🤝 Nul</td><td>0</td><td><b>+1</b></td></tr>
              <tr><td>❌ Défaite</td><td>−1</td><td><b>0</b></td></tr>
            </tbody>
          </table>
          <p className="announcement-small">À partir de la journée 7. Plus de points négatifs. Les points déjà gagnés ne changent pas.</p>
          <div className="announcement-more">
            <b>🪙 Tes jetons rebattent les cartes :</b>
            <p>🔄 <b>Échange d'équipe</b> (3🪙) : ton équipe est nulle ? Pique celle d'un pote !</p>
            <p>🎰 <b>Retirage forcé</b> (2🪙) : fais retirer au sort l'équipe d'un pote qui a trop de chance.</p>
            <p>🔃 <b>Bonus inversé</b> (3🪙) : les victoires de son équipe ne lui rapportent plus rien et ses défaites lui donnent +3 😈 Ça le suit même s'il change d'équipe. Tu es inversé ? Mets-toi le bonus pour l'annuler.</p>
            <p>🛡️ <b>Bouclier</b> (2🪙) : bloque le prochain bonus lancé contre toi.</p>
          </div>
          <p className="announcement-vote-q">Alors, cette nouvelle règle, t'en penses quoi ?</p>
          <div className="announcement-vote">
            <button className="announcement-vote-btn" onClick={() => vote(1)} aria-label="J'aime">👍</button>
            <button className="announcement-vote-btn" onClick={() => vote(-1)} aria-label="Je n'aime pas">👎</button>
          </div>
        </div>
      </div>
    )
  }
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
