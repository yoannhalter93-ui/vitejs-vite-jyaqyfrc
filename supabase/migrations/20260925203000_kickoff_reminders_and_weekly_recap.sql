-- 1) Rappel avant coup d'envoi : toutes les 30 min, pour chaque membre à qui
--    il manque au moins un prono sur les matchs de son groupe qui débutent
--    dans les 3 prochaines heures. Un seul rappel par match "déclencheur"
--    (le premier match sans prono), le push part via le trigger existant
--    sur notifications.
create or replace function public.send_kickoff_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  for r in
    select gm.profile_id, gm.group_id, g.name as group_name,
           count(*) as missing,
           (array_agg(m.id order by m.kickoff_at))[1] as first_match_id,
           min(m.kickoff_at) as first_kickoff
    from group_members gm
    join groups g on g.id = gm.group_id
    join matches m on m.group_id = gm.group_id
    where m.status = 'open'
      and m.kickoff_at > now()
      and m.kickoff_at <= now() + interval '3 hours'
      and not exists (
        select 1 from match_predictions mp
        where mp.match_id = m.id and mp.profile_id = gm.profile_id
      )
    group by gm.profile_id, gm.group_id, g.name
  loop
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select r.profile_id, 'deadline',
      '⏰ Coup d''envoi à ' || to_char(r.first_kickoff at time zone 'Europe/Paris', 'HH24"h"MI')
        || ' : il te manque ' || r.missing || ' prono' || case when r.missing > 1 then 's' else '' end
        || ' dans « ' || r.group_name || ' »',
      'matches', r.first_match_id
    where not exists (
      select 1 from notifications n
      where n.profile_id = r.profile_id and n.ref_table = 'matches'
        and n.ref_id = r.first_match_id and n.type = 'deadline'
    );
  end loop;
end;
$$;

-- 2) Récap du lundi : la semaine écoulée dans chaque groupe actif, envoyé
--    à chaque membre avec son propre total. Tourne après la résolution des
--    concours du lundi (06:20 / 06:25 UTC).
create or replace function public.send_weekly_recaps()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  wk_end timestamptz := date_trunc('week', now());
  wk_start timestamptz := date_trunc('week', now()) - interval '7 days';
  g record;
  v_leader text;
  v_leader_pts int;
  v_exact_name text;
  v_exact_count int;
  v_duels int;
  v_text text;
begin
  for g in select id, name from groups loop
    -- meneur de la semaine
    select p.pseudo, sum(pl.points)::int into v_leader, v_leader_pts
    from points_ledger pl join profiles p on p.id = pl.profile_id
    where pl.group_id = g.id and pl.created_at >= wk_start and pl.created_at < wk_end
    group by p.pseudo
    order by sum(pl.points) desc
    limit 1;

    -- groupe sans activité cette semaine : pas de récap
    if v_leader is null or coalesce(v_leader_pts, 0) <= 0 then
      continue;
    end if;

    -- roi des scores exacts
    select p.pseudo, count(*)::int into v_exact_name, v_exact_count
    from match_predictions mp
    join matches m on m.id = mp.match_id
    join profiles p on p.id = mp.profile_id
    where m.group_id = g.id and m.status = 'resolved'
      and m.kickoff_at >= wk_start and m.kickoff_at < wk_end
      and mp.pred_home_score = m.real_home_score and mp.pred_away_score = m.real_away_score
    group by p.pseudo
    order by count(*) desc
    limit 1;

    select count(*)::int into v_duels from (
      select id from weekly_duels where group_id = g.id and status = 'done' and week_start = wk_start::date
      union all
      select id from penalty_duels where group_id = g.id and phase = 'done'
        and created_at >= wk_start and created_at < wk_end
    ) x;

    v_text := '📊 Récap de la semaine dans « ' || g.name || ' » : 🥇 ' || v_leader
      || ' (+' || v_leader_pts || ' pts)';
    if v_exact_name is not null then
      v_text := v_text || ', 🎯 ' || v_exact_name || ' (' || v_exact_count || ' score'
        || case when v_exact_count > 1 then 's' else '' end || ' exact'
        || case when v_exact_count > 1 then 's' else '' end || ')';
    end if;
    if v_duels > 0 then
      v_text := v_text || ', ⚔️ ' || v_duels || ' duel' || case when v_duels > 1 then 's' else '' end;
    end if;

    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select gm.profile_id, 'result',
      v_text || '. Toi : ' || coalesce((
        select case when sum(pl.points) >= 0 then '+' else '' end || sum(pl.points)::int
        from points_ledger pl
        where pl.group_id = g.id and pl.profile_id = gm.profile_id
          and pl.created_at >= wk_start and pl.created_at < wk_end
      ), '0') || ' pts.',
      'groups', g.id
    from group_members gm
    where gm.group_id = g.id
      and not exists (
        select 1 from notifications n
        where n.profile_id = gm.profile_id and n.ref_table = 'groups' and n.ref_id = g.id
          and n.type = 'result' and n.text like '📊 Récap%' and n.created_at >= wk_end
      );

    v_leader := null; v_leader_pts := null; v_exact_name := null; v_exact_count := null;
  end loop;
end;
$$;

revoke execute on function public.send_kickoff_reminders() from public, anon, authenticated;
revoke execute on function public.send_weekly_recaps() from public, anon, authenticated;

select cron.schedule('kickoff-reminders', '20,50 * * * *', 'select public.send_kickoff_reminders()');
select cron.schedule('weekly-recap', '40 6 * * 1', 'select public.send_weekly_recaps()');
