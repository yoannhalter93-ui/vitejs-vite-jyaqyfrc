interface Props {
  onBack: () => void
}

export default function Help({ onBack }: Props) {
  return (
    <div className="rules-screen">
      <div className="predictions-header">
        <button className="predictions-back" onClick={onBack}>← Profil</button>
        <h2>Aide</h2>
      </div>
      <p className="predictions-period">
        Les questions qu'on nous pose le plus souvent.
      </p>

      <div className="rules-section">
        <h3 className="rules-section-title">🏆 Comment je gagne des points ?</h3>
        <p className="rules-section-text">
          En jouant : pronostics, ton équipe tirée au sort, duels (quiz et penalty), mini-jeu de la
          semaine et paris libres rapportent tous des points au classement du groupe. Le détail
          complet est dans « Règles du jeu », accessible depuis l'accueil du groupe.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🖼️ Comment je change ma photo ou mon pseudo ?</h3>
        <p className="rules-section-text">
          Depuis l'onglet Profil : appuie sur l'icône 📷 sur ta photo pour choisir une image ou un
          avatar, ou sur ton pseudo pour le modifier.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🔔 Je ne reçois pas les notifications</h3>
        <p className="rules-section-text">
          Vérifie qu'elles sont activées dans Profil → Paramètres → Notifications, puis dans les
          réglages de ton téléphone ou de ton navigateur pour cette appli. Sur iPhone, l'appli doit
          d'abord être ajoutée à l'écran d'accueil pour pouvoir recevoir des notifications.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">👥 Comment je rejoins ou change de groupe ?</h3>
        <p className="rules-section-text">
          Depuis l'accueil, le sélecteur en haut (🏆 nom du groupe) permet de changer de groupe.
          Pour rejoindre un nouveau groupe ou en créer un, utilise le code d'invitation partagé par
          un membre du groupe.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">🗑️ Comment je supprime mon compte ?</h3>
        <p className="rules-section-text">
          Depuis Profil → Paramètres → Données → « Supprimer mon compte ». Cette action est
          définitive : tu quittes tous tes groupes et tu ne pourras plus te reconnecter.
        </p>
      </div>

      <div className="rules-section">
        <h3 className="rules-section-title">💬 Une autre question ?</h3>
        <p className="rules-section-text">
          Demande directement à la personne qui a créé ton groupe — c'est elle qui gère l'appli
          pour votre bande.
        </p>
      </div>
    </div>
  )
}
