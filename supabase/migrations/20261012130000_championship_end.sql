-- Fin de championnat (période d'un groupe)
--  * la période se termine à la FIN DE LA JOURNÉE de Ligue 1 en cours :
--    si une journée a commencé avant la date de fin, on attend que tous
--    ses matchs soient résolus (10 jours max, au cas où un match est
--    reporté) ;
--  * notification « fin de championnat » à tous les membres (champion,
--    podium, sa place) ;
--  * le créateur choisit de continuer (nouveau championnat, tout le
--    monde repart à 0) ou d'arrêter (groups.ended_at) ; il peut relancer
--    plus tard ; rappel au créateur 2 jours avant la fin ;
--  * palmarès : get_group_palmares renvoie le classement final de chaque
--    championnat terminé.

alter table public.groups add column if not exists continue_after_period boolean not null default true;
alter table public.groups add column if not exists ended_at timestamptz;
alter table public.group_periods add column if not exists end_reminder_sent boolean not null default false;

-- les matchs recopiés à la création d'une période ne doivent jamais faire
-- échouer la rotation (match déjà présent dans le groupe)
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.seed_matches_for_new_period()'::regprocedure);
  before := def;
  def := replace(def, 'where period_id = v_source_period_id and status = ''open'';',
    'where period_id = v_source_period_id and status = ''open''
    on conflict (group_id, api_fixture_id) do nothing;');
  if def = before then raise exception 'motif introuvable (seed)'; end if;
  execute def;
end $$;

-- classement final d'une période (compte de test exclu)
create or replace function public.period_ranking(p_period_id uuid)
returns table(profile_id uuid, pseudo text, avatar_url text, avatar_emoji text, points int, rank int)
language sql stable security definer
set search_path to 'public'
as $$
  with per as (select group_id from group_periods where id = p_period_id),
  st as (
    select pl.profile_id, sum(pl.points)::int as pts
    from points_ledger pl where pl.period_id = p_period_id group by pl.profile_id
  )
  select gm.profile_id, pr.pseudo, pr.avatar_url, pr.avatar_emoji, coalesce(st.pts, 0),
         (rank() over (order by coalesce(st.pts, 0) desc))::int
  from group_members gm
  join per on per.group_id = gm.group_id
  join profiles pr on pr.id = gm.profile_id
  left join st on st.profile_id = gm.profile_id
  where not is_draw_excluded(gm.profile_id)
  order by 6, 2;
$$;
revoke execute on function public.period_ranking(uuid) from public, anon, authenticated;

create or replace function public.get_group_palmares(p_group_id uuid)
returns json
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'period_id', gp.id, 'label', gp.label, 'starts_at', gp.starts_at, 'ends_at', gp.ends_at,
      'ranking', (select coalesce(json_agg(r), '[]'::json) from period_ranking(gp.id) r)
    ) order by gp.starts_at desc)
    from group_periods gp where gp.group_id = p_group_id and not gp.is_current
  ), '[]'::json);
end;
$$;
revoke execute on function public.get_group_palmares(uuid) from public, anon;
grant execute on function public.get_group_palmares(uuid) to authenticated;

-- is_group_owner(gid) existe déjà (rôle « owner » dans group_members)

create or replace function public.set_group_continue(p_group_id uuid, p_continue boolean)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not is_group_owner(p_group_id) then raise exception 'Seul le créateur de la ligue peut changer ça'; end if;
  update groups set continue_after_period = p_continue where id = p_group_id;
end;
$$;
revoke execute on function public.set_group_continue(uuid, boolean) from public, anon;
grant execute on function public.set_group_continue(uuid, boolean) to authenticated;

create or replace function public.restart_group_championship(p_group_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_name text;
begin
  if not is_group_owner(p_group_id) then raise exception 'Seul le créateur de la ligue peut relancer un championnat'; end if;
  perform pg_advisory_xact_lock(hashtext(p_group_id::text));
  if exists (select 1 from group_periods where group_id = p_group_id and is_current) then
    raise exception 'Un championnat est déjà en cours';
  end if;
  update groups set ended_at = null, continue_after_period = true where id = p_group_id returning name into v_name;
  insert into group_periods (group_id, label, starts_at, ends_at, is_current)
  values (p_group_id, fr_month_label(now()), now(), now() + period_duration(p_group_id), true);
  insert into notifications (profile_id, type, text, ref_table, ref_id)
  select gm.profile_id, 'result', '🏁 Nouveau championnat lancé dans « ' || v_name || ' » : tout le monde repart à 0 !', 'groups', p_group_id
  from group_members gm where gm.group_id = p_group_id and gm.profile_id <> auth.uid();
end;
$$;
revoke execute on function public.restart_group_championship(uuid) from public, anon;
grant execute on function public.restart_group_championship(uuid) to authenticated;

create or replace function public.rotate_expired_group_periods()
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  p record;
  g record;
  r record;
  v_new uuid;
  v_podium text;
  v_top int;
  v_tail text;
begin
  -- rappel au créateur 2 jours avant la fin
  for p in
    select gp.* from group_periods gp
    where gp.is_current and not gp.end_reminder_sent
      and gp.ends_at > now() and gp.ends_at <= now() + interval '2 days'
  loop
    select * into g from groups where id = p.group_id;
    if g.created_by is not null then
      insert into notifications (profile_id, type, text, ref_table, ref_id)
      values (g.created_by, 'result',
        '⏳ Ton championnat « ' || g.name || ' » se termine bientôt (à la fin de la journée en cours). '
        || case when g.continue_after_period then 'Un nouveau championnat repartira derrière. Pour arrêter la ligue : Mes groupes → ⚙️.'
                else 'La ligue s''arrêtera ensuite (tu as choisi d''arrêter). Pour continuer : Mes groupes → ⚙️.' end,
        'groups', g.id);
    end if;
    update group_periods set end_reminder_sent = true where id = p.id;
  end loop;

  for p in
    select * from group_periods where is_current and now() >= ends_at for update
  loop
    -- une journée commencée avant la date de fin doit être finie
    if now() < p.ends_at + interval '10 days' and exists (
      select 1 from matches m
      where m.period_id = p.id and m.status = 'open'
        and m.matchday in (select m2.matchday from matches m2
                           where m2.period_id = p.id and m2.kickoff_at <= p.ends_at and m2.matchday is not null)
    ) then
      continue;
    end if;

    perform pg_advisory_xact_lock(hashtext(p.group_id::text));
    select * into g from groups where id = p.group_id;

    update group_periods set is_current = false, ends_at = now() where id = p.id;

    -- notification de fin de championnat
    select max(points) into v_top from period_ranking(p.id);
    if coalesce(v_top, 0) > 0 then
      select string_agg(case rank when 1 then '🥇 ' when 2 then '🥈 ' else '🥉 ' end || pseudo || ' (' || points || ' pts)', ' · ' order by rank, pseudo)
        into v_podium from period_ranking(p.id) where rank <= 3 and points > 0;
      v_tail := case when g.continue_after_period
                     then ' Nouveau championnat lancé : tout le monde repart à 0 !'
                     else ' La ligue s''arrête là, merci à tous !' end;
      for r in select * from period_ranking(p.id) loop
        insert into notifications (profile_id, type, text, ref_table, ref_id)
        values (r.profile_id, 'result',
          '🏆 Fin du championnat « ' || g.name || ' » ! ' || v_podium
          || '. Toi : ' || case when r.rank = 1 then 'CHAMPION 👑' else r.rank || 'e' end || '.' || v_tail,
          'group_periods', p.id);
      end loop;
    end if;

    if g.continue_after_period then
      insert into group_periods (group_id, label, starts_at, ends_at, is_current)
      values (p.group_id, fr_month_label(now()), now(), now() + period_duration(p.group_id), true)
      returning id into v_new;
      -- matchs pas encore joués de l'ancienne période : au nouveau championnat
      update matches set period_id = v_new
      where period_id = p.id and status = 'open' and kickoff_at > now();
    else
      update groups set ended_at = now() where id = p.group_id;
    end if;
  end loop;
end;
$$;

-- les tâches automatiques ignorent les ligues arrêtées
do $$
declare f text; def text; before text;
begin
  foreach f in array array['award_weekly_podium(date, regclass, text, text)', 'run_ghost_matchups()', 'resolve_weekly_special_week(date)',
                           'run_latecomer_matchups()', 'run_latecomer_penalty_matchups()', 'run_ghost_penalty_matchups()', 'send_sunday_reminders()'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    before := def;
    def := replace(def, 'select id as group_id from groups loop', 'select id as group_id from groups where ended_at is null loop');
    if def = before then raise exception 'motif introuvable dans %', f; end if;
    execute def;
  end loop;
  foreach f in array array['run_weekly_matchups(uuid)', 'run_weekly_penalty_matchups(uuid)'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    before := def;
    def := replace(def, 'where (p_group_id is null or id = p_group_id)', 'where ended_at is null and (p_group_id is null or id = p_group_id)');
    if def = before then raise exception 'motif introuvable dans %', f; end if;
    execute def;
  end loop;
  def := pg_get_functiondef('public.send_weekly_recaps()'::regprocedure);
  before := def;
  def := replace(def, 'for g in select id, name from groups loop', 'for g in select id, name from groups where ended_at is null or ended_at > now() - interval ''7 days'' loop');
  if def = before then raise exception 'motif introuvable dans send_weekly_recaps'; end if;
  execute def;
end $$;

-- vérification toutes les heures (fin dès que le dernier match de la journée est résolu)
select cron.schedule('rotate-periods-quotidien', '15 * * * *', 'select rotate_expired_group_periods();');
