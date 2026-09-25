-- Rotation automatique du mini-jeu de la semaine (avant : une ligne à
-- ajouter à la main dans minigame_weeks chaque semaine, sinon "jonglage"
-- par défaut). Règle : parmi les jeux possibles cette semaine, on prend
-- celui joué il y a le plus longtemps (jamais joué = prioritaire).
-- "But en or" (jeu-semaine) a besoin de vrais matchs : il n'est possible
-- que si la semaine compte au moins 3 matchs ouverts (même critère que
-- draw_weekly_special_matches). Une ligne déjà présente (choix manuel) est
-- respectée.
create or replace function public.assign_weekly_minigame(
  p_week_start date default date_trunc('week', (now() at time zone 'utc'))::date
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week date := date_trunc('week', p_week_start)::date;
  v_existing text;
  v_fixtures int;
  v_pick text;
begin
  select game_key into v_existing from minigame_weeks where week_start = v_week;
  if v_existing is not null then return v_existing; end if;

  select count(distinct api_fixture_id) into v_fixtures
  from matches
  where status = 'open'
    and kickoff_at >= v_week::timestamptz
    and kickoff_at < (v_week + 7)::timestamptz;

  select g.key into v_pick
  from unnest(array['jonglage', 'dribble', 'jeu-semaine']) with ordinality as g(key, ord)
  where g.key <> 'jeu-semaine' or v_fixtures >= 3
  order by (select max(week_start) from minigame_weeks mw
            where mw.game_key = g.key and mw.week_start < v_week) nulls first,
           g.ord
  limit 1;

  insert into minigame_weeks (week_start, game_key) values (v_week, v_pick)
  on conflict (week_start) do nothing;

  return coalesce((select game_key from minigame_weeks where week_start = v_week), v_pick);
end;
$$;

revoke execute on function public.assign_weekly_minigame(date) from public, anon, authenticated;

-- lundi 06:05 UTC : après l'import des matchs (05:00), avant le tirage des
-- matchs de "But en or" (06:15)
select cron.schedule('assign-weekly-minigame', '5 6 * * 1', 'select public.assign_weekly_minigame()');
