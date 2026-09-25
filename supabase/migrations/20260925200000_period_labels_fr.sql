-- Les libellés de période étaient générés par to_char(..., 'FMMonth YYYY'),
-- donc en anglais ("September 2026") puisque la base tourne en locale C.
create or replace function public.fr_month_label(p_ts timestamptz)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select (array['Janvier','Février','Mars','Avril','Mai','Juin','Juillet',
                'Août','Septembre','Octobre','Novembre','Décembre'])
         [extract(month from p_ts at time zone 'Europe/Paris')::int]
         || ' ' || extract(year from p_ts at time zone 'Europe/Paris')::int;
$$;

create or replace function public.open_first_group_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into group_periods (group_id, label, starts_at, ends_at, is_current)
  values (new.id, fr_month_label(now()), now(), now() + period_duration(new.id), true);
  return new;
end;
$function$;

create or replace function public.rotate_expired_group_periods()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p record;
  v_start timestamptz;
begin
  for p in
    select * from group_periods where is_current = true and now() >= ends_at for update
  loop
    perform pg_advisory_xact_lock(hashtext(p.group_id::text));
    update group_periods set is_current = false where id = p.id;
    v_start := p.ends_at;
    insert into group_periods (group_id, label, starts_at, ends_at, is_current)
    values (p.group_id, fr_month_label(v_start), v_start, v_start + period_duration(p.group_id), true);
  end loop;
end;
$function$;

update public.group_periods set label = public.fr_month_label(starts_at);
