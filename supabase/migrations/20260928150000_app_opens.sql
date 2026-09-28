-- Suivi des ouvertures de l'appli : "vu pour la dernière fois" et nombre
-- d'ouvertures par jour, pour savoir qui utilise vraiment l'appli (les
-- actions seules ne comptent pas ceux qui viennent juste regarder).
-- Appelé par l'appli à l'ouverture et au retour au premier plan (au plus
-- une fois toutes les 5 min par appareil, voir App.tsx).
-- Tables à part (pas dans profiles, lisible par les autres joueurs) et
-- sans aucun accès direct : seul l'administrateur les consulte.

create table if not exists public.app_opens (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  opens int not null default 1,
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, day)
);

alter table public.app_opens enable row level security;
revoke all on public.app_opens from anon, authenticated;

create or replace function public.touch_app_open()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;
  insert into app_opens (profile_id, day)
  values (me, (now() at time zone 'Europe/Paris')::date)
  on conflict (profile_id, day)
    do update set opens = app_opens.opens + 1, last_seen_at = now();
end;
$$;

revoke execute on function public.touch_app_open() from public, anon;
grant execute on function public.touch_app_open() to authenticated;
