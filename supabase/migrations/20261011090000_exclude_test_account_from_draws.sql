-- Comptes exclus des tirages au sort (duels quiz / penalty, duos
-- d'événement) : le compte de test donné à Google pour la vérification du
-- Play Store est membre de « beta test » mais ne joue jamais — sans ça, un
-- vrai joueur pouvait tomber contre lui et avoir un duel mort.
-- Table sans policy (RLS activé) : lisible et modifiable seulement côté
-- serveur, un joueur ne peut pas s'y ajouter pour éviter ses duels.

create table if not exists public.draw_excluded_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.draw_excluded_profiles enable row level security;

insert into public.draw_excluded_profiles (profile_id, reason)
select id, 'compte de test Google Play' from public.profiles where pseudo = 'yoann.halter93+test1'
on conflict do nothing;

create or replace function public.is_draw_excluded(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$ select exists (select 1 from draw_excluded_profiles where profile_id = p_profile_id) $$;

revoke execute on function public.is_draw_excluded(uuid) from public, anon, authenticated;

do $$
declare
  f text;
  def text;
  n_before text;
begin
  foreach f in array array['run_weekly_matchups(uuid)', 'run_weekly_penalty_matchups(uuid)'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    n_before := def;
    def := replace(def, 'where gm.group_id = g.group_id', 'where gm.group_id = g.group_id and not is_draw_excluded(gm.profile_id)');
    def := replace(def, 'where gm2.group_id = g.group_id', 'where gm2.group_id = g.group_id and not is_draw_excluded(gm2.profile_id)');
    if def = n_before then raise exception 'motif introuvable dans %', f; end if;
    execute def;
  end loop;

  def := pg_get_functiondef('public.assign_balanced_duos(uuid, uuid)'::regprocedure);
  n_before := def;
  def := replace(def, 'where gm.group_id = p_group_id;', 'where gm.group_id = p_group_id and not is_draw_excluded(gm.profile_id);');
  if def = n_before then raise exception 'motif introuvable dans assign_balanced_duos'; end if;
  execute def;
end $$;
