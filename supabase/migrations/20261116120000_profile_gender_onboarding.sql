-- Profil : homme / femme (pour accorder les notifications) + création du
-- profil à la première connexion (pseudo, photo, homme/femme).
--  * onboarded : true pour tous les comptes existants (ils ont déjà un
--    profil, on leur demande seulement homme/femme une fois), false pour les
--    nouveaux comptes (écran « Crée ton profil »).
--  * gender : 'h' ou 'f', null tant que la personne n'a pas répondu.
-- Table existante : pas de nouveaux GRANT nécessaires ; la policy RLS
-- « modifier son profil » (id = auth.uid()) couvre déjà ces colonnes.

alter table public.profiles
  add column if not exists gender text check (gender in ('h', 'f')),
  add column if not exists onboarded boolean not null default true;
alter table public.profiles alter column onboarded set default false;

-- accord : « le » / « la »
create or replace function public.pronoun_le(p_profile uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when (select gender from profiles where id = p_profile) = 'f' then 'la' else 'le' end
$$;

create or replace function public.notify_dribble_start(p_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  my_pseudo text;
begin
  -- pas de notif pour un jeu qui n'est pas celui de la semaine
  if get_active_minigame() <> 'dribble' then return; end if;
  if me is null then raise exception 'Utilisateur non authentifié'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  select pseudo into my_pseudo from profiles where id = me;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'dribble', coalesce(my_pseudo, 'Un coéquipier') || ' joue au Jeu de Dribble, viens ' || pronoun_le(me) || ' défier !', 'groups', p_group_id, me
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id <> me
    -- une seule notif par joueur et par jour (sinon une par partie relancée)
    and not exists (
      select 1 from notifications n
      where n.profile_id = gm.profile_id and n.type = 'dribble'
        and n.related_profile_id = me and n.created_at > now() - interval '1 day'
    );
end;
$function$;

create or replace function public.notify_juggle_start(p_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  my_pseudo text;
begin
  -- pas de notif pour un jeu qui n'est pas celui de la semaine
  if get_active_minigame() <> 'jonglage' then return; end if;
  if me is null then raise exception 'Utilisateur non authentifié'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  select pseudo into my_pseudo from profiles where id = me;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'jongle', coalesce(my_pseudo, 'Un coéquipier') || ' joue aux Jonglages, viens ' || pronoun_le(me) || ' défier !', 'groups', p_group_id, me
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id <> me
    -- une seule notif par joueur et par jour (sinon une par partie relancée)
    and not exists (
      select 1 from notifications n
      where n.profile_id = gm.profile_id and n.type = 'jongle'
        and n.related_profile_id = me and n.created_at > now() - interval '1 day'
    );
end;
$function$;

-- bienvenue : « Tu seras prévenu » → tournure neutre
create or replace function public.welcome_new_member()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  g record;
  p record;
  v_champion text;
  v_text text;
begin
  if new.role = 'owner' or is_draw_excluded(new.profile_id) then return new; end if;
  select * into g from groups where id = new.group_id;

  if g.awaiting_kickoff then
    v_text := '👋 Bienvenue dans « ' || g.name || ' » ! Le championnat n''a pas encore commencé : '
      || 'le créateur le lancera quand tout le monde sera là. Tu recevras une notif 🔔';
  elsif g.ended_at is not null then
    select r.pseudo into v_champion
    from group_periods gp, period_ranking(gp.id) r
    where gp.id = (select id from group_periods where group_id = g.id and not is_current and not voided
                   order by ends_at desc limit 1)
      and r.rank = 1 and r.points > 0
    order by r.pseudo limit 1;
    v_text := '👋 Bienvenue dans « ' || g.name || ' » ! Le championnat est terminé'
      || coalesce(' (champion : ' || v_champion || ' 👑)', '')
      || '. Ouvre la ligue pour voir la page de fin. Si le créateur relance un championnat, tout le monde repartira à 0 avec toi.';
  else
    select * into p from group_periods where group_id = g.id and is_current limit 1;
    v_text := '👋 Bienvenue dans « ' || g.name || ' » !'
      || case when p.id is not null
           then ' Le championnat est en cours jusqu''au ' || to_char(p.ends_at at time zone 'Europe/Paris', 'DD/MM') || ' : tu pars de 0,'
           else '' end
      || ' découvre ton équipe tirée au sort 🎡, fais tes pronos et tes duels arrivent très vite. Bonne chance !';
  end if;

  insert into notifications (profile_id, type, text, ref_table, ref_id)
  values (new.profile_id, 'result', v_text, 'groups', g.id);
  return new;
end;
$function$;
