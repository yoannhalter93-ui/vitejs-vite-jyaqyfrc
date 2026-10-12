-- Annonces : avis 👍 / 👎 du joueur (obligatoire pour fermer l'annonce
-- « Mon équipe +3/+1/0 »). 1 = pouce en haut, -1 = pouce en bas.
alter table public.announcements_seen add column if not exists vote smallint check (vote in (-1, 1));

-- résultat du vote (admin de l'appli seulement)
create or replace function public.get_announcement_votes(p_key text)
returns json
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''admin'; end if;
  return json_build_object(
    'up', (select count(*) from announcements_seen where key = p_key and vote = 1),
    'down', (select count(*) from announcements_seen where key = p_key and vote = -1),
    'up_names', (select coalesce(json_agg(p.pseudo order by p.pseudo), '[]') from announcements_seen a join profiles p on p.id = a.profile_id where a.key = p_key and a.vote = 1),
    'down_names', (select coalesce(json_agg(p.pseudo order by p.pseudo), '[]') from announcements_seen a join profiles p on p.id = a.profile_id where a.key = p_key and a.vote = -1)
  );
end;
$$;
revoke execute on function public.get_announcement_votes(text) from public, anon;
grant execute on function public.get_announcement_votes(text) to authenticated;
