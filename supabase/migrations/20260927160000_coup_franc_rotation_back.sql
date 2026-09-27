-- Coup franc validé : de retour dans la rotation automatique, et imposé
-- pour la semaine du 28/09/2026 (à la place du dribble pré-tiré).

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
  from unnest(array['jonglage', 'dribble', 'jeu-semaine', 'coup-franc']) with ordinality as g(key, ord)
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

update minigame_weeks set game_key = 'coup-franc' where week_start = date '2026-09-28';
