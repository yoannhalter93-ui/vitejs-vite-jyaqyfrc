-- Événements de journée programmés à l'avance : annonce (notifications,
-- formation des duos, remboursement des Jokers d'une Journée x2) le lundi
-- de la journée à 9 h (Paris), au plus tard 1 h avant le premier match.
-- D'ici là l'événement reste secret pour les joueurs.
alter table app_events add column if not exists announce_at timestamptz, add column if not exists announced_at timestamptz;
update app_events set announced_at = created_at, announce_at = created_at where announced_at is null;

-- Le corps « effets de l'annonce » d'admin_create_app_event est déplacé tel
-- quel dans announce_app_event ; la création ne fait plus que programmer.
do $$
declare d text; body text; a int; b int; mk text := 'returning id into v_id;';
begin
  d := pg_get_functiondef('admin_create_app_event(text,integer)'::regprocedure);
  if position('perform announce_app_event' in d) > 0 then return; end if;
  a := position(mk in d) + length(mk);
  b := position(E'\n  return v_id;' in d);
  if a <= length(mk) or b = 0 then raise exception 'ancres introuvables'; end if;
  body := substring(d from a for b - a);

  execute $f$
create or replace function public.announce_app_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_ids integer[];
  v_id uuid;
  p_kind text;
  p_matchday integer;
  g record;
  v_members uuid[];
  v_n integer;
  v_team integer;
  i integer;
  v_text text;
begin
  select e.id, e.fixture_ids, e.kind, e.matchday into v_id, v_ids, p_kind, p_matchday
  from app_events e where e.id = p_event_id and e.announced_at is null for update;
  if not found then return; end if;
$f$ || body || $f$
  update app_events set announced_at = now() where id = v_id;
end;
$fn$;
$f$;

  d := replace(d, 'returning id into v_id;' || body,
    'returning id into v_id;

  -- annonce le lundi de la journée à 9 h (heure de Paris), au plus tard
  -- 1 h avant le premier match ; tout de suite si ce moment est passé
  v_announce := least((date_trunc(''week'', v_first at time zone ''Europe/Paris'') + interval ''9 hours'') at time zone ''Europe/Paris'',
                      v_first - interval ''1 hour'');
  update app_events set announce_at = v_announce where id = v_id;
  if v_announce <= now() then perform announce_app_event(v_id); end if;
');
  d := replace(d, E'  v_text text;\nbegin', E'  v_text text;\n  v_announce timestamptz;\nbegin');
  execute d;
end $$;
revoke all on function announce_app_event(uuid) from public, anon, authenticated;

create or replace function public.fixture_x2_kind(p_fixture integer)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when exists (select 1 from weekly_bonus_matches where api_fixture_id = p_fixture) then 'but_en_or'
    when exists (select 1 from app_events where kind = 'journee_x2' and p_fixture = any(fixture_ids)
                 and (announced_at is not null or first_kickoff <= now())) then 'journee_x2'
  end;
$function$;

create or replace function public.get_x2_fixtures()
 returns table(api_fixture_id integer, kind text) language sql stable security definer set search_path to 'public'
as $function$
  select b.api_fixture_id, 'but_en_or' from weekly_bonus_matches b where b.kickoff_at > now() - interval '3 days'
  union
  select f, 'journee_x2' from app_events e, unnest(e.fixture_ids) f
  where e.kind = 'journee_x2' and e.last_kickoff > now() - interval '3 days' and e.announced_at is not null;
$function$;

create or replace function public.get_active_app_events(p_group_id uuid)
 returns table(id uuid, kind text, matchday integer, first_kickoff timestamp with time zone, last_kickoff timestamp with time zone, resolved boolean, todo boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  select e.id, e.kind, e.matchday, e.first_kickoff, e.last_kickoff, e.resolved_at is not null,
    (e.kind = 'total_buts' and now() < e.first_kickoff and not exists (
      select 1 from app_event_predictions p where p.event_id = e.id and p.group_id = p_group_id and p.profile_id = auth.uid()))
  from app_events e
  where is_group_member(p_group_id)
    and e.announced_at is not null
    and (e.resolved_at is null or e.resolved_at > now() - interval '2 days')
    and (e.kind <> 'duo' or exists (select 1 from app_event_teams t where t.event_id = e.id and t.group_id = p_group_id))
  order by e.first_kickoff;
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
  return n;
end;
$function$;
revoke all on function announce_due_app_events() from public, anon, authenticated;
select cron.schedule('announce-app-events', '*/10 * * * *', 'select public.announce_due_app_events()');
