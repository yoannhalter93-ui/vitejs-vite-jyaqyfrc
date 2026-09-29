-- But en or : n'est plus un "jeu de la semaine" tiré au sort le lundi, mais
-- un ÉVÉNEMENT lancé à la main par l'administrateur (Yoann), certaines
-- semaines, EN PLUS du jeu de la semaine (jonglage / dribble / coup franc).
-- Les tables restent les mêmes (weekly_special_matches = les 2 matchs
-- "1er but", weekly_bonus_matches = le match dont les pronos comptent x2).
--
-- Aussi :
--  - le match x2 n'était jamais appliqué (apply_weekly_bonus_x2 n'était
--    appelée nulle part) → appliqué directement dans resolve_match
--  - résultat du 1er but : automatique si l'API le fournit (option payante
--    "Deep Data"), sinon l'admin le saisit (admin_resolve_golden_goal_match)
--    et le contrôle du matin le lui rappelle
--  - le carton rouge ne bloque plus le But en or (ce n'est plus le jeu de la
--    semaine)

-- ------------------------------------------------------------ admins
create table if not exists public.app_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
insert into public.app_admins values ('6fa7a7a3-5b6a-4667-9aa7-9a5275aaf532') on conflict do nothing; -- yoann

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from app_admins where profile_id = auth.uid());
$$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- ------------------------------------- plus de But en or dans le tirage
create or replace function public.assign_weekly_minigame(p_week_start date default (date_trunc('week', (now() at time zone 'utc')))::date)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week date := date_trunc('week', p_week_start)::date;
  v_existing text;
  v_pick text;
begin
  select game_key into v_existing from minigame_weeks where week_start = v_week;
  if v_existing is not null then return v_existing; end if;

  -- le jeu le moins récemment joué (But en or = événement, plus tiré ici)
  select g.key into v_pick
  from unnest(array['jonglage', 'dribble', 'coup-franc']) with ordinality as g(key, ord)
  order by (select max(week_start) from minigame_weeks mw
            where mw.game_key = g.key and mw.week_start < v_week) nulls first,
           g.ord
  limit 1;

  insert into minigame_weeks (week_start, game_key) values (v_week, v_pick)
  on conflict (week_start) do nothing;

  return coalesce((select game_key from minigame_weeks where week_start = v_week), v_pick);
end;
$$;

select cron.unschedule('draw-weekly-special-matches')
where exists (select 1 from cron.job where jobname = 'draw-weekly-special-matches');

-- ------------------------------------------------ outils admin
-- Matchs à venir (tous groupes confondus, un par vrai match)
create or replace function public.admin_upcoming_fixtures()
returns table(api_fixture_id integer, home_team text, away_team text, kickoff_at timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query
    select distinct on (m.api_fixture_id) m.api_fixture_id, m.home_team, m.away_team, m.kickoff_at
    from matches m
    where m.status = 'open' and m.kickoff_at > now() + interval '1 hour' and m.api_fixture_id is not null
    order by m.api_fixture_id, m.kickoff_at;
end;
$$;

-- Lance un événement But en or : 2 matchs "1er but" + (option) 1 match x2,
-- tous dans la même semaine (lundi → dimanche), un seul événement par
-- semaine. Tous les joueurs sont prévenus.
create or replace function public.admin_create_golden_goal_event(p_fixture_1 integer, p_fixture_2 integer, p_bonus_fixture integer default null)
returns date
language plpgsql security definer
set search_path to 'public'
as $$
declare
  f1 record; f2 record; fb record; tmp record;
  v_has_bonus boolean := false;
  v_bonus_text text := '';
  v_week date;
  v_text text;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_fixture_1 = p_fixture_2 then raise exception 'Choisis 2 matchs différents'; end if;
  if p_bonus_fixture is not null and p_bonus_fixture in (p_fixture_1, p_fixture_2) then
    raise exception 'Le match x2 doit être un autre match';
  end if;

  select * into f1 from admin_upcoming_fixtures() x where x.api_fixture_id = p_fixture_1;
  if not found then raise exception 'Match introuvable ou déjà commencé'; end if;
  select * into f2 from admin_upcoming_fixtures() x where x.api_fixture_id = p_fixture_2;
  if not found then raise exception 'Match introuvable ou déjà commencé'; end if;
  if p_bonus_fixture is not null then
    select * into fb from admin_upcoming_fixtures() x where x.api_fixture_id = p_bonus_fixture;
    if not found then raise exception 'Match x2 introuvable ou déjà commencé'; end if;
    v_has_bonus := true;
  end if;

  -- match 1 = le premier joué
  if f2.kickoff_at < f1.kickoff_at then
    tmp := f1; f1 := f2; f2 := tmp;
  end if;

  v_week := date_trunc('week', f1.kickoff_at at time zone 'Europe/Paris')::date;
  if date_trunc('week', f2.kickoff_at at time zone 'Europe/Paris')::date <> v_week
     or (v_has_bonus and date_trunc('week', fb.kickoff_at at time zone 'Europe/Paris')::date <> v_week) then
    raise exception 'Les matchs doivent être dans la même semaine (lundi → dimanche)';
  end if;
  if exists (select 1 from weekly_special_matches where week_start = v_week)
     or exists (select 1 from weekly_bonus_matches where week_start = v_week) then
    raise exception 'Il y a déjà un événement cette semaine-là';
  end if;

  insert into weekly_special_matches (week_start, match_number, home_team, away_team, kickoff_at, api_fixture_id) values
    (v_week, 1, f1.home_team, f1.away_team, f1.kickoff_at, f1.api_fixture_id),
    (v_week, 2, f2.home_team, f2.away_team, f2.kickoff_at, f2.api_fixture_id);
  if v_has_bonus then
    insert into weekly_bonus_matches (week_start, api_fixture_id, home_team, away_team, kickoff_at)
    values (v_week, fb.api_fixture_id, fb.home_team, fb.away_team, fb.kickoff_at);
    v_bonus_text := '. Bonus : tes pronos sur ' || fb.home_team || ' - ' || fb.away_team || ' comptent x2';
  end if;

  v_text := '🎯 Événement But en or ! Devine l''équipe et la minute du 1er but de '
    || f1.home_team || ' - ' || f1.away_team || ' et ' || f2.home_team || ' - ' || f2.away_team
    || v_bonus_text || ' !';
  insert into notifications (profile_id, type, text, ref_table, ref_id)
  select distinct gm.profile_id, 'result', v_text, 'weekly_special_matches', null::uuid
  from group_members gm;

  return v_week;
end;
$$;

-- Annule un événement tant qu'aucun de ses matchs n'a commencé
create or replace function public.admin_cancel_golden_goal_event(p_week_start date)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if exists (select 1 from weekly_special_matches where week_start = p_week_start and kickoff_at <= now())
     or exists (select 1 from weekly_bonus_matches where week_start = p_week_start and kickoff_at <= now()) then
    raise exception 'Un match de cet événement a déjà commencé';
  end if;
  delete from weekly_special_predictions where match_id in (select id from weekly_special_matches where week_start = p_week_start);
  delete from weekly_special_matches where week_start = p_week_start;
  delete from weekly_bonus_matches where week_start = p_week_start;
end;
$$;

-- Saisie manuelle du 1er but (si l'API ne le fournit pas) ; quand les 2
-- matchs sont renseignés, les points et jetons sont attribués.
create or replace function public.admin_resolve_golden_goal_match(p_match_id uuid, p_team text, p_minute integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  m weekly_special_matches%rowtype;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into m from weekly_special_matches where id = p_match_id;
  if not found then raise exception 'Match introuvable'; end if;
  if m.resolved then raise exception 'Résultat déjà enregistré'; end if;
  if m.kickoff_at > now() then raise exception 'Le match n''a pas encore commencé'; end if;
  if p_team <> 'aucun_but' and (p_minute is null or p_minute < 0 or p_minute > 130) then
    raise exception 'Minute invalide';
  end if;

  perform resolve_weekly_special_match(p_match_id, p_team, p_minute);

  if (select count(*) filter (where resolved) from weekly_special_matches where week_start = m.week_start) = 2 then
    perform resolve_weekly_special_week(m.week_start);
  end if;
end;
$$;

revoke execute on function public.admin_upcoming_fixtures() from public, anon;
revoke execute on function public.admin_create_golden_goal_event(integer, integer, integer) from public, anon;
revoke execute on function public.admin_cancel_golden_goal_event(date) from public, anon;
revoke execute on function public.admin_resolve_golden_goal_match(uuid, text, integer) from public, anon;
grant execute on function public.admin_upcoming_fixtures() to authenticated;
grant execute on function public.admin_create_golden_goal_event(integer, integer, integer) to authenticated;
grant execute on function public.admin_cancel_golden_goal_event(date) to authenticated;
grant execute on function public.admin_resolve_golden_goal_match(uuid, text, integer) to authenticated;

-- ------------------------------------ match x2 appliqué au calcul
create or replace function public.resolve_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  m matches%rowtype;
  pred record;
  pts integer;
  diff_real integer;
  diff_pred integer;
  outcome_real text;
  outcome_pred text;
  scorer_correct boolean;
  v_bonus_x2 boolean;
begin
  select * into m from matches
    where id = p_match_id and status = 'open'
      and real_home_score is not null and real_away_score is not null
      and data_finalized = true
    for update;
  if not found then return; end if;

  diff_real := m.real_home_score - m.real_away_score;
  outcome_real := case when diff_real > 0 then 'home' when diff_real < 0 then 'away' else 'draw' end;

  -- match x2 d'un événement But en or
  v_bonus_x2 := exists (select 1 from weekly_bonus_matches where api_fixture_id = m.api_fixture_id);

  for pred in select * from match_predictions where match_id = p_match_id loop
    pts := 0;

    if pred.pred_home_score = m.real_home_score and pred.pred_away_score = m.real_away_score then
      pts := pts + 5;
    else
      diff_pred := pred.pred_home_score - pred.pred_away_score;
      outcome_pred := case when diff_pred > 0 then 'home' when diff_pred < 0 then 'away' else 'draw' end;
      if outcome_pred = outcome_real and diff_pred = diff_real then
        pts := pts + 4;
      elsif outcome_pred = outcome_real then
        pts := pts + 3;
      end if;
    end if;

    if pred.pred_scorer_id is not null then
      select exists (
        select 1 from match_scorers where match_id = p_match_id and player_id = pred.pred_scorer_id
      ) into scorer_correct;
      if scorer_correct then pts := pts + 1; end if;
    else
      -- v2 : le bonus "aucun buteur deviné juste" exige un VRAI 0-0,
      -- pas juste une absence de donnée de buteur côté API (qui peut
      -- arriver même sur un match avec plusieurs buts)
      if m.real_home_score = 0 and m.real_away_score = 0 then
        pts := pts + 1;
      end if;
    end if;

    -- Joker x2 posé avant le coup d'envoi
    if exists (select 1 from match_jokers where match_id = p_match_id and profile_id = pred.profile_id) then
      pts := pts * 2;
    end if;
    if v_bonus_x2 then
      pts := pts * 2;
    end if;

    insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)
    values (m.group_id, pred.profile_id, m.period_id, 'match', pred.id, pts)
    on conflict do nothing;
  end loop;

  update matches set status = 'resolved' where id = p_match_id;
end;
$$;

-- ------------------------- carton rouge : ne bloque plus le But en or
drop trigger if exists block_red_card on public.weekly_special_predictions;

create or replace function public.submit_weekly_special_prediction_all_leagues(p_match_id uuid, p_pred_team text, p_pred_minute integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  m weekly_special_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into m from weekly_special_matches where id = p_match_id;
  if not found then raise exception 'Match introuvable'; end if;
  if now() >= m.kickoff_at then raise exception 'Coup d''envoi déjà passé'; end if;
  if m.resolved then raise exception 'Ce match est déjà résolu'; end if;

  if p_pred_team not in ('domicile','exterieur','aucun_but') then
    raise exception 'Choix invalide';
  end if;
  if p_pred_team <> 'aucun_but' and (p_pred_minute is null or p_pred_minute < 0 or p_pred_minute > 99) then
    raise exception 'Minute invalide';
  end if;

  with upserted as (
    insert into weekly_special_predictions (match_id, group_id, profile_id, pred_team, pred_minute)
    select p_match_id, gm.group_id, auth.uid(),
           p_pred_team, case when p_pred_team = 'aucun_but' then null else p_pred_minute end
    from group_members gm
    where gm.profile_id = auth.uid()
    on conflict (match_id, group_id, profile_id) do update
      set pred_team = excluded.pred_team,
          pred_minute = excluded.pred_minute,
          updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- ---------------- contrôle du matin : rappel des résultats à saisir
do $$
declare src text;
begin
  select pg_get_functiondef('public.run_health_check(boolean)'::regprocedure) into src;
  if position('7. événement But en or' in src) > 0 then return; end if;
  src := replace(src, $a$  if array_length(issues, 1) is null then$a$, $b$  -- 7. événement But en or : match joué sans résultat du 1er but (l'API ne
  --    le fournit pas sans l'option payante) → à saisir dans Profil → Événements
  for r in
    select home_team, away_team from weekly_special_matches
    where not resolved and kickoff_at < now() - interval '3 hours'
  loop
    issues := issues || format('But en or : entre le 1er but de %s - %s (Profil → Événements)', r.home_team, r.away_team);
  end loop;

  if array_length(issues, 1) is null then$b$);
  execute src;
end $$;
