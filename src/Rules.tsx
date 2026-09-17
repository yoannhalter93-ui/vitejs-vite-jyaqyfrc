interface Props {
  onBack: () => void
}

export default function Rules({ onBack }: Props) {
  return (
    <div className="rules-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>
          ← Groupes
        </button>
        <h2>Règles du jeu</h2>
      </div>
      <p className="predictions-period">
        Comment marchent les pronos, les mini-jeux et les points, en résumé.
      </p>

      <div className="rules-section">
        <h3 className="rules-section-title">⚽ Pronostics</h3>
        <p className="rules-section-text">
          Chaque période, des vrais matchs de Ligue 1 sont ouverts aux pronos. Donne un score avant le coup d'envoi. Une fois le match terminé :
        </p>
        <ul className="rules-points">
          <li>Score exact — 5 points</li>
          <li>Bon écart de buts et bon résultat — 4 points</li>
          <li>Juste le bon résultat, victoire/nul/défaite — 3 points</li>
          <li>Rien de bon — 0 point</li>
        </ul>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🏆 Classement</h3>
        <p className="rules-section-text">
          Le total de tous les points gagnés dans le groupe sur la période en cours, tous modes de jeu confondus.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🎡 Mon équipe</h3>
        <p className="rules-section-text">
          Dès que tu rejoins ou crées un groupe, une équipe de Ligue 1 t'est attribuée au hasard pour la période en cours — impossible d'y échapper. Seuls les matchs joués depuis le début de la période comptent :
        </p>
        <ul className="rules-points">
          <li>Ton équipe gagne — +1 point</li>
          <li>Elle fait match nul — 0 point</li>
          <li>Elle perd — -1 point</li>
        </ul>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🥅 Duel de pénalités</h3>
        <p className="rules-section-text">
          Chaque semaine, un adversaire du groupe t'est tiré au sort automatiquement — jamais deux fois la même personne tant que tu n'as pas croisé tout le monde. Chacun tire 3 penaltys sur l'autre, dans n'importe quel ordre : pas besoin d'attendre ton tour, tire quand tu veux, et dès que ton adversaire a tiré les siens tu peux deviner où il a visé. Le tireur vise une zone, le gardien plonge sans savoir laquelle :
        </p>
        <ul className="rules-points">
          <li>But au milieu — 2 points du duel</li>
          <li>But dans un coin — 1 point du duel</li>
          <li>Arrêté — 0 point du duel</li>
        </ul>
        <p className="rules-section-text">
          Celui qui totalise le plus de points sur les 6 tirs gagne le duel — ces points ne servent qu'à ça. Au classement général, seul le résultat du duel compte :
        </p>
        <ul className="rules-points">
          <li>Victoire — 3 points</li>
          <li>Match nul — 1 point</li>
          <li>Défaite — 0 point</li>
        </ul>
        <p className="rules-section-text">
          Le gagnant remporte aussi 1 🪙 jeton.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">❓ Questionnaire</h3>
        <p className="rules-section-text">
          Chaque semaine, un adversaire du groupe t'est tiré au sort automatiquement — jamais deux fois la même personne tant que tu n'as pas croisé tout le monde. Duel à 10 questions, 10 secondes pour répondre à chacune. Celui qui a le plus de bonnes réponses gagne :
        </p>
        <ul className="rules-points">
          <li>Victoire — 3 points</li>
          <li>Match nul — 1 point</li>
          <li>Défaite — 0 point</li>
        </ul>
        <p className="rules-section-text">
          Le vainqueur remporte aussi 1 🪙 jeton.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🤝 Paris libres</h3>
        <p className="rules-section-text">
          N'importe qui propose un pari « oui / non » avec une deadline, et les membres votent avant l'échéance (il faut qu'au moins la moitié du groupe vote, sinon le pari est annulé). Plus un camp est minoritaire, plus il rapporte de points. Une fois la deadline passée, c'est l'auteur du pari — et lui seul — qui confirme ce qui s'est vraiment passé. S'il ne confirme pas à temps, ou en cas de litige, un owner/admin du groupe tranche à sa place. Les gagnants empochent les points de la cote, doublés avec le bonus « Double ou rien ».
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🎯 Pari du 1er but</h3>
        <p className="rules-section-text">
          Deux vrais matchs de Ligue 1 mis en avant chaque semaine, les mêmes pour tout le groupe. Sur chacun, avant le coup d'envoi, tu fais 2 pronostics indépendants : quelle équipe (domicile ou extérieur) va marquer le premier but, et à quelle minute — ou tu choisis Aucun but si tu penses à un 0-0. Chaque match se verrouille séparément à son coup d'envoi : rater le premier n'empêche pas de jouer le second.
        </p>
        <ul className="rules-points">
          <li>Bonne équipe — 5 points</li>
          <li>Mauvaise équipe — 0 point</li>
          <li>Minute exacte — 10 points</li>
          <li>Écart de 1 à 45 minutes — de 9 à 1 point, dégressif par tranches de 5 min</li>
          <li>Écart de plus de 45 minutes — 0 point</li>
        </ul>
        <p className="rules-section-text">
          Les deux se cumulent et comptent indépendamment : même en te trompant d'équipe, tu marques quand même les points de la minute. 15 points max par match, 30 sur les 2 matchs de la semaine. Aucun but deviné juste sur un vrai 0-0 rapporte 15 points d'un coup ; s'il y a eu un but, Aucun but ne rapporte rien.
        </p>
        <p className="rules-section-text">
          Comme pour le Jeu de la semaine, seul le meilleur total du groupe sur les 2 matchs remporte la récompense du classement général : 3 points et 2 🪙 jetons. En cas d'égalité, c'est le plus petit écart cumulé sur les minutes pronostiquées qui départage ; à égalité parfaite, la victoire est partagée entre tous les joueurs encore à égalité.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🎮 Jeu de la semaine</h3>
        <p className="rules-section-text">
          Mini-jeu solo, un différent chaque semaine — jonglage ou dribble :
        </p>
        <ul className="rules-points">
          <li>🤹 Jonglage — garde les ballons en l'air en tapant dessus au bon moment. Pas de chrono : un 2e ballon entre en jeu au bout de 30 secondes, un 3e au bout d'une minute, et la partie s'arrête dès qu'un seul ballon touche le sol.</li>
          <li>⚽ Dribble — des défenseurs descendent sur le terrain, ◀ / ▶ pour changer de couloir et les éviter. Certains sont plus rapides ou plongent au dernier moment, et quand les 3 couloirs se bloquent d'un coup, il faut déclencher le dribble 🌀 au bon moment pour passer en force.</li>
        </ul>
        <p className="rules-section-text">
          Chaque semaine, le meilleur score du groupe au jeu du moment rapporte 3 points au classement et 2 🪙 jetons à son auteur (en cas d'égalité au sommet, tous les joueurs à égalité gagnent).
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🪙 Les jetons</h3>
        <p className="rules-section-text">
          Tu gagnes des jetons en remportant un Duel de pénalités ou un Quiz, +1 à chaque victoire. Dépense-les depuis le badge 🪙 en haut d'un groupe :
        </p>
        <ul className="rules-points">
          <li>Échange d'équipe (3🪙) — échange ton équipe attitrée avec celle d'un adversaire</li>
          <li>Retirage forcé (2🪙) — force un adversaire à retirer une nouvelle équipe au hasard</li>
          <li>Bonus inversé (3🪙) — inverse les points d'une équipe attitrée pour le reste de la période, victoire = points en moins et défaite = points en plus ; sur toi-même ou sur un adversaire</li>
          <li>Double ou rien (2🪙) — double les points d'un pari libre si tu gagnes</li>
        </ul>
      </div>
    </div>
  )
}
