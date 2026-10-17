-- Fin de championnat, version 2 (demande du 17/10) :
--  * à la fin d'un championnat la ligue S'ARRÊTE toujours (plus de nouveau
--    championnat automatique, quel que soit groups.continue_after_period,
--    désormais ignoré) : tout le monde voit la page de fin
--    (podium, classement, stats) ;
--  * le créateur peut relancer un championnat : tout le monde repart à 0
--    (points, jetons, équipe à retirer à la roue) ;
--  * une période peut être annulée (voided) : elle n'apparaît plus dans le
--    palmarès ni sur la page de fin.

alter table public.group_periods add column if not exists voided boolean not null default false;

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
    from group_periods gp where gp.group_id = p_group_id and not gp.is_current and not gp.voided
  ), '[]'::json);
end;
$$;

-- page de fin : dernier championnat terminé, classement + points par source
create or replace function public.get_championship_summary(p_group_id uuid)
returns json
language plpgsql stable security definer
set search_path to 'public'
as $$
declare p record;
begin
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  select gp.* into p from group_periods gp
  where gp.group_id = p_group_id and not gp.is_current and not gp.voided
  order by gp.ends_at desc limit 1;
  if p.id is null then return null; end if;
  return json_build_object(
    'period_id', p.id, 'label', p.label, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'is_owner', is_group_owner(p_group_id),
    'matches_played', (select count(*) from matches m where m.period_id = p.id and m.status <> 'open'),
    'ranking', (select coalesce(json_agg(json_build_object(
        'profile_id', r.profile_id, 'pseudo', r.pseudo, 'avatar_url', r.avatar_url, 'avatar_emoji', r.avatar_emoji,
        'points', r.points, 'rank', r.rank,
        'by_source', (select coalesce(json_object_agg(s.source_type, s.pts), '{}'::json) from (
            select pl.source_type, sum(pl.points)::int pts from points_ledger pl
            where pl.period_id = p.id and pl.profile_id = r.profile_id group by pl.source_type) s),
        'good_predictions', (select count(*) from points_ledger pl
            where pl.period_id = p.id and pl.profile_id = r.profile_id and pl.source_type = 'match' and pl.points > 0)
      ) order by r.rank, r.pseudo), '[]'::json) from period_ranking(p.id) r)
  );
end;
$$;
revoke execute on function public.get_championship_summary(uuid) from public, anon;
grant execute on function public.get_championship_summary(uuid) to authenticated;

-- relancer : nouveau championnat, tout le monde repart à 0 et retire son équipe
create or replace function public.restart_group_championship(p_group_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_name text; v_new uuid;
begin
  if not is_group_owner(p_group_id) then raise exception 'Seul le créateur de la ligue peut relancer un championnat'; end if;
  perform pg_advisory_xact_lock(hashtext(p_group_id::text));
  if exists (select 1 from group_periods where group_id = p_group_id and is_current) then
    raise exception 'Un championnat est déjà en cours';
  end if;
  update groups set ended_at = null, continue_after_period = false where id = p_group_id returning name into v_name;
  insert into group_periods (group_id, label, starts_at, ends_at, is_current)
  values (p_group_id, fr_month_label(now()), now(), now() + period_duration(p_group_id), true)
  returning id into v_new;
  -- matchs pas encore joués de la ligue : au nouveau championnat
  update matches set period_id = v_new
  where group_id = p_group_id and status = 'open' and kickoff_at > now() and period_id <> v_new;
  -- chacun repasse par le tirage de son équipe
  update group_members set team_reveal_seen = false where group_id = p_group_id;
  insert into notifications (profile_id, type, text, ref_table, ref_id)
  select gm.profile_id, 'result', '🏁 Nouveau championnat lancé dans « ' || v_name || ' » : tout le monde repart à 0 ! Tire ton équipe à la roue 🎡', 'groups', p_group_id
  from group_members gm where gm.group_id = p_group_id and gm.profile_id <> auth.uid();
end;
$$;
revoke execute on function public.restart_group_championship(uuid) from public, anon;
grant execute on function public.restart_group_championship(uuid) to authenticated;

-- textes : rappel au créateur et notification de fin
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.rotate_expired_group_periods()'::regprocedure);
  before := def;
  def := replace(def,
    $a$'⏳ Ton championnat « ' || g.name || ' » se termine bientôt (à la fin de la journée en cours). '
        || case when g.continue_after_period then 'Un nouveau championnat repartira derrière. Pour arrêter la ligue : Mes groupes → ⚙️.'
                else 'La ligue s''arrêtera ensuite (tu as choisi d''arrêter). Pour continuer : Mes groupes → ⚙️.' end$a$,
    $b$'⏳ Ton championnat « ' || g.name || ' » se termine bientôt (à la fin de la journée en cours). '
        || 'Tout le monde verra ensuite la page de fin (classement et stats), et tu pourras relancer un nouveau championnat.'$b$);
  def := replace(def, $a$' La ligue s''arrête là, merci à tous !'$a$,
    $b$' Classement final et stats sur la page de fin 🏆'$b$);
  -- plus jamais de nouveau championnat automatique
  def := replace(def, 'if g.continue_after_period then', 'if false then');
  def := replace(def, 'case when g.continue_after_period', 'case when false');
  if def = before or def like '%Pour arrêter la ligue%' or def like '%g.continue_after_period%' then
    raise exception 'motif introuvable (rotate)';
  end if;
  execute def;
end $$;
