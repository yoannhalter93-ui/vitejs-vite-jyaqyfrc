-- Jeu de la semaine : ordre fixe jonglage → dribble → coup franc → toro →
-- jonglage… (le jeu suivant celui de la semaine précédente), au lieu du
-- « jeu joué le moins récemment ». Semaine du 12/10 remise au jonglage
-- (personne n'avait joué au dribble ; les scores de jonglage du lundi
-- matin — joués pendant le trou du cron — redeviennent valables).

create or replace function public.next_weekly_minigame(p_week date)
returns text
language sql
stable
set search_path to 'public'
as $$
  with cycle(key, ord) as (
    select * from unnest(array['jonglage', 'dribble', 'coup-franc', 'toro']) with ordinality
  ),
  prev as (
    select mw.game_key from public.minigame_weeks mw
    where mw.week_start < date_trunc('week', p_week)::date
    order by mw.week_start desc limit 1
  )
  select coalesce(
    (select c2.key from prev join cycle c1 on c1.key = prev.game_key
       join cycle c2 on c2.ord = (c1.ord % 4) + 1),
    'jonglage');
$$;

create or replace function public.assign_weekly_minigame(p_week_start date default (date_trunc('week', (now() at time zone 'utc')))::date)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week date := date_trunc('week', p_week_start)::date;
begin
  insert into minigame_weeks (week_start, game_key) values (v_week, next_weekly_minigame(v_week))
  on conflict (week_start) do nothing;
  return (select game_key from minigame_weeks where week_start = v_week);
end;
$$;

create or replace function public.get_active_minigame(p_date date default ((now() at time zone 'utc'))::date)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select mw.game_key from public.minigame_weeks mw where mw.week_start = date_trunc('week', p_date)::date),
    public.next_weekly_minigame(p_date)
  );
$$;

update public.minigame_weeks set game_key = 'jonglage' where week_start = '2026-10-12' and game_key = 'dribble';
