# Entre Nous — feuille de route

## En cours : sortie sur le Play Store (après la reprise de la Ligue 1, 9 oct. 2026)
1. Compte développeur Google Play (Yoann, 25 $, vérification d'identité).
2. Recruter ≥ 15 testeurs **Android** (Gmail) — candidats : joueurs actifs sur
   Android (jeremy, fabien.halter…) + ceux dont le téléphone est inconnu, + proches.
3. Play Console : créer l'appli, envoyer le `.aab` (workflow « Build Android app »,
   signé avec la clé d'envoi) sur la piste « Test fermé », ajouter les Gmail.
4. 14 jours de test fermé sans désinscription, puis « Demander l'accès à la production ».
   Ceux qui ont l'APK doivent le désinstaller avant d'installer la version Play Store.
5. Fiche du Store : textes, captures, questionnaire de contenu, sécurité des données
   (voir public/politique-confidentialite.html).

## Après la validation Play Store (ne pas toucher au cœur de l'appli pendant le test)
- **Choix du championnat à la création du groupe** (Ligue 1, Premier League, Liga,
  Serie A, Bundesliga… — tous dispo sur football-data.org, formule gratuite).
- **Ligue des Champions en option** pour un groupe, en plus de son championnat.
  → **Gratuite au lancement.** Plus tard, éventuellement payante (ex. 1,99 € /
  saison / groupe, payée par le créateur) via Google Play Billing (15 % Google),
  ce qui demandera un statut d'auto-entrepreneur. Jamais de gains d'argent ou de
  lots liés aux points (sinon jeu d'argent, ANJ).
- App Store (iPhone) : 99 €/an, ajouts natifs (Capacitor) pour passer la règle 4.2,
  un iPhone emprunté pour TestFlight.

## Surveillance en place
- `run_health_check` tous les jours 07:05 UTC → notification à l'administrateur
  si anomalie (tâches en échec, appels serveur, duels, mini-jeu, matchs).
- `app_opens` : ouvertures de l'appli par joueur et par jour (admin uniquement).
