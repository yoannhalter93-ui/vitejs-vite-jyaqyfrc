interface Props {
  onBack: () => void
  backLabel?: string
}

export default function Rules({ onBack, backLabel = 'Groupes' }: Props) {
  return (
    <div className="rules-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <h2>Règles du jeu</h2>
      </div>
      <p className="predictions-period">
        Comment marchent les pronos, les mini-jeux et les points. Appuie sur un titre pour ouvrir la règle.
      </p>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">⚽ Pronostics</summary>
        <p className="rules-section-text">
          Chaque période, des vrais matchs de Ligue 1 sont ouverts aux pronos. Donne un score avant le coup d'envoi. Une fois le match terminé :
        </p>
        <ul className="rules-points">
          <li>Score exact — 5 points</li>
          <li>Bon écart de buts et bon résultat — 4 points</li>
          <li>Juste le bon résultat, victoire/nul/défaite — 3 points</li>
          <li>Rien de bon — 0 point</li>
        </ul>
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🏆 Classement</summary>
        <p className="rules-section-text">
          Le total de tous les points gagnés dans le groupe sur la période en cours, tous modes de jeu confondus. Chaque jeu a son onglet dans le classement ; voici ce que chacun rapporte :
        </p>
        <ul className="rules-points">
          <li>⚽ Pronostics — score exact 5 pts, bon écart 4 pts, bon résultat 3 pts, sinon 0 (doublés avec un Joker ou sur un match ×2)</li>
          <li>🎡 Mon équipe — à chacun de ses matchs : victoire +1, nul 0, défaite -1</li>
          <li>🥅 Duels (penaltys et quiz) — victoire 3 pts (+1 🪙), nul 1 pt, défaite 0</li>
          <li>🎮 Mini-jeux — meilleur score du groupe au jeu de la semaine : 3 pts (+2 🪙)</li>
          <li>🤝 Paris libres — le bon camp gagne les points de la cote (plus il était minoritaire, plus ça rapporte)</li>
          <li>🎉 Événements — le gagnant du Total de buts, du Duo du week-end ou du But en or : 3 pts (+2 🪙) ; la Journée x2 double tes pronos</li>
        </ul>
        <p className="rules-section-text">
          Le détail de chaque jeu est dans sa règle ci-dessous.
        </p>
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🎡 Mon équipe</summary>
        <p className="rules-section-text">
          Dès que tu rejoins ou crées un groupe, une équipe de Ligue 1 t'est attribuée au hasard pour la période en cours — impossible d'y échapper. Seuls les matchs joués depuis le début de la période comptent :
        </p>
        <ul className="rules-points">
          <li>Ton équipe gagne — +1 point</li>
          <li>Elle fait match nul — 0 point</li>
          <li>Elle perd — -1 point</li>
        </ul>
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🥅 Duel de pénalités</summary>
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
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">❓ Questionnaire</summary>
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
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🤝 Paris libres</summary>
        <p className="rules-section-text">
          N'importe qui propose un pari « oui / non » avec une deadline, et les membres votent avant l'échéance (il faut qu'au moins la moitié du groupe vote, sinon le pari est annulé). Plus un camp est minoritaire, plus il rapporte de points. Une fois la deadline passée, c'est l'auteur du pari — et lui seul — qui confirme ce qui s'est vraiment passé. S'il ne confirme pas à temps, ou en cas de litige, un owner/admin du groupe tranche à sa place. Les gagnants empochent les points de la cote, doublés avec le bonus « Double ou rien ».
        </p>
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🎉 Événements de journée</summary>
        <p className="rules-section-text">
          Certaines journées de Ligue 1, un événement est lancé en plus du reste (une bannière apparaît sur l'accueil et tout le monde reçoit une notification) :
        </p>
        <ul className="rules-points">
          <li>🔥 Journée x2 — tous les pronos de la journée comptent double. Le Joker n'est pas utilisable sur ces matchs.</li>
          <li>⚽ Total de buts — devine combien de buts seront marqués sur toute la journée, avant le premier coup d'envoi. Le plus proche du groupe gagne 3 points + 2 🪙.</li>
          <li>🤝 Duo du week-end — des binômes sont tirés au sort dans le groupe (un trio si le groupe est impair). Il faut au moins 4 joueurs dans le groupe : en dessous, l'événement ne s'applique pas. Chaque équipe marque la moyenne des points de pronos de ses joueurs sur la journée ; la meilleure équipe gagne 3 points + 2 🪙 par joueur.</li>
          <li>🎯 But en or — devine l'équipe et la minute du 1er but sur 2 grosses affiches de la journée (détail juste en dessous).</li>
        </ul>
        <h4 className="rules-subtitle">🎯 But en or : le détail</h4>
        <p className="rules-section-text">
          Deux grosses affiches de la journée sont mises en avant, les mêmes pour tout le monde. Sur chacun des 2 matchs, avant le coup d'envoi, tu fais 2 pronostics indépendants : quelle équipe (domicile ou extérieur) va marquer le premier but, et à quelle minute exacte — glisse le ⚽ sur la barre, de 0 à 95 (le +5 couvre le temps additionnel) — ou tu choisis Aucun but si tu penses à un 0-0. Chaque match se verrouille séparément à son coup d'envoi : rater le premier n'empêche pas de jouer le second.
        </p>
        <ul className="rules-points">
          <li>Bonne équipe — 5 points</li>
          <li>Mauvaise équipe — 0 point</li>
          <li>Minute exacte — 10 points</li>
          <li>Écart de 1 à 45 minutes — de 9 à 1 point, dégressif par tranches de 5 min</li>
          <li>Écart de plus de 45 minutes — 0 point</li>
        </ul>
        <p className="rules-section-text">
          L'écart se calcule directement entre la minute choisie sur la barre et la vraie minute du but. Les deux se cumulent et comptent indépendamment : même en te trompant d'équipe, tu marques quand même les points de la minute. 15 points max par match, 30 sur les 2 matchs. Aucun but deviné juste sur un vrai 0-0 rapporte 15 points d'un coup ; s'il y a eu un but, Aucun but ne rapporte rien.
        </p>
        <p className="rules-section-text">
          Seul le meilleur total du groupe sur les 2 matchs remporte la récompense du classement général : 3 points et 2 🪙 jetons. En cas d'égalité, c'est le plus petit écart cumulé sur les minutes pronostiquées qui départage ; à égalité parfaite, la victoire est partagée entre tous les joueurs encore à égalité.
        </p>
        <p className="rules-section-text">
          Un 3e match peut s'y ajouter : celui-là se parie normalement dans Pronostics (score exact, bon écart, bon résultat), rien ne change — sauf que les points qu'il rapporte comptent double au classement général. Il est repéré par un badge « x2 » dans Pronostics (pas de Joker possible dessus).
        </p>
      </details>


      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🎮 Jeu de la semaine</summary>
        <p className="rules-section-text">
          Une seule case dans les mini-jeux, mais son contenu change chaque semaine — jonglage, dribble, coup franc ou toro :
        </p>
        <ul className="rules-points">
          <li>🤹 Jonglage — garde les ballons en l'air en tapant dessus au bon moment. Pas de chrono : un 2e ballon entre en jeu au bout de 30 secondes, un 3e au bout d'une minute, et la partie s'arrête dès qu'un seul ballon touche le sol.</li>
          <li>⚽ Dribble — des défenseurs descendent sur le terrain, ◀ / ▶ pour changer de couloir et les éviter. Certains sont plus rapides ou plongent au dernier moment, et quand les 3 couloirs se bloquent d'un coup, il faut déclencher le dribble 🌀 au bon moment pour passer en force.</li>
          <li>🥅 Coup franc — glisse du ballon vers l'endroit du but visé, en arc pour donner de l'effet et contourner le mur, ou sous la ligne de but pour une frappe à ras de terre (qui passe sous le mur quand il saute). But = 1 point, lucarne = 2 points, la série s'arrête au premier raté. Plus tu marques, plus c'est loin et plus le gardien est vif.</li>
          <li>🐂 Le toro — tes 6 joueurs en cercle, un taureau au milieu : tape un coéquipier pour lui passer le ballon (tape le suivant pendant que le ballon roule et il le remet en une touche). Si le taureau touche le porteur ou coupe une passe, c'est fini. 1 point par passe, +2 pour une passe entre les deux taureaux (petit pont). Le taureau accélère toutes les 6 passes, un 2e arrive à 12 passes, et à 45 passes un 3e taureau entre et ils deviennent malins : ils repèrent tes habitudes, feintent et tendent des pièges, et après 50 passes ils accélèrent encore un peu à chaque passe. Tes potes peuvent te regarder jouer en direct (👀 Regarder) et te chambrer 😜 : ton écran tremble et un taureau de plus entre dans le cercle pendant 7 secondes (un chambrage toutes les 20 s au plus).</li>
        </ul>
        <p className="rules-section-text">
          Chaque semaine, le meilleur score du groupe au jeu du moment rapporte 3 points au classement et 2 🪙 jetons à son auteur (en cas d'égalité au sommet, tous les joueurs à égalité gagnent).
        </p>
      </details>

      <details className="rules-section" name="regles">
        <summary className="rules-section-title">🪙 Les jetons</summary>
        <p className="rules-section-text">
          Tu gagnes des jetons en remportant un Duel de pénalités ou un Quiz, +1 à chaque victoire. Dépense-les depuis le badge 🪙 en haut d'un groupe :
        </p>
        <ul className="rules-points">
          <li>Échange d'équipe (3🪙) — échange ton équipe attitrée avec celle d'un adversaire</li>
          <li>Retirage forcé (2🪙) — force un adversaire à retirer une nouvelle équipe au hasard</li>
          <li>Bonus inversé (3🪙) — inverse les points d'une équipe attitrée pour le reste de la période, victoire = points en moins et défaite = points en plus ; sur toi-même ou sur un adversaire</li>
          <li>Double ou rien (2🪙) — double les points d'un pari libre si tu gagnes</li>
          <li>Joker ×2 (3🪙) — double les points d'un de tes pronos de match ; à poser avant le coup d'envoi, avec le bouton « Joker ×2 » sous le match dans Pronos (pas sur le match ×2 d'un événement, qui compte déjà double)</li>
          <li>Carton rouge (2🪙) — un adversaire affiche 🟥 à côté de son pseudo pendant 24 h et ne peut pas jouer au jeu de la semaine pendant ces 24 h</li>
          <li>Revanche (5🪙) — rejoue entièrement un duel (penalty ou quiz) perdu ou nul, une fois par semaine</li>
          <li>Bouclier (2🪙) — invisible pour les autres, il bloque le prochain bonus lancé contre toi (échange, retirage, inversé, carton rouge, revanche) : l'attaquant perd ses jetons pour rien. Un seul bouclier actif à la fois.</li>
        </ul>
      </details>
    </div>
  )
}
