-- But en or programmé à l'avance : annonce (notification + remboursement des
-- Jokers du match x2) le lundi de sa semaine à 9 h (Paris), au plus tard 1 h
-- avant le premier match. D'ici là, matchs et x2 restent invisibles aux
-- joueurs (l'admin les voit). Corrige aussi la création sans match x2
-- (« record fb is not assigned yet »).
create table if not exists golden_goal_weeks (
  week_start date primary key,
  announce_at timestamptz not null,
  announced_at timestamptz,
  notif_text text not null
);
alter table golden_goal_weeks enable row level security;
create policy golden_goal_weeks_admin_select on golden_goal_weeks for select to authenticated using (is_app_admin());
insert into golden_goal_weeks (week_start, announce_at, announced_at, notif_text)
select distinct week_start, now(), now(), '' from weekly_special_matches on conflict do nothing;
insert into golden_goal_weeks (week_start, announce_at, announced_at, notif_text)
select distinct week_start, now(), now(), '' from weekly_bonus_matches on conflict do nothing;

-- le bloc « Jokers remboursés » d'admin_create_golden_goal_event est déplacé
-- tel quel dans announce_golden_goal_week ; la création ne fait que programmer
do $$
declare d text; refund text; a int; b int; n1 int; n2 int;
begin
  d := pg_get_functiondef('admin_create_golden_goal_event(integer,integer,integer)'::regprocedure);
  if position('golden_goal_weeks' in d) > 0 then return; end if;
  a := position('    -- Jokers déjà posés' in d);
  b := position('    v_bonus_text :=' in d);
  n1 := position(E'  insert into notifications (profile_id, type, text, ref_table, ref_id)\n  select distinct gm.profile_id' in d);
  n2 := position('  return v_week;' in d);
  if a = 0 or b = 0 or n1 = 0 or n2 = 0 then raise exception 'ancres introuvables'; end if;
  refund := substring(d from a for b - a);

  execute $f$
create or replace function public.announce_golden_goal_week(p_week date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  w record;
  fb record;
begin
  select * into w from golden_goal_weeks where week_start = p_week and announced_at is null for update;
  if not found then return; end if;
  select * into fb from weekly_bonus_matches where week_start = p_week;
  if found then
$f$ || refund || $f$
  end if;
  insert into notifications (profile_id, type, text, ref_table, ref_id)
  select distinct gm.profile_id, 'result', w.notif_text, 'weekly_special_matches', null::uuid
  from group_members gm;
  update golden_goal_weeks set announced_at = now() where week_start = p_week;
end;
$fn$;
$f$;

  d := substring(d from 1 for n1 - 1)
    || $r$  -- annonce le lundi de la semaine à 9 h (Paris), au plus tard 1 h avant le 1er match
  insert into golden_goal_weeks (week_start, announce_at, notif_text)
  values (v_week,
          least((v_week::timestamp + interval '9 hours') at time zone 'Europe/Paris',
                f1.kickoff_at - interval '1 hour',
                case when v_has_bonus then fb.kickoff_at - interval '1 hour' else f1.kickoff_at end),
          v_text)
  on conflict (week_start) do update
    set announce_at = excluded.announce_at, announced_at = null, notif_text = excluded.notif_text;
  if (select announce_at from golden_goal_weeks where week_start = v_week) <= now() then
    perform announce_golden_goal_week(v_week);
  end if;

$r$ || substring(d from n2);
  d := replace(d, refund, '');
  d := replace(d, E'    v_has_bonus := true;\n  end if;',
    E'    v_has_bonus := true;\n  else\n    fb := f1; -- sans match x2 : jamais utilisé, mais le record doit être assigné\n  end if;');
  execute d;
end $$;
revoke all on function announce_golden_goal_week(date) from public, anon, authenticated;

create or replace function public.golden_goal_week_visible(p_week date)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select not exists (select 1 from golden_goal_weeks g where g.week_start = p_week and g.announced_at is null)
$function$;

alter policy weekly_special_matches_select_authenticated on weekly_special_matches using (golden_goal_week_visible(week_start) or is_app_admin());
alter policy weekly_bonus_matches_select_authenticated on weekly_bonus_matches using (golden_goal_week_visible(week_start) or is_app_admin());

create or replace function public.fixture_x2_kind(p_fixture integer)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when exists (select 1 from weekly_bonus_matches where api_fixture_id = p_fixture
                 and (golden_goal_week_visible(week_start) or kickoff_at <= now())) then 'but_en_or'
    when exists (select 1 from app_events where kind = 'journee_x2' and p_fixture = any(fixture_ids)
                 and (announced_at is not null or first_kickoff <= now())) then 'journee_x2'
  end;
$function$;

create or replace function public.get_x2_fixtures()
 returns table(api_fixture_id integer, kind text) language sql stable security definer set search_path to 'public'
as $function$
  select b.api_fixture_id, 'but_en_or' from weekly_bonus_matches b
  where b.kickoff_at > now() - interval '3 days' and golden_goal_week_visible(b.week_start)
  union
  select f, 'journee_x2' from app_events e, unnest(e.fixture_ids) f
  where e.kind = 'journee_x2' and e.last_kickoff > now() - interval '3 days' and e.announced_at is not null;
$function$;

create or replace function public.announce_due_app_events()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare r record; n integer := 0;
begin
  for r in select id from app_events where announced_at is null and announce_at <= now() order by announce_at loop
    perform announce_app_event(r.id);
    n := n + 1;
  end loop;
  for r in select week_start from golden_goal_weeks where announced_at is null and announce_at <= now()
           and exists (select 1 from weekly_special_matches m where m.week_start = golden_goal_weeks.week_start) loop
    perform announce_golden_goal_week(r.week_start);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
