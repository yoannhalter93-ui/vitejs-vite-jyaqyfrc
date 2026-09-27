-- 4e mini-jeu hebdomadaire : Coup franc (game_key 'coup-franc').
-- Même modèle que le dribble : scores par groupe et par semaine, meilleur
-- score payé le lundi (3 pts + 2 jetons), rotation automatique.

create table public.freekick_scores (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  period_id uuid references public.group_periods(id) on delete set null,
  week_start date not null,
  score integer not null default 0 check (score between 0 and 2000),
  created_at timestamptz not null default now()
);
create index freekick_scores_group_week_idx on public.freekick_scores (group_id, week_start);
create index freekick_scores_profile_idx on public.freekick_scores (profile_id);

alter table public.freekick_scores enable row level security;
create policy "membres voient les scores coup franc" on public.freekick_scores
  for select to authenticated using (is_group_member(group_id));
create policy "enregistrer son score coup franc" on public.freekick_scores
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and is_group_member(group_id));
grant select, insert on public.freekick_scores to authenticated;

-- semaine et plafond imposés côté serveur (voir anti_cheat_lockdown)
create trigger trg_force_freekick_week
  before insert on public.freekick_scores
  for each row execute function public.force_minigame_score_week();

-- nouvelles valeurs autorisées
alter table public.points_ledger drop constraint if exists points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check
  check (source_type = any (array['match','free_bet','duel','team_assignment','minijeu',
    'jonglage_chrono','dribble_chrono','coup_franc_chrono','jeu_semaine','match_bonus_x2']));
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['deadline','validation','duel','result','jongle','dribble','coup_franc','message','free_bet']));

create or replace function public.submit_freekick_score_all_leagues(p_score integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  v_score integer := least(greatest(p_score, 0), 2000);
  v_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  with inserted as (
    insert into freekick_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm where gm.profile_id = auth.uid()
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function public.notify_freekick_start(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  my_pseudo text;
begin
  if me is null then raise exception 'Utilisateur non authentifié'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;
  select pseudo into my_pseudo from profiles where id = me;

  -- une seule notif par joueur et par jour : on ne spamme pas le groupe à
  -- chaque nouvelle partie
  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'coup_franc',
         coalesce(my_pseudo, 'Un coéquipier') || ' tire des coups francs, viens battre son score !',
         'groups', p_group_id, me
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id <> me
    and not exists (
      select 1 from notifications n
      where n.profile_id = gm.profile_id and n.type = 'coup_franc'
        and n.related_profile_id = me and n.created_at > now() - interval '1 day'
    );
end;
$$;

create or replace function public.resolve_weekly_freekick_contest()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  wk date := (date_trunc('week', now()) - interval '7 days')::date;
  v_period_id uuid;
  v_top_score integer;
  r record;
begin
  if public.get_active_minigame(wk) <> 'coup-franc' then return; end if;

  for g in select id as group_id from groups loop
    select max(fs.score) into v_top_score
      from freekick_scores fs where fs.group_id = g.group_id and fs.week_start = wk;
    -- un 0 ne mérite pas de récompense
    if v_top_score is null or v_top_score <= 0 then continue; end if;

    select gp.id into v_period_id from group_periods gp
      where gp.group_id = g.group_id and gp.is_current = true;
    if v_period_id is null then continue; end if;

    for r in
      select distinct on (fs.profile_id) fs.profile_id, fs.id as score_id
        from freekick_scores fs
        where fs.group_id = g.group_id and fs.week_start = wk and fs.score = v_top_score
        order by fs.profile_id, fs.created_at
    loop
      if exists (select 1 from points_ledger pl where pl.group_id = g.group_id
                 and pl.source_type = 'coup_franc_chrono' and pl.source_id = r.score_id) then
        continue;
      end if;
      insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points, created_at)
      values (g.group_id, r.profile_id, v_period_id, 'coup_franc_chrono', r.score_id, 3, now());
      insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
      values (g.group_id, r.profile_id, v_period_id, 2, 'victoire_coup_franc', r.score_id);
    end loop;
  end loop;
end;
$$;

create or replace function public.get_last_minigame_result(p_group_id uuid, p_game_key text)
returns table(week_start date, winners text[], score integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Non autorisé'; end if;

  if p_game_key = 'dribble' then
    return query
      select ds.week_start, array_agg(p.pseudo order by p.pseudo), max(ds.score)::integer
      from points_ledger pl
      join dribble_scores ds on ds.id = pl.source_id
      join profiles p on p.id = pl.profile_id
      where pl.group_id = p_group_id and pl.source_type = 'dribble_chrono'
      group by ds.week_start order by ds.week_start desc limit 1;
  elsif p_game_key = 'jonglage' then
    return query
      select js.week_start, array_agg(p.pseudo order by p.pseudo), max(js.score)::integer
      from points_ledger pl
      join juggle_scores js on js.id = pl.source_id
      join profiles p on p.id = pl.profile_id
      where pl.group_id = p_group_id and pl.source_type = 'jonglage_chrono'
      group by js.week_start order by js.week_start desc limit 1;
  elsif p_game_key = 'coup-franc' then
    return query
      select fs.week_start, array_agg(p.pseudo order by p.pseudo), max(fs.score)::integer
      from points_ledger pl
      join freekick_scores fs on fs.id = pl.source_id
      join profiles p on p.id = pl.profile_id
      where pl.group_id = p_group_id and pl.source_type = 'coup_franc_chrono'
      group by fs.week_start order by fs.week_start desc limit 1;
  else
    return;
  end if;
end;
$$;

-- rotation : le coup franc entre dans le cycle (4 jeux = un par semaine du mois)
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

revoke execute on function public.resolve_weekly_freekick_contest() from public, anon, authenticated;
revoke execute on function public.submit_freekick_score_all_leagues(integer) from public, anon;
grant execute on function public.submit_freekick_score_all_leagues(integer) to authenticated;
revoke execute on function public.notify_freekick_start(uuid) from public, anon;
grant execute on function public.notify_freekick_start(uuid) to authenticated;

-- Semaine du 28/09 (trêve) figée sur dribble, comme annoncé : le coup franc
-- n'arrive qu'une fois la nouvelle version de l'appli en ligne.
insert into public.minigame_weeks (week_start, game_key) values ('2026-09-28', 'dribble')
on conflict (week_start) do nothing;

select cron.schedule('weekly-freekick-contest', '30 6 * * 1', 'select public.resolve_weekly_freekick_contest()');

-- Rappel du dimanche : libellé et table du jeu actif, coup franc et But en
-- or compris (avant : tout ce qui n'était pas "dribble" était annoncé comme
-- "jonglage", y compris les semaines But en or).
create or replace function public.send_sunday_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wk date := date_trunc('week', now())::date;
  wk_end date := wk + 7;
  active_game text := public.get_active_minigame(now()::date);
  game_label text := case active_game
    when 'dribble' then 'dribble'
    when 'coup-franc' then 'coup franc'
    when 'jeu-semaine' then 'But en or'
    else 'jonglage' end;
  game_table text := case active_game
    when 'dribble' then 'dribble_scores'
    when 'coup-franc' then 'freekick_scores'
    when 'jeu-semaine' then 'weekly_special_predictions'
    else 'juggle_scores' end;
  d record;
  pd record;
  g record;
  m record;
begin
  for d in select * from weekly_duels where week_start = wk and status <> 'done' loop
    if (select count(*) from duel_answers where duel_id = d.id and profile_id = d.player_a_id)
       < (select count(*) from duel_question_sequence where duel_id = d.id) then
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      select d.player_a_id, 'deadline', 'Ton duel de quiz n''est pas terminé — il repart à zéro demain matin, joue vite !', 'weekly_duels', d.id
      where not exists (select 1 from notifications where profile_id = d.player_a_id and ref_table = 'weekly_duels' and ref_id = d.id and type = 'deadline');
    end if;
    if (select count(*) from duel_answers where duel_id = d.id and profile_id = d.player_b_id)
       < (select count(*) from duel_question_sequence where duel_id = d.id) then
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      select d.player_b_id, 'deadline', 'Ton duel de quiz n''est pas terminé — il repart à zéro demain matin, joue vite !', 'weekly_duels', d.id
      where not exists (select 1 from notifications where profile_id = d.player_b_id and ref_table = 'weekly_duels' and ref_id = d.id and type = 'deadline');
    end if;
  end loop;

  for pd in select * from penalty_duels where created_at >= wk and created_at < wk_end and phase <> 'done' loop
    if exists (select 1 from penalty_duel_attempts where duel_id = pd.id and (
        (shooter_id = pd.player_a_id and shooter_zone is null) or (keeper_id = pd.player_a_id and keeper_zone is null))) then
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      select pd.player_a_id, 'deadline', 'Ton duel de penaltys n''est pas terminé — il repart à zéro demain matin, joue vite !', 'penalty_duels', pd.id
      where not exists (select 1 from notifications where profile_id = pd.player_a_id and ref_table = 'penalty_duels' and ref_id = pd.id and type = 'deadline');
    end if;
    if exists (select 1 from penalty_duel_attempts where duel_id = pd.id and (
        (shooter_id = pd.player_b_id and shooter_zone is null) or (keeper_id = pd.player_b_id and keeper_zone is null))) then
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      select pd.player_b_id, 'deadline', 'Ton duel de penaltys n''est pas terminé — il repart à zéro demain matin, joue vite !', 'penalty_duels', pd.id
      where not exists (select 1 from notifications where profile_id = pd.player_b_id and ref_table = 'penalty_duels' and ref_id = pd.id and type = 'deadline');
    end if;
  end loop;

  for g in select id as group_id from groups loop
    for m in select profile_id from group_members where group_id = g.group_id loop
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      select m.profile_id, 'deadline',
        'Jeu de la semaine (' || game_label || ') : dernière ligne droite avant la remise à zéro de lundi — rejoue pour grimper au sommet du classement !',
        game_table, g.group_id
      where not exists (
        select 1 from notifications
        where profile_id = m.profile_id and type = 'deadline'
          and ref_table = game_table and ref_id = g.group_id and created_at >= wk
      );
    end loop;
  end loop;
end;
$function$;

-- Stats perso : record et parties de coup franc
create or replace function public.get_my_stats()
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() as id),
  preds as (
    select mp.pred_home_score ph, mp.pred_away_score pa, m.real_home_score rh, m.real_away_score ra
    from match_predictions mp join matches m on m.id = mp.match_id
    where mp.profile_id = (select id from me) and m.status = 'resolved'
      and m.real_home_score is not null and m.real_away_score is not null
  ),
  quiz as (
    select case
      when coalesce(score_a,0) = coalesce(score_b,0) then 'draw'
      when (player_a_id = (select id from me)) = (coalesce(score_a,0) > coalesce(score_b,0)) then 'won'
      else 'lost' end res
    from weekly_duels
    where status = 'done' and (select id from me) in (player_a_id, player_b_id)
      and not (is_ghost and player_b_id = (select id from me))
  ),
  pen as (
    select case when winner_id is null then 'draw' when winner_id = (select id from me) then 'won' else 'lost' end res
    from penalty_duels
    where phase = 'done' and (select id from me) in (player_a_id, player_b_id)
      and not (is_ghost and player_b_id = (select id from me))
  )
  select json_build_object(
    'predictions', json_build_object(
      'played', (select count(*) from preds),
      'exact', (select count(*) from preds where ph = rh and pa = ra),
      'good_result', (select count(*) from preds where sign(ph - pa) = sign(rh - ra)),
      'points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me) and source_type = 'match')
    ),
    'quiz', json_build_object(
      'played', (select count(*) from quiz),
      'won', (select count(*) from quiz where res = 'won'),
      'draw', (select count(*) from quiz where res = 'draw'),
      'lost', (select count(*) from quiz where res = 'lost')
    ),
    'penalty', json_build_object(
      'played', (select count(*) from pen),
      'won', (select count(*) from pen where res = 'won'),
      'draw', (select count(*) from pen where res = 'draw'),
      'lost', (select count(*) from pen where res = 'lost')
    ),
    'minigames', json_build_object(
      'best_juggle', (select max(score) from juggle_scores where profile_id = (select id from me)),
      'best_dribble', (select max(score) from dribble_scores where profile_id = (select id from me)),
      'best_freekick', (select max(score) from freekick_scores where profile_id = (select id from me)),
      'games_played', (select count(*) from juggle_scores where profile_id = (select id from me))
                    + (select count(*) from dribble_scores where profile_id = (select id from me))
                    + (select count(*) from freekick_scores where profile_id = (select id from me))
    ),
    'free_bets', json_build_object(
      'votes', (select count(*) from free_bet_votes where profile_id = (select id from me)),
      'created', (select count(*) from free_bets where author_id = (select id from me)),
      'points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me) and source_type = 'free_bet')
    ),
    'total_points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me))
  );
$$;

-- le nom du jeu doit aussi être accepté par minigame_weeks
alter table public.minigame_weeks drop constraint minigame_weeks_game_key_check;
alter table public.minigame_weeks add constraint minigame_weeks_game_key_check
  check (game_key = any (array['jonglage', 'dribble', 'jeu-semaine', 'coup-franc']));
