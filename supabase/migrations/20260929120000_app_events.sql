-- Événements lancés par l'admin sur une journée de Ligue 1 (Profil →
-- Événements), en plus du But en or :
--   🔥 journee_x2 : tous les pronos de la journée comptent double
--   ⚽ total_buts : chacun devine le nombre total de buts de la journée,
--                   le plus proche (par groupe) gagne 3 points + 2 jetons
--   🤝 duo        : binômes tirés au sort par groupe (un trio si le groupe
--                   est impair), score d'équipe = MOYENNE des points de
--                   pronos de ses joueurs sur la journée ; la meilleure
--                   équipe gagne 3 points + 2 jetons par joueur
-- Résolution automatique (tâche toutes les 30 min) une fois tous les matchs
-- de la journée terminés. Pas de Joker sur un match qui compte déjà x2.

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check
  check (source_type = any (array['match','free_bet','duel','team_assignment','minijeu','jonglage_chrono',
    'dribble_chrono','coup_franc_chrono','jeu_semaine','match_bonus_x2','evenement']));

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('journee_x2', 'total_buts', 'duo')),
  matchday integer not null,
  fixture_ids integer[] not null,
  first_kickoff timestamptz not null,
  last_kickoff timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  result jsonb
);
alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;
grant select on public.app_events to authenticated;
create policy "lecture des événements" on public.app_events for select to authenticated using (true);

create table if not exists public.app_event_predictions (
  event_id uuid not null references public.app_events(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  value integer not null check (value between 0 and 200),
  updated_at timestamptz not null default now(),
  primary key (event_id, group_id, profile_id)
);
alter table public.app_event_predictions enable row level security;
revoke all on public.app_event_predictions from anon, authenticated;

create table if not exists public.app_event_teams (
  event_id uuid not null references public.app_events(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  team_no integer not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, group_id, profile_id)
);
alter table public.app_event_teams enable row level security;
revoke all on public.app_event_teams from anon, authenticated;

-- Un match compte-t-il déjà x2 ? ('but_en_or' = match x2 d'un But en or,
-- 'journee_x2' = journée x2), null sinon
create or replace function public.fixture_x2_kind(p_fixture integer)
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when exists (select 1 from weekly_bonus_matches where api_fixture_id = p_fixture) then 'but_en_or'
    when exists (select 1 from app_events where kind = 'journee_x2' and p_fixture = any(fixture_ids)) then 'journee_x2'
  end;
$$;
revoke execute on function public.fixture_x2_kind(integer) from public, anon;
grant execute on function public.fixture_x2_kind(integer) to authenticated;

-- Matchs x2 à venir (badges dans Pronos)
create or replace function public.get_x2_fixtures()
returns table(api_fixture_id integer, kind text)
language sql stable security definer
set search_path to 'public'
as $$
  select b.api_fixture_id, 'but_en_or' from weekly_bonus_matches b where b.kickoff_at > now() - interval '3 days'
  union
  select f, 'journee_x2' from app_events e, unnest(e.fixture_ids) f
  where e.kind = 'journee_x2' and e.last_kickoff > now() - interval '3 days';
$$;
revoke execute on function public.get_x2_fixtures() from public, anon;
grant execute on function public.get_x2_fixtures() to authenticated;

-- ------------------------------------------------ admin
create or replace function public.admin_upcoming_matchdays()
returns table(matchday integer, fixtures integer, first_kickoff timestamptz, last_kickoff timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query
    select m.matchday, count(distinct m.api_fixture_id)::integer, min(m.kickoff_at), max(m.kickoff_at)
    from matches m
    where m.status = 'open' and m.matchday is not null and m.api_fixture_id is not null
    group by m.matchday
    having min(m.kickoff_at) > now() + interval '1 hour'
    order by min(m.kickoff_at);
end;
$$;

create or replace function public.admin_create_app_event(p_kind text, p_matchday integer)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_ids integer[];
  v_first timestamptz;
  v_last timestamptz;
  v_id uuid;
  g record;
  v_members uuid[];
  v_n integer;
  v_team integer;
  i integer;
  v_text text;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_kind not in ('journee_x2', 'total_buts', 'duo') then raise exception 'Type d''événement inconnu'; end if;

  select array_agg(distinct api_fixture_id), min(kickoff_at), max(kickoff_at)
    into v_ids, v_first, v_last
  from matches
  where matchday = p_matchday and status = 'open' and api_fixture_id is not null;
  if v_ids is null then raise exception 'Aucun match pour cette journée'; end if;
  if v_first <= now() + interval '1 hour' then raise exception 'Cette journée a déjà commencé (ou commence dans moins d''une heure)'; end if;

  if exists (select 1 from app_events where kind = p_kind and fixture_ids && v_ids) then
    raise exception 'Cet événement existe déjà pour cette journée';
  end if;
  if p_kind = 'journee_x2' and exists (select 1 from weekly_bonus_matches where api_fixture_id = any(v_ids)) then
    raise exception 'Un match de cette journée est déjà le match x2 d''un But en or';
  end if;

  insert into app_events (kind, matchday, fixture_ids, first_kickoff, last_kickoff)
  values (p_kind, p_matchday, v_ids, v_first, v_last)
  returning id into v_id;

  if p_kind = 'journee_x2' then
    -- Jokers déjà posés sur la journée : annulés et remboursés (pas de x4)
    insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
    select mt.group_id, j.profile_id, gp.id, 3, 'remboursement_joker', mt.id
    from match_jokers j
    join matches mt on mt.id = j.match_id
    join group_periods gp on gp.group_id = mt.group_id and gp.is_current
    where mt.api_fixture_id = any(v_ids);
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select j.profile_id, 'result',
      '🃏 Ton Joker sur ' || mt.home_team || ' - ' || mt.away_team || ' est remboursé (3 🪙) : toute la journée compte déjà x2 !',
      'matches', mt.id
    from match_jokers j join matches mt on mt.id = j.match_id
    where mt.api_fixture_id = any(v_ids);
    delete from match_jokers j using matches mt
    where mt.id = j.match_id and mt.api_fixture_id = any(v_ids);

    v_text := '🔥 Journée x2 ! Tous tes pronos de la journée ' || p_matchday || ' de Ligue 1 comptent double. Pense à les remplir !';
  elsif p_kind = 'total_buts' then
    v_text := '⚽ Événement Total de buts : devine combien de buts seront marqués sur toute la journée ' || p_matchday
      || ' ! Le plus proche de ton groupe gagne 3 points + 2 🪙.';
  end if;

  if p_kind = 'duo' then
    -- binômes tirés au sort par groupe (au moins 4 joueurs), un trio si impair
    for g in select gm.group_id from group_members gm group by gm.group_id having count(*) >= 4 loop
      select array_agg(profile_id order by random()) into v_members from group_members where group_id = g.group_id;
      v_n := array_length(v_members, 1);
      for i in 1..v_n loop
        v_team := least((i + 1) / 2, v_n / 2);  -- le 5e d'un groupe de 5 rejoint le dernier binôme
        insert into app_event_teams (event_id, group_id, team_no, profile_id) values (v_id, g.group_id, v_team, v_members[i]);
      end loop;
    end loop;

    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select t.profile_id, 'result',
      '🤝 Duo du week-end (journée ' || p_matchday || ') : tu fais équipe avec '
        || (select string_agg(p.pseudo, ' et ') from app_event_teams t2 join profiles p on p.id = t2.profile_id
            where t2.event_id = v_id and t2.group_id = t.group_id and t2.team_no = t.team_no and t2.profile_id <> t.profile_id)
        || ' dans « ' || gr.name || ' » ! La meilleure équipe gagne 3 points + 2 🪙 chacun.',
      'app_events', v_id
    from app_event_teams t join groups gr on gr.id = t.group_id
    where t.event_id = v_id;
  else
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select distinct gm.profile_id, 'result', v_text, 'app_events', v_id
    from group_members gm;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_cancel_app_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if exists (select 1 from app_events where id = p_event_id and first_kickoff <= now()) then
    raise exception 'La journée a déjà commencé';
  end if;
  delete from app_events where id = p_event_id;
end;
$$;

-- ------------------------------------------------ joueurs
create or replace function public.submit_event_prediction(p_event_id uuid, p_value integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  e app_events%rowtype;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  select * into e from app_events where id = p_event_id;
  if not found or e.kind <> 'total_buts' then raise exception 'Événement introuvable'; end if;
  if now() >= e.first_kickoff then raise exception 'Trop tard : la journée a commencé'; end if;
  if p_value is null or p_value < 0 or p_value > 200 then raise exception 'Nombre de buts invalide'; end if;

  with up as (
    insert into app_event_predictions (event_id, group_id, profile_id, value)
    select p_event_id, gm.group_id, auth.uid(), p_value from group_members gm where gm.profile_id = auth.uid()
    on conflict (event_id, group_id, profile_id) do update set value = excluded.value, updated_at = now()
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end;
$$;

-- Événements à afficher (en cours, ou terminés depuis moins de 2 jours)
create or replace function public.get_active_app_events(p_group_id uuid)
returns table(id uuid, kind text, matchday integer, first_kickoff timestamptz, last_kickoff timestamptz, resolved boolean, todo boolean)
language sql stable security definer
set search_path to 'public'
as $$
  select e.id, e.kind, e.matchday, e.first_kickoff, e.last_kickoff, e.resolved_at is not null,
    (e.kind = 'total_buts' and now() < e.first_kickoff and not exists (
      select 1 from app_event_predictions p where p.event_id = e.id and p.group_id = p_group_id and p.profile_id = auth.uid()))
  from app_events e
  where is_group_member(p_group_id)
    and (e.resolved_at is null or e.resolved_at > now() - interval '2 days')
    and (e.kind <> 'duo' or exists (select 1 from app_event_teams t where t.event_id = e.id and t.group_id = p_group_id))
  order by e.first_kickoff;
$$;

-- Points de pronos (après x2) d'un joueur sur les matchs d'un événement
create or replace function public.app_event_player_points(p_event_id uuid, p_group_id uuid, p_profile_id uuid)
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(sum(pl.points), 0)::integer
  from app_events e
  join matches m on m.group_id = p_group_id and m.api_fixture_id = any(e.fixture_ids)
  join match_predictions mp on mp.match_id = m.id and mp.profile_id = p_profile_id
  join points_ledger pl on pl.group_id = p_group_id and pl.source_type = 'match' and pl.source_id = mp.id
  where e.id = p_event_id;
$$;
revoke execute on function public.app_event_player_points(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.get_event_view(p_event_id uuid, p_group_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  e app_events%rowtype;
  v_started boolean;
  v_fixtures jsonb;
  v_goals integer;
  v_teams jsonb;
  v_preds jsonb;
  v_mine integer;
begin
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  select * into e from app_events where id = p_event_id;
  if not found then raise exception 'Événement introuvable'; end if;
  v_started := now() >= e.first_kickoff;

  select jsonb_agg(jsonb_build_object('home', m.home_team, 'away', m.away_team, 'kickoff', m.kickoff_at,
           'home_score', case when m.status = 'resolved' then m.real_home_score end,
           'away_score', case when m.status = 'resolved' then m.real_away_score end,
           'status', m.status) order by m.kickoff_at),
         coalesce(sum(case when m.status = 'resolved' then m.real_home_score + m.real_away_score end), 0)
    into v_fixtures, v_goals
  from matches m
  where m.group_id = p_group_id and m.api_fixture_id = any(e.fixture_ids);

  if e.kind = 'total_buts' then
    select value into v_mine from app_event_predictions
      where event_id = e.id and group_id = p_group_id and profile_id = auth.uid();
    -- les pronos des autres ne sont visibles qu'une fois la journée commencée
    if v_started then
      select jsonb_agg(jsonb_build_object('pseudo', pr.pseudo, 'value', p.value, 'me', p.profile_id = auth.uid()) order by p.value)
        into v_preds
      from app_event_predictions p join profiles pr on pr.id = p.profile_id
      where p.event_id = e.id and p.group_id = p_group_id;
    end if;
  elsif e.kind = 'duo' then
    select jsonb_agg(t order by (t->>'avg')::numeric desc) into v_teams from (
      select jsonb_build_object(
        'team_no', team_no,
        'mine', bool_or(profile_id = auth.uid()),
        'members', jsonb_agg(jsonb_build_object('pseudo', pseudo, 'points', pts) order by pts desc),
        'avg', round(avg(pts)::numeric, 1)) t
      from (
        select t.team_no, t.profile_id, pr.pseudo, app_event_player_points(e.id, p_group_id, t.profile_id) pts
        from app_event_teams t join profiles pr on pr.id = t.profile_id
        where t.event_id = e.id and t.group_id = p_group_id
      ) x
      group by team_no
    ) y;
  end if;

  return jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'matchday', e.matchday,
    'first_kickoff', e.first_kickoff, 'last_kickoff', e.last_kickoff,
    'started', v_started, 'resolved', e.resolved_at is not null,
    'result', e.result -> p_group_id::text,
    'fixtures', coalesce(v_fixtures, '[]'::jsonb), 'goals', v_goals,
    'my_prediction', v_mine, 'predictions', coalesce(v_preds, '[]'::jsonb),
    'teams', coalesce(v_teams, '[]'::jsonb));
end;
$$;

-- ------------------------------------------------ résolution
create or replace function public.resolve_app_events()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  e record;
  g record;
  v_total integer;
  v_best integer;
  v_best_avg numeric;
  v_result jsonb;
  v_period uuid;
  v_label text;
  w record;
  v_done integer := 0;
begin
  for e in
    select * from app_events a
    where a.resolved_at is null and a.last_kickoff < now()
      and not exists (select 1 from matches m where m.api_fixture_id = any(a.fixture_ids) and m.status = 'open')
  loop
    v_result := '{}'::jsonb;
    v_label := case e.kind when 'total_buts' then 'Total de buts' when 'duo' then 'Duo du week-end' else 'Journée x2' end;

    if e.kind = 'total_buts' then
      select coalesce(sum(s), 0) into v_total from (
        select distinct on (api_fixture_id) coalesce(real_home_score, 0) + coalesce(real_away_score, 0) s
        from matches where api_fixture_id = any(e.fixture_ids) and status = 'resolved'
        order by api_fixture_id
      ) x;

      for g in select distinct group_id from app_event_predictions where event_id = e.id loop
        select min(abs(value - v_total)) into v_best from app_event_predictions where event_id = e.id and group_id = g.group_id;
        select id into v_period from group_periods where group_id = g.group_id and is_current;
        v_result := v_result || jsonb_build_object(g.group_id::text, jsonb_build_object('total', v_total, 'best_gap', v_best,
          'winners', (select jsonb_agg(pr.pseudo) from app_event_predictions p join profiles pr on pr.id = p.profile_id
                      where p.event_id = e.id and p.group_id = g.group_id and abs(p.value - v_total) = v_best)));
        if v_period is null then continue; end if;
        for w in select profile_id from app_event_predictions where event_id = e.id and group_id = g.group_id and abs(value - v_total) = v_best loop
          insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)
          values (g.group_id, w.profile_id, v_period, 'evenement', e.id, 3) on conflict do nothing;
          insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
          values (g.group_id, w.profile_id, v_period, 2, 'victoire_evenement', e.id);
          insert into notifications (profile_id, type, text, ref_table, ref_id)
          values (w.profile_id, 'result', '🏆 Tu remportes l''événement ' || v_label || ' (' || v_total || ' buts) : +3 points et +2 🪙 !', 'app_events', e.id);
        end loop;
      end loop;

    elsif e.kind = 'duo' then
      for g in select distinct group_id from app_event_teams where event_id = e.id loop
        create temporary table if not exists tmp_duo (team_no integer, profile_id uuid, pts integer) on commit drop;
        delete from tmp_duo;
        insert into tmp_duo
          select t.team_no, t.profile_id, app_event_player_points(e.id, g.group_id, t.profile_id)
          from app_event_teams t where t.event_id = e.id and t.group_id = g.group_id;
        select max(a) into v_best_avg from (select avg(pts) a from tmp_duo group by team_no) x;
        select id into v_period from group_periods where group_id = g.group_id and is_current;
        v_result := v_result || jsonb_build_object(g.group_id::text, jsonb_build_object('best_avg', round(v_best_avg, 1),
          'winners', (select jsonb_agg(pr.pseudo) from tmp_duo d join profiles pr on pr.id = d.profile_id
                      where d.team_no in (select team_no from tmp_duo group by team_no having avg(pts) = v_best_avg))));
        if v_period is null or coalesce(v_best_avg, 0) <= 0 then continue; end if;
        for w in select profile_id from tmp_duo where team_no in (select team_no from tmp_duo group by team_no having avg(pts) = v_best_avg) loop
          insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)
          values (g.group_id, w.profile_id, v_period, 'evenement', e.id, 3) on conflict do nothing;
          insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
          values (g.group_id, w.profile_id, v_period, 2, 'victoire_evenement', e.id);
          insert into notifications (profile_id, type, text, ref_table, ref_id)
          values (w.profile_id, 'result', '🏆 Ton équipe remporte le ' || v_label || ' : +3 points et +2 🪙 !', 'app_events', e.id);
        end loop;
      end loop;
    end if;

    update app_events set resolved_at = now(), result = v_result where id = e.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;
revoke execute on function public.resolve_app_events() from public, anon, authenticated;

select cron.schedule('resolve-app-events', '*/30 * * * *', 'select public.resolve_app_events()');

revoke execute on function public.admin_upcoming_matchdays() from public, anon;
revoke execute on function public.admin_create_app_event(text, integer) from public, anon;
revoke execute on function public.admin_cancel_app_event(uuid) from public, anon;
revoke execute on function public.submit_event_prediction(uuid, integer) from public, anon;
revoke execute on function public.get_active_app_events(uuid) from public, anon;
revoke execute on function public.get_event_view(uuid, uuid) from public, anon;
grant execute on function public.admin_upcoming_matchdays() to authenticated;
grant execute on function public.admin_create_app_event(text, integer) to authenticated;
grant execute on function public.admin_cancel_app_event(uuid) to authenticated;
grant execute on function public.submit_event_prediction(uuid, integer) to authenticated;
grant execute on function public.get_active_app_events(uuid) to authenticated;
grant execute on function public.get_event_view(uuid, uuid) to authenticated;

-- ------------------------------ x2 : But en or OU Journée x2, pas de Joker
do $$
declare src text;
begin
  select pg_get_functiondef('public.resolve_match(uuid)'::regprocedure) into src;
  src := replace(src,
    $a$  v_bonus_x2 := exists (select 1 from weekly_bonus_matches where api_fixture_id = m.api_fixture_id);$a$,
    $b$  v_bonus_x2 := fixture_x2_kind(m.api_fixture_id) is not null;$b$);
  execute src;

  select pg_get_functiondef('public.use_bonus_joker(uuid)'::regprocedure) into src;
  src := replace(src,
    $a$  if exists (select 1 from weekly_bonus_matches where api_fixture_id = m.api_fixture_id) then$a$,
    $b$  if fixture_x2_kind(m.api_fixture_id) is not null then$b$);
  execute src;

  select pg_get_functiondef('public.admin_create_golden_goal_event(integer,integer,integer)'::regprocedure) into src;
  if position('journee_x2' in src) = 0 then
    src := replace(src,
      $a$  select * into f1 from admin_upcoming_fixtures() x where x.api_fixture_id = p_fixture_1;$a$,
      $b$  if p_bonus_fixture is not null and fixture_x2_kind(p_bonus_fixture) = 'journee_x2' then
    raise exception 'Ce match fait partie d''une Journée x2 : il compte déjà double';
  end if;

  select * into f1 from admin_upcoming_fixtures() x where x.api_fixture_id = p_fixture_1;$b$);
    execute src;
  end if;
end $$;
