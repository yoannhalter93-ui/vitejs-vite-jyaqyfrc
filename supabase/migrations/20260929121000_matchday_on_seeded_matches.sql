-- Les matchs copiés dans une nouvelle période de groupe
-- (seed_matches_for_new_period) perdaient leur numéro de journée : ces
-- copies n'apparaissaient donc pas dans "Journée N" (événements, accueil).
-- La copie garde maintenant matchday, et les copies existantes sont
-- complétées depuis une autre copie du même match.
create or replace function public.seed_matches_for_new_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_source_period_id uuid;
begin
  select m.period_id into v_source_period_id
  from matches m
  join group_periods gp on gp.id = m.period_id
  where gp.is_current = true
    and m.status = 'open'
    and m.period_id <> new.id
  order by m.created_at asc
  limit 1;

  if v_source_period_id is not null then
    insert into matches (group_id, api_fixture_id, home_team, away_team, home_team_api_id, away_team_api_id, kickoff_at, status, period_id, matchday)
    select new.group_id, api_fixture_id, home_team, away_team, home_team_api_id, away_team_api_id, kickoff_at, 'open', new.id, matchday
    from matches
    where period_id = v_source_period_id and status = 'open';
  end if;

  return new;
end;
$$;

update matches m
set matchday = src.matchday
from (select distinct on (api_fixture_id) api_fixture_id, matchday from matches
      where matchday is not null and api_fixture_id is not null order by api_fixture_id) src
where m.matchday is null and m.api_fixture_id = src.api_fixture_id;
