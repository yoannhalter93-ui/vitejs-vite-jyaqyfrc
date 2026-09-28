-- Trois nouveaux bonus à jetons :
--   🃏 Joker ×2 (3 🪙)      : double les points d'un prono de match, à poser
--                            avant le coup d'envoi (un par match).
--   🛡️ Bouclier (2 🪙)     : invisible pour les autres, à usage unique. Bloque
--                            le prochain bonus lancé contre son porteur
--                            (échange, retirage, inversé, carton rouge,
--                            revanche) : l'attaquant perd quand même ses
--                            jetons et apprend que son bonus n'a rien fait.
--   🟥 Carton rouge (2 🪙) : badge visible par le groupe pendant 24 h, et la
--                            cible ne peut pas jouer au jeu de la semaine
--                            pendant ces 24 h (dans ce groupe).
-- Les bonus ciblés renvoient désormais 'ok' ou 'bloque' (bouclier) pour que
-- l'appli puisse prévenir l'attaquant.

insert into public.bonus_catalog (code, label, cost_jetons, requires_target, description) values
  ('joker_x2', 'Joker ×2', 3, false, 'Double les points d''un de tes pronos de match. À activer avant le coup d''envoi, depuis l''écran Pronos.'),
  ('bouclier', 'Bouclier', 2, false, 'Invisible pour les autres. Bloque le prochain bonus lancé contre toi : l''attaquant perd ses jetons pour rien. Un seul bouclier actif à la fois.'),
  ('carton_rouge', 'Carton rouge', 2, true, 'Colle un carton rouge à un adversaire : badge visible par tout le groupe pendant 24 h, et il ne peut pas jouer au jeu de la semaine pendant 24 h.')
on conflict (code) do update set label = excluded.label, cost_jetons = excluded.cost_jetons,
  requires_target = excluded.requires_target, description = excluded.description;

-- ---------------------------------------------------------------- tables
create table if not exists public.bonus_shields (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references public.profiles(id) on delete set null,
  consumed_bonus text
);
create unique index if not exists bonus_shields_one_active
  on public.bonus_shields (group_id, profile_id) where consumed_at is null;
alter table public.bonus_shields enable row level security;
revoke all on public.bonus_shields from anon, authenticated;
grant select on public.bonus_shields to authenticated;
-- chacun ne voit QUE son propre bouclier (il est invisible pour les autres)
create policy "voir son bouclier" on public.bonus_shields
  for select to authenticated using (profile_id = auth.uid());

create table if not exists public.red_cards (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists red_cards_active on public.red_cards (group_id, target_id, expires_at);
alter table public.red_cards enable row level security;
revoke all on public.red_cards from anon, authenticated;
grant select on public.red_cards to authenticated;
create policy "membres voient les cartons" on public.red_cards
  for select to authenticated using (is_group_member(group_id));

create table if not exists public.match_jokers (
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, profile_id)
);
alter table public.match_jokers enable row level security;
revoke all on public.match_jokers from anon, authenticated;
grant select on public.match_jokers to authenticated;
create policy "voir ses jokers" on public.match_jokers
  for select to authenticated using (profile_id = auth.uid());

-- ------------------------------------------------------- helpers internes
create or replace function public.has_red_card(p_group_id uuid, p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from red_cards
    where group_id = p_group_id and target_id = p_profile_id and expires_at > now());
$$;

-- Bouclier : appelé par chaque bonus ciblé, APRÈS ses vérifications et
-- AVANT son effet. Si la cible a un bouclier actif, il est consommé,
-- l'attaquant paie quand même, et les deux sont prévenus (le reste du groupe
-- ne voit rien). Renvoie true si le bonus est bloqué.
create or replace function public.bonus_shield_blocks(
  p_group_id uuid, p_target_id uuid, p_period_id uuid, p_cost integer, p_reason text, p_label text)
returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_shield uuid;
  v_actor text;
  v_target text;
begin
  if p_target_id is null or p_target_id = auth.uid() then return false; end if;

  select id into v_shield from bonus_shields
    where group_id = p_group_id and profile_id = p_target_id and consumed_at is null
    for update;
  if v_shield is null then return false; end if;

  update bonus_shields
    set consumed_at = now(), consumed_by = auth.uid(), consumed_bonus = p_reason
    where id = v_shield;

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), p_period_id, -p_cost, p_reason || '_bloque', p_target_id);

  select pseudo into v_actor from profiles where id = auth.uid();
  select pseudo into v_target from profiles where id = p_target_id;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id) values
    (auth.uid(), 'result',
     '🛡️ ' || coalesce(v_target, 'Ta cible') || ' avait un bouclier : ton bonus « ' || p_label
       || ' » n''a eu aucun effet et tes ' || p_cost || ' jetons sont perdus !',
     null, null, p_target_id),
    (p_target_id, 'result',
     '🛡️ Ton bouclier a bloqué le bonus « ' || p_label || ' » de ' || coalesce(v_actor, 'un adversaire')
       || ' ! Il est maintenant utilisé.',
     null, null, auth.uid());
  return true;
end;
$$;

revoke execute on function public.has_red_card(uuid, uuid) from public, anon;
grant execute on function public.has_red_card(uuid, uuid) to authenticated;
revoke execute on function public.bonus_shield_blocks(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;

-- ------------------------------------------------ bonus ciblés existants
drop function if exists public.use_bonus_echange_equipe(uuid, uuid);
create function public.use_bonus_echange_equipe(p_group_id uuid, p_target_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_period uuid;
  v_balance integer;
  v_actor_pseudo text;
  v_target_pseudo text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  if p_target_id = auth.uid() then raise exception 'Impossible de te cibler toi-même'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = p_target_id) then
    raise exception 'Cette personne n''est pas membre du groupe';
  end if;

  select id into v_period from group_periods where group_id = p_group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':bonus'));

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = p_group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 3 then raise exception 'Pas assez de jetons'; end if;

  if not exists (select 1 from team_assignments where group_id = p_group_id and period_id = v_period and profile_id = auth.uid())
     or not exists (select 1 from team_assignments where group_id = p_group_id and period_id = v_period and profile_id = p_target_id) then
    raise exception 'Les deux joueurs doivent déjà avoir une équipe attitrée';
  end if;

  if bonus_shield_blocks(p_group_id, p_target_id, v_period, 3, 'bonus_echange_equipe', 'Échange d''équipe') then
    return 'bloque';
  end if;

  with vals as (
    select profile_id, team_name, api_team_id from team_assignments
    where group_id = p_group_id and period_id = v_period and profile_id in (auth.uid(), p_target_id)
  )
  update team_assignments t
  set team_name = (select team_name from vals v where v.profile_id <> t.profile_id),
      api_team_id = (select api_team_id from vals v where v.profile_id <> t.profile_id)
  where t.group_id = p_group_id and t.period_id = v_period and t.profile_id in (auth.uid(), p_target_id);

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), v_period, -3, 'bonus_echange_equipe', p_target_id);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();
  select pseudo into v_target_pseudo from profiles where id = p_target_id;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  values (p_target_id, 'result', 'Ton équipe attitrée a été échangée avec celle de ' || coalesce(v_actor_pseudo, 'un adversaire') || ' !', 'team_assignments', p_target_id, auth.uid());

  -- le reste du groupe voit aussi passer l'échange, à la cloche
  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'result',
         coalesce(v_actor_pseudo, 'Un joueur') || ' a échangé son équipe avec ' || coalesce(v_target_pseudo, 'un adversaire') || ' !',
         'team_assignments', p_target_id, auth.uid()
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id not in (auth.uid(), p_target_id);
  return 'ok';
end;
$$;

drop function if exists public.use_bonus_inverse(uuid, uuid);
create function public.use_bonus_inverse(p_group_id uuid, p_target_id uuid default null)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_period uuid;
  v_balance integer;
  v_target uuid;
  v_actor_pseudo text;
  v_target_pseudo text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;

  v_target := coalesce(p_target_id, auth.uid());

  if v_target <> auth.uid() and not exists (
    select 1 from group_members where group_id = p_group_id and profile_id = v_target
  ) then
    raise exception 'Cette personne n''est pas membre du groupe';
  end if;

  select id into v_period from group_periods where group_id = p_group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':bonus'));

  if not exists (
    select 1 from team_assignments
    where group_id = p_group_id and profile_id = v_target and period_id = v_period
  ) then
    raise exception 'Cette personne n''a pas encore d''équipe attitrée sur cette période';
  end if;

  if exists (
    select 1 from team_assignments
    where group_id = p_group_id and profile_id = v_target and period_id = v_period and inverted = true
  ) then
    raise exception 'Le bonus inversé est déjà actif sur cette équipe pour cette période';
  end if;

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = p_group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 3 then raise exception 'Pas assez de jetons'; end if;

  if bonus_shield_blocks(p_group_id, v_target, v_period, 3, 'bonus_inverse', 'Bonus inversé') then
    return 'bloque';
  end if;

  update team_assignments
    set inverted = true
    where group_id = p_group_id and profile_id = v_target and period_id = v_period;

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), v_period, -3, 'bonus_inverse', v_target);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();

  if v_target <> auth.uid() then
    select pseudo into v_target_pseudo from profiles where id = v_target;

    insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
    values (
      v_target, 'result',
      coalesce(v_actor_pseudo, 'Un adversaire') || ' a inversé les points de ton équipe attitrée : ses victoires vont maintenant te faire perdre des points !',
      'team_assignments', v_target, auth.uid()
    );

    insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
    select gm.profile_id, 'result',
           coalesce(v_actor_pseudo, 'Un joueur') || ' a inversé les points de l''équipe de ' || coalesce(v_target_pseudo, 'un adversaire') || ' !',
           'team_assignments', v_target, auth.uid()
    from group_members gm
    where gm.group_id = p_group_id and gm.profile_id not in (auth.uid(), v_target);
  else
    insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
    select gm.profile_id, 'result',
           coalesce(v_actor_pseudo, 'Un joueur') || ' a inversé les points de sa propre équipe attitrée !',
           'team_assignments', v_target, auth.uid()
    from group_members gm
    where gm.group_id = p_group_id and gm.profile_id <> auth.uid();
  end if;
  return 'ok';
end;
$$;

drop function if exists public.use_bonus_retirage_force(uuid, uuid);
create function public.use_bonus_retirage_force(p_group_id uuid, p_target_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_period uuid;
  v_balance integer;
  v_pick record;
  v_old_team text;
  v_actor_pseudo text;
  v_target_pseudo text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  if p_target_id = auth.uid() then raise exception 'Impossible de te cibler toi-même'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = p_target_id) then
    raise exception 'Cette personne n''est pas membre du groupe';
  end if;

  select id into v_period from group_periods where group_id = p_group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':bonus'));

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = p_group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 2 then raise exception 'Pas assez de jetons'; end if;

  select team_name into v_old_team from team_assignments
    where group_id = p_group_id and period_id = v_period and profile_id = p_target_id;
  if v_old_team is null then raise exception 'Cette personne n''a pas encore d''équipe attitrée'; end if;

  if bonus_shield_blocks(p_group_id, p_target_id, v_period, 2, 'bonus_retirage_force', 'Retirage forcé') then
    return 'bloque';
  end if;

  delete from team_assignments
    where group_id = p_group_id and period_id = v_period and profile_id = p_target_id;

  select lt.api_team_id, lt.name into v_pick
  from ligue1_teams lt
  where lt.api_team_id not in (
    select ta.api_team_id from team_assignments ta where ta.group_id = p_group_id and ta.period_id = v_period
  )
  order by random() limit 1;

  if v_pick is null then raise exception 'Plus aucune équipe disponible'; end if;

  insert into team_assignments (group_id, profile_id, team_name, api_team_id, period_id)
  values (p_group_id, p_target_id, v_pick.name, v_pick.api_team_id, v_period);

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), v_period, -2, 'bonus_retirage_force', p_target_id);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();
  select pseudo into v_target_pseudo from profiles where id = p_target_id;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  values (
    p_target_id, 'result',
    coalesce(v_actor_pseudo, 'Un adversaire') || ' t''a forcé à retirer une nouvelle équipe (' || v_old_team || ' → ' || v_pick.name || ') !',
    'team_assignments', p_target_id, auth.uid()
  );

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'result',
         coalesce(v_actor_pseudo, 'Un joueur') || ' a forcé ' || coalesce(v_target_pseudo, 'un adversaire') || ' à retirer une nouvelle équipe !',
         'team_assignments', p_target_id, auth.uid()
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id not in (auth.uid(), p_target_id);
  return 'ok';
end;
$$;

drop function if exists public.use_bonus_revanche_penalty(uuid);
create function public.use_bonus_revanche_penalty(p_duel_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  duel penalty_duels%rowtype;
  v_balance integer;
  v_week date := date_trunc('week', now())::date;
  v_opponent uuid;
  v_actor_pseudo text;
  k integer;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into duel from penalty_duels where id = p_duel_id for update;
  if not found then raise exception 'Duel introuvable'; end if;
  if duel.is_ghost then raise exception 'Ce duel ne peut pas être rejoué'; end if;
  if duel.phase <> 'done' then raise exception 'Ce duel n''est pas encore terminé'; end if;
  if auth.uid() not in (duel.player_a_id, duel.player_b_id) then
    raise exception 'Tu ne participes pas à ce duel';
  end if;
  if duel.winner_id is not null and duel.winner_id = auth.uid() then
    raise exception 'Tu as gagné ce duel, impossible de le rejouer';
  end if;
  if duel.created_at < v_week then
    raise exception 'Revanche possible uniquement sur le duel de penalty de la semaine en cours';
  end if;

  v_opponent := case when auth.uid() = duel.player_a_id then duel.player_b_id else duel.player_a_id end;

  perform pg_advisory_xact_lock(hashtext(p_duel_id::text || ':revanche'));
  perform pg_advisory_xact_lock(hashtext(duel.group_id::text || ':bonus'));

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = duel.group_id and profile_id = auth.uid() and period_id = duel.period_id;
  if v_balance < 5 then raise exception 'Pas assez de jetons'; end if;

  if exists (
    select 1 from bonus_duel_replays
    where profile_id = auth.uid() and group_id = duel.group_id and week_start = v_week
  ) then
    raise exception 'Tu as déjà utilisé Revanche cette semaine dans ce groupe';
  end if;

  if bonus_shield_blocks(duel.group_id, v_opponent, duel.period_id, 5, 'bonus_revanche_duel', 'Revanche') then
    return 'bloque';
  end if;

  -- annule les points et le jeton de victoire deja attribues pour ce duel
  delete from points_ledger where group_id = duel.group_id and source_type = 'minijeu' and source_id = p_duel_id;
  delete from token_ledger where group_id = duel.group_id and reason = 'victoire_penalty' and source_id = p_duel_id;

  delete from penalty_duel_attempts where duel_id = p_duel_id;
  for k in 1..3 loop
    insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
    values (p_duel_id, 1, k, duel.player_a_id, duel.player_b_id);
    insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
    values (p_duel_id, 2, k, duel.player_b_id, duel.player_a_id);
  end loop;

  update penalty_duels
    set phase = 'in_progress', score_a = 0, score_b = 0, winner_id = null, finished_at = null
    where id = p_duel_id;

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (duel.group_id, auth.uid(), duel.period_id, -5, 'bonus_revanche_duel', p_duel_id);

  insert into bonus_duel_replays (group_id, profile_id, period_id, game_type, duel_id, week_start)
  values (duel.group_id, auth.uid(), duel.period_id, 'penalty', p_duel_id, v_week);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  values
    (v_opponent, 'duel', coalesce(v_actor_pseudo, 'Ton adversaire') || ' a utilisé Revanche : votre duel de penaltys recommence à zéro !', 'penalty_duels', p_duel_id, auth.uid()),
    (auth.uid(), 'duel', 'Ton duel de penaltys a été remis à zéro, à vous de rejouer !', 'penalty_duels', p_duel_id, v_opponent);
  return 'ok';
end;
$$;

drop function if exists public.use_bonus_revanche_quiz(uuid);
create function public.use_bonus_revanche_quiz(p_duel_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  d weekly_duels%rowtype;
  v_balance integer;
  v_week date := date_trunc('week', now())::date;
  v_opponent uuid;
  v_actor_pseudo text;
  v_my_score integer;
  v_opp_score integer;
  v_latest_week date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into d from weekly_duels where id = p_duel_id for update;
  if not found then raise exception 'Duel introuvable'; end if;
  if d.is_ghost then raise exception 'Ce duel ne peut pas être rejoué'; end if;
  if d.status <> 'done' then raise exception 'Ce duel n''est pas encore terminé'; end if;
  if auth.uid() not in (d.player_a_id, d.player_b_id) then
    raise exception 'Tu ne participes pas à ce duel';
  end if;

  select max(week_start) into v_latest_week from weekly_duels where group_id = d.group_id;
  if d.week_start is distinct from v_latest_week then
    raise exception 'Revanche possible uniquement sur le duel de quiz de la semaine en cours';
  end if;

  if auth.uid() = d.player_a_id then
    v_my_score := d.score_a; v_opp_score := d.score_b; v_opponent := d.player_b_id;
  else
    v_my_score := d.score_b; v_opp_score := d.score_a; v_opponent := d.player_a_id;
  end if;
  if v_my_score > v_opp_score then
    raise exception 'Tu as gagné ce duel, impossible de le rejouer';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_duel_id::text || ':revanche'));
  perform pg_advisory_xact_lock(hashtext(d.group_id::text || ':bonus'));

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = d.group_id and profile_id = auth.uid() and period_id = d.period_id;
  if v_balance < 5 then raise exception 'Pas assez de jetons'; end if;

  if exists (
    select 1 from bonus_duel_replays
    where profile_id = auth.uid() and group_id = d.group_id and week_start = v_week
  ) then
    raise exception 'Tu as déjà utilisé Revanche cette semaine dans ce groupe';
  end if;

  if bonus_shield_blocks(d.group_id, v_opponent, d.period_id, 5, 'bonus_revanche_duel', 'Revanche') then
    return 'bloque';
  end if;

  delete from points_ledger where group_id = d.group_id and source_type = 'duel' and source_id = p_duel_id;
  delete from token_ledger where group_id = d.group_id and reason = 'victoire_quiz' and source_id = p_duel_id;

  delete from duel_answers where duel_id = p_duel_id;
  delete from duel_question_state where duel_id = p_duel_id;
  delete from duel_question_sequence where duel_id = p_duel_id;

  insert into duel_question_sequence (duel_id, question_order, question_id)
  select p_duel_id, row_number() over (order by random()), id
  from quiz_questions
  order by random()
  limit 10;

  update weekly_duels set status = 'scheduled', score_a = null, score_b = null where id = p_duel_id;

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (d.group_id, auth.uid(), d.period_id, -5, 'bonus_revanche_duel', p_duel_id);

  insert into bonus_duel_replays (group_id, profile_id, period_id, game_type, duel_id, week_start)
  values (d.group_id, auth.uid(), d.period_id, 'quiz', p_duel_id, v_week);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  values
    (v_opponent, 'duel', coalesce(v_actor_pseudo, 'Ton adversaire') || ' a utilisé Revanche : votre duel de quiz recommence à zéro avec de nouvelles questions !', 'weekly_duels', p_duel_id, auth.uid()),
    (auth.uid(), 'duel', 'Ton duel de quiz a été remis à zéro avec de nouvelles questions, à vous de rejouer !', 'weekly_duels', p_duel_id, v_opponent);
  return 'ok';
end;
$$;

-- --------------------------------------------------------- nouveaux bonus
create or replace function public.use_bonus_bouclier(p_group_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_period uuid;
  v_balance integer;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;

  select id into v_period from group_periods where group_id = p_group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':bonus'));

  if exists (select 1 from bonus_shields where group_id = p_group_id and profile_id = auth.uid() and consumed_at is null) then
    raise exception 'Tu as déjà un bouclier actif';
  end if;

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = p_group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 2 then raise exception 'Pas assez de jetons'; end if;

  insert into bonus_shields (group_id, profile_id) values (p_group_id, auth.uid());
  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), v_period, -2, 'bonus_bouclier', null);
  -- volontairement aucune notification : le bouclier reste secret
  return 'ok';
end;
$$;

create or replace function public.use_bonus_carton_rouge(p_group_id uuid, p_target_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_period uuid;
  v_balance integer;
  v_actor_pseudo text;
  v_target_pseudo text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  if p_target_id is null or p_target_id = auth.uid() then raise exception 'Impossible de te cibler toi-même'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = p_target_id) then
    raise exception 'Cette personne n''est pas membre du groupe';
  end if;

  select id into v_period from group_periods where group_id = p_group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':bonus'));

  if has_red_card(p_group_id, p_target_id) then
    raise exception 'Ce joueur a déjà un carton rouge en cours';
  end if;

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = p_group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 2 then raise exception 'Pas assez de jetons'; end if;

  if bonus_shield_blocks(p_group_id, p_target_id, v_period, 2, 'bonus_carton_rouge', 'Carton rouge') then
    return 'bloque';
  end if;

  insert into red_cards (group_id, target_id, by_id, expires_at)
  values (p_group_id, p_target_id, auth.uid(), now() + interval '24 hours');

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (p_group_id, auth.uid(), v_period, -2, 'bonus_carton_rouge', p_target_id);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();
  select pseudo into v_target_pseudo from profiles where id = p_target_id;

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  values (p_target_id, 'result',
    '🟥 ' || coalesce(v_actor_pseudo, 'Un adversaire') || ' t''a mis un carton rouge : tu es privé du jeu de la semaine pendant 24 h !',
    null, null, auth.uid());

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'result',
         '🟥 ' || coalesce(v_actor_pseudo, 'Un joueur') || ' a mis un carton rouge à ' || coalesce(v_target_pseudo, 'un adversaire') || ' (24 h) !',
         null, null, auth.uid()
  from group_members gm
  where gm.group_id = p_group_id and gm.profile_id not in (auth.uid(), p_target_id);
  return 'ok';
end;
$$;

create or replace function public.use_bonus_joker(p_match_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  m matches%rowtype;
  v_period uuid;
  v_balance integer;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into m from matches where id = p_match_id;
  if not found then raise exception 'Match introuvable'; end if;
  if not is_group_member(m.group_id) then raise exception 'Pas membre de ce groupe'; end if;
  if m.status <> 'open' or now() >= m.kickoff_at then
    raise exception 'Trop tard : le match a déjà commencé';
  end if;
  if not exists (select 1 from match_predictions where match_id = p_match_id and profile_id = auth.uid()) then
    raise exception 'Fais d''abord ton prono sur ce match';
  end if;

  select id into v_period from group_periods where group_id = m.group_id and is_current limit 1;
  if v_period is null then raise exception 'Aucune période active'; end if;

  perform pg_advisory_xact_lock(hashtext(m.group_id::text || ':bonus'));

  if exists (select 1 from match_jokers where match_id = p_match_id and profile_id = auth.uid()) then
    raise exception 'Joker déjà posé sur ce match';
  end if;

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = m.group_id and profile_id = auth.uid() and period_id = v_period;
  if v_balance < 3 then raise exception 'Pas assez de jetons'; end if;

  insert into match_jokers (match_id, profile_id) values (p_match_id, auth.uid());
  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (m.group_id, auth.uid(), v_period, -3, 'bonus_joker_x2', p_match_id);
  return 'ok';
end;
$$;

revoke execute on function public.use_bonus_echange_equipe(uuid, uuid) from public, anon;
revoke execute on function public.use_bonus_inverse(uuid, uuid) from public, anon;
revoke execute on function public.use_bonus_retirage_force(uuid, uuid) from public, anon;
revoke execute on function public.use_bonus_revanche_penalty(uuid) from public, anon;
revoke execute on function public.use_bonus_revanche_quiz(uuid) from public, anon;
revoke execute on function public.use_bonus_bouclier(uuid) from public, anon;
revoke execute on function public.use_bonus_carton_rouge(uuid, uuid) from public, anon;
revoke execute on function public.use_bonus_joker(uuid) from public, anon;
grant execute on function public.use_bonus_echange_equipe(uuid, uuid) to authenticated;
grant execute on function public.use_bonus_inverse(uuid, uuid) to authenticated;
grant execute on function public.use_bonus_retirage_force(uuid, uuid) to authenticated;
grant execute on function public.use_bonus_revanche_penalty(uuid) to authenticated;
grant execute on function public.use_bonus_revanche_quiz(uuid) to authenticated;
grant execute on function public.use_bonus_bouclier(uuid) to authenticated;
grant execute on function public.use_bonus_carton_rouge(uuid, uuid) to authenticated;
grant execute on function public.use_bonus_joker(uuid) to authenticated;

-- ---------------------------------------- Joker : points doublés au calcul
create or replace function public.resolve_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  m matches%rowtype;
  pred record;
  pts integer;
  diff_real integer;
  diff_pred integer;
  outcome_real text;
  outcome_pred text;
  scorer_correct boolean;
begin
  select * into m from matches
    where id = p_match_id and status = 'open'
      and real_home_score is not null and real_away_score is not null
      and data_finalized = true
    for update;
  if not found then return; end if;

  diff_real := m.real_home_score - m.real_away_score;
  outcome_real := case when diff_real > 0 then 'home' when diff_real < 0 then 'away' else 'draw' end;

  for pred in select * from match_predictions where match_id = p_match_id loop
    pts := 0;

    if pred.pred_home_score = m.real_home_score and pred.pred_away_score = m.real_away_score then
      pts := pts + 5;
    else
      diff_pred := pred.pred_home_score - pred.pred_away_score;
      outcome_pred := case when diff_pred > 0 then 'home' when diff_pred < 0 then 'away' else 'draw' end;
      if outcome_pred = outcome_real and diff_pred = diff_real then
        pts := pts + 4;
      elsif outcome_pred = outcome_real then
        pts := pts + 3;
      end if;
    end if;

    if pred.pred_scorer_id is not null then
      select exists (
        select 1 from match_scorers where match_id = p_match_id and player_id = pred.pred_scorer_id
      ) into scorer_correct;
      if scorer_correct then pts := pts + 1; end if;
    else
      -- v2 : le bonus "aucun buteur deviné juste" exige un VRAI 0-0,
      -- pas juste une absence de donnée de buteur côté API (qui peut
      -- arriver même sur un match avec plusieurs buts)
      if m.real_home_score = 0 and m.real_away_score = 0 then
        pts := pts + 1;
      end if;
    end if;

    -- Joker ×2 posé avant le coup d'envoi
    if exists (select 1 from match_jokers where match_id = p_match_id and profile_id = pred.profile_id) then
      pts := pts * 2;
    end if;

    insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)
    values (m.group_id, pred.profile_id, m.period_id, 'match', pred.id, pts)
    on conflict do nothing;
  end loop;

  update matches set status = 'resolved' where id = p_match_id;
end;
$$;

-- ------------------------- Carton rouge : privé de jeu de la semaine 24 h
create or replace function public.block_red_carded_minigame()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if has_red_card(new.group_id, new.profile_id) then
    raise exception 'Carton rouge : tu es privé du jeu de la semaine pendant 24 h';
  end if;
  return new;
end;
$$;

drop trigger if exists block_red_card on public.juggle_scores;
create trigger block_red_card before insert on public.juggle_scores
  for each row execute function public.block_red_carded_minigame();
drop trigger if exists block_red_card on public.dribble_scores;
create trigger block_red_card before insert on public.dribble_scores
  for each row execute function public.block_red_carded_minigame();
drop trigger if exists block_red_card on public.freekick_scores;
create trigger block_red_card before insert on public.freekick_scores
  for each row execute function public.block_red_carded_minigame();
drop trigger if exists block_red_card on public.weekly_special_predictions;
create trigger block_red_card before insert or update on public.weekly_special_predictions
  for each row execute function public.block_red_carded_minigame();

-- Les versions "toutes mes ligues" sautent les groupes où le joueur a un
-- carton rouge (le score compte quand même dans ses autres groupes).
create or replace function public.submit_juggle_score_all_leagues(p_score integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  v_score integer;
  v_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  -- Même garde-fou que côté client (MAX_SCORE = 2000), répliqué ici car cette
  -- RPC est appelable directement, pas seulement via l'UI.
  v_score := least(greatest(p_score, 0), 2000);

  with inserted as (
    insert into juggle_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

create or replace function public.submit_dribble_score_all_leagues(p_score integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  v_score integer;
  v_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  v_score := least(greatest(p_score, 0), 2000);

  with inserted as (
    insert into dribble_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

create or replace function public.submit_freekick_score_all_leagues(p_score integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  v_score integer := least(greatest(p_score, 0), 2000);
  v_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  with inserted as (
    insert into freekick_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function public.submit_weekly_special_prediction_all_leagues(p_match_id uuid, p_pred_team text, p_pred_minute integer)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  m weekly_special_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into m from weekly_special_matches where id = p_match_id;
  if not found then raise exception 'Match introuvable'; end if;
  if now() >= m.kickoff_at then raise exception 'Coup d''envoi déjà passé'; end if;
  if m.resolved then raise exception 'Ce match est déjà résolu'; end if;

  if p_pred_team not in ('domicile','exterieur','aucun_but') then
    raise exception 'Choix invalide';
  end if;
  if p_pred_team <> 'aucun_but' and (p_pred_minute is null or p_pred_minute < 0 or p_pred_minute > 99) then
    raise exception 'Minute invalide';
  end if;

  with upserted as (
    insert into weekly_special_predictions (match_id, group_id, profile_id, pred_team, pred_minute)
    select p_match_id, gm.group_id, auth.uid(),
           p_pred_team, case when p_pred_team = 'aucun_but' then null else p_pred_minute end
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    on conflict (match_id, group_id, profile_id) do update
      set pred_team = excluded.pred_team,
          pred_minute = excluded.pred_minute,
          updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;
