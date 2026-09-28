-- Suppression de compte : efface aussi l'historique d'ouvertures de l'appli
-- et la photo / l'avatar du profil (la photo importée elle-même est
-- supprimée du stockage par la fonction delete-account).
create or replace function public.delete_my_account_data()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  g record;
  v_new_owner uuid;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  -- Si l'utilisateur est owner d'un groupe où d'autres membres restent, on
  -- transfère la propriété (priorité à un admin existant, sinon au membre
  -- arrivé le plus tôt) pour que le groupe ne se retrouve jamais sans owner.
  for g in
    select gm.group_id
    from group_members gm
    where gm.profile_id = v_uid and gm.role = 'owner'
  loop
    select profile_id into v_new_owner
    from group_members
    where group_id = g.group_id and profile_id <> v_uid
    order by (role = 'admin') desc, joined_at asc
    limit 1;

    if v_new_owner is not null then
      update group_members set role = 'owner' where group_id = g.group_id and profile_id = v_new_owner;
    end if;
  end loop;

  -- Quitte tous les groupes.
  delete from group_members where profile_id = v_uid;

  -- Choix d'équipe (roulette) : n'a plus de sens une fois hors du groupe.
  delete from team_assignments where profile_id = v_uid;

  -- Données d'appareil : à supprimer, ce sont les plus clairement
  -- personnelles (endpoints + clés de chiffrement du navigateur).
  delete from push_subscriptions where profile_id = v_uid;

  -- Historique d'ouvertures de l'appli.
  delete from app_opens where profile_id = v_uid;

  -- Anonymise le profil. La ligne reste (des duels/paris/notifs d'autres
  -- joueurs y font encore référence) mais plus aucun élément identifiant.
  update profiles set pseudo = 'Compte supprimé', avatar_url = null, avatar_emoji = null where id = v_uid;
end;
$$;
