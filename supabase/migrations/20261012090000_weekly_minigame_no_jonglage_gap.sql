-- Bug du lundi matin : le jeu de la semaine n'était choisi qu'à 06:05 UTC
-- (cron assign-weekly-minigame). Entre minuit et 06:05, aucune ligne dans
-- minigame_weeks → get_active_minigame renvoyait « jonglage » par défaut,
-- et certains ont joué au jonglage alors que la semaine était au dribble.
--
-- 1) le jeu de la semaine suivante est choisi dès le dimanche soir ;
-- 2) si la ligne manque quand même, get_active_minigame calcule le même
--    choix que assign_weekly_minigame (le jeu joué le moins récemment)
--    au lieu de renvoyer « jonglage ».

create or replace function public.get_active_minigame(p_date date default ((now() at time zone 'utc'))::date)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select mw.game_key from public.minigame_weeks mw where mw.week_start = date_trunc('week', p_date)::date),
    (select g.key
       from unnest(array['jonglage', 'dribble', 'coup-franc', 'toro']) with ordinality as g(key, ord)
       order by (select max(week_start) from public.minigame_weeks mw
                 where mw.game_key = g.key and mw.week_start < date_trunc('week', p_date)::date) nulls first,
                g.ord
       limit 1)
  );
$$;

select cron.schedule(
  'assign-next-weekly-minigame',
  '0 20 * * 0',
  $$select public.assign_weekly_minigame((now() at time zone 'utc')::date + 1)$$
);
