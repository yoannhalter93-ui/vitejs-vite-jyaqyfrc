-- D'où vient l'abonnement push : 'app' (appli Android / écran d'accueil),
-- 'web-android' (onglet de navigateur sur Android), 'web' (ordinateur,
-- iPhone...). Sert à ne garder que l'appli quand elle est installée, pour
-- éviter les notifs en double qui ouvrent le navigateur.
alter table public.push_subscriptions add column if not exists client text;
