-- 5e mini-jeu hebdomadaire : le toro (game_key 'toro').
-- Même modèle que le coup franc : scores par groupe et par semaine, meilleur
-- score payé le lundi (3 pts + 2 jetons), carton rouge, rotation. Il démarre
-- la semaine du lundi 5 octobre 2026, puis entre dans la rotation.

create table public.toro_scores (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  period_id uuid references public.group_periods(id) on delete set null,
  week_start date not null,
  score integer not null default 0 check (score between 0 and 2000),
  created_at timestamptz not null default now()
);
create index toro_scores_group_week_idx on public.toro_scores (group_id, week_start);
create index toro_scores_profile_idx on public.toro_scores (profile_id);

alter table public.toro_scores enable row level security;
create policy "membres voient les scores toro" on public.toro_scores
  for select to authenticated using (is_group_member(group_id));
create policy "enregistrer son score toro" on public.toro_scores
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and is_group_member(group_id));
grant select, insert on public.toro_scores to authenticated;

create trigger trg_force_toro_week
  before insert on public.toro_scores
  for each row execute function public.force_minigame_score_week();
create trigger block_red_card
  before insert on public.toro_scores
  for each row execute function public.block_red_carded_minigame();

-- nouvelles valeurs autorisées
alter table public.points_ledger drop constraint if exists points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check
  check (source_type = any (array['match','free_bet','duel','team_assignment','minijeu',
    'jonglage_chrono','dribble_chrono','coup_franc_chrono','toro_chrono','jeu_semaine','match_bonus_x2','evenement']));
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['deadline','validation','duel','result','jongle','dribble','coup_franc','toro','message','free_bet']));
alter table public.minigame_weeks drop constraint if exists minigame_weeks_game_key_check;
alter table public.minigame_weeks add constraint minigame_weeks_game_key_check
  check (game_key = any (array['jonglage','dribble','jeu-semaine','coup-franc','toro']));

create or replace function public.submit_toro_score_all_leagues(p_score integer)
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
  -- comme les autres mini-jeux : pas dans les groupes où j'ai un carton rouge
  with inserted as (
    insert into toro_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function public.notify_toro_start(p_group_id uuid)
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
  -- une seule notif par joueur et par jour
  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'toro',
         coalesce(my_pseudo, 'Un coéquipier') || ' fait tourner le ballon au toro, viens battre son score !',
         'groups', p_group_id, me
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id <> me
    and not exists (
      select 1 from notifications n
      where n.profile_id = gm.profile_id and n.type = 'toro'
        and n.related_profile_id = me and n.created_at > now() - interval '1 day'
    );
end;
$$;

create or replace function public.resolve_weekly_toro_contest()
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
  if public.get_active_minigame(wk) <> 'toro' then return; end if;

  for g in select id as group_id from groups loop
    select max(ts.score) into v_top_score
      from toro_scores ts where ts.group_id = g.group_id and ts.week_start = wk;
    if v_top_score is null or v_top_score <= 0 then continue; end if;

    select gp.id into v_period_id from group_periods gp
      where gp.group_id = g.group_id and gp.is_current = true;
    if v_period_id is null then continue; end if;

    for r in
      select distinct on (ts.profile_id) ts.profile_id, ts.id as score_id
        from toro_scores ts
        where ts.group_id = g.group_id and ts.week_start = wk and ts.score = v_top_score
        order by ts.profile_id, ts.created_at
    loop
      if exists (select 1 from points_ledger pl where pl.group_id = g.group_id
                 and pl.source_type = 'toro_chrono' and pl.source_id = r.score_id) then
        continue;
      end if;
      insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points, created_at)
      values (g.group_id, r.profile_id, v_period_id, 'toro_chrono', r.score_id, 3, now());
      insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
      values (g.group_id, r.profile_id, v_period_id, 2, 'victoire_toro', r.score_id);
    end loop;
  end loop;
end;
$$;

revoke execute on function public.resolve_weekly_toro_contest() from public, anon, authenticated;
revoke execute on function public.submit_toro_score_all_leagues(integer) from public, anon;
grant execute on function public.submit_toro_score_all_leagues(integer) to authenticated;
revoke execute on function public.notify_toro_start(uuid) from public, anon;
grant execute on function public.notify_toro_start(uuid) to authenticated;

select cron.schedule('weekly-toro-contest', '35 6 * * 1', 'select public.resolve_weekly_toro_contest()');

-- semaine du 5 octobre : le toro, comme annoncé ; ensuite il tourne avec les autres
insert into public.minigame_weeks (week_start, game_key) values ('2026-10-05', 'toro')
on conflict (week_start) do update set game_key = excluded.game_key;

-- fonctions existantes : on ajoute le toro là où les autres mini-jeux sont listés
do $$
declare src text;
begin
  -- rotation
  select pg_get_functiondef('public.assign_weekly_minigame(date)'::regprocedure) into src;
  if position('''toro''' in src) = 0 then
    src := replace(src, $a$array['jonglage', 'dribble', 'coup-franc']$a$, $b$array['jonglage', 'dribble', 'coup-franc', 'toro']$b$);
    execute src;
  end if;

  -- dernier gagnant (bandeau du jeu)
  select pg_get_functiondef('public.get_last_minigame_result(uuid,text)'::regprocedure) into src;
  if position('toro_scores' in src) = 0 then
    src := replace(src, $a$  else
    return;
  end if;$a$, $b$  elsif p_game_key = 'toro' then
    return query
      select ts.week_start, array_agg(p.pseudo order by p.pseudo), max(ts.score)::integer
      from points_ledger pl
      join toro_scores ts on ts.id = pl.source_id
      join profiles p on p.id = pl.profile_id
      where pl.group_id = p_group_id and pl.source_type = 'toro_chrono'
      group by ts.week_start order by ts.week_start desc limit 1;
  else
    return;
  end if;$b$);
    execute src;
  end if;

  -- récap du lundi
  select pg_get_functiondef('public.get_week_recap(uuid)'::regprocedure) into src;
  if position('toro_scores' in src) = 0 then
    src := replace(src, $a$if v_game in ('jonglage', 'dribble', 'coup-franc') then$a$, $b$if v_game in ('jonglage', 'dribble', 'coup-franc', 'toro') then$b$);
    src := replace(src, $a$        select profile_id, score from freekick_scores
          where v_game = 'coup-franc' and group_id = p_group_id and week_start = wk_start::date$a$,
      $b$        select profile_id, score from freekick_scores
          where v_game = 'coup-franc' and group_id = p_group_id and week_start = wk_start::date
        union all
        select profile_id, score from toro_scores
          where v_game = 'toro' and group_id = p_group_id and week_start = wk_start::date$b$);
    execute src;
  end if;

  -- rappel du dimanche
  select pg_get_functiondef('public.send_sunday_reminders()'::regprocedure) into src;
  if position('toro_scores' in src) = 0 then
    src := replace(src, $a$    when 'coup-franc' then 'coup franc'
$a$, $b$    when 'coup-franc' then 'coup franc'
    when 'toro' then 'toro'
$b$);
    src := replace(src, $a$    when 'coup-franc' then 'freekick_scores'
$a$, $b$    when 'coup-franc' then 'freekick_scores'
    when 'toro' then 'toro_scores'
$b$);
    execute src;
  end if;

  -- mes statistiques
  select pg_get_functiondef('public.get_my_stats()'::regprocedure) into src;
  if position('toro_scores' in src) = 0 then
    src := replace(src, $a$      'best_freekick', (select max(score) from freekick_scores where profile_id = (select id from me)),$a$,
      $b$      'best_freekick', (select max(score) from freekick_scores where profile_id = (select id from me)),
      'best_toro', (select max(score) from toro_scores where profile_id = (select id from me)),$b$);
    src := replace(src, $a$                    + (select count(*) from freekick_scores where profile_id = (select id from me))$a$,
      $b$                    + (select count(*) from freekick_scores where profile_id = (select id from me))
                    + (select count(*) from toro_scores where profile_id = (select id from me))$b$);
    execute src;
  end if;
end $$;
