-- Plus de notification (ni push) à chaque wizz : le wizz reste un effet en
-- direct dans le jeu. La fonction est gardée (sans effet) pour les anciennes
-- versions de l'appli encore en cache.
create or replace function public.notify_wizz(p_target_profile_id uuid, p_group_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  return;
end;
$$;
