-- Salle d'attente des nouvelles ligues (demande du 26/10) :
--  * une ligue créée est « en attente du coup d'envoi » (awaiting_kickoff) :
--    on peut rejoindre, mais pas de championnat (pas de période, donc ni
--    équipe, ni matchs, ni duels, ni points) ;
--  * le créateur lance le championnat (start_group_championship) : période
--    ouverte maintenant, équipe tirée pour tout le monde, notification ;
--  * rappel au créateur si la ligue attend depuis plus de 3 jours ;
--  * les ligues existantes ne changent pas (awaiting_kickoff = false).

alter table public.groups add column if not exists awaiting_kickoff boolean not null default false;
alter table public.groups add column if not exists kickoff_reminder_sent boolean not null default false;

-- pas de première période tant que la ligue attend son coup d'envoi
create or replace function public.open_first_group_period()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.awaiting_kickoff then return new; end if;
  insert into group_periods (group_id, label, starts_at, ends_at, is_current)
  values (new.id, fr_month_label(now()), now(), now() + period_duration(new.id), true);
  return new;
end;
$$;

-- une nouvelle ligue démarre en salle d'attente
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.create_group(text,text,uuid,text,integer)'::regprocedure);
  before := def;
  def := replace(def,
    'insert into groups (name, validation_mode, validator_id, created_by, period_type, period_custom_days)',
    'insert into groups (name, validation_mode, validator_id, created_by, period_type, period_custom_days, awaiting_kickoff)');
  def := replace(def,
    'values (trim(p_name), p_validation_mode, p_validator_id, auth.uid(), p_period_type, p_period_custom_days)',
    'values (trim(p_name), p_validation_mode, p_validator_id, auth.uid(), p_period_type, p_period_custom_days, true)');
  if def = before or def not like '%awaiting_kickoff)%' or def not like '%p_period_custom_days, true)%' then
    raise exception 'motif introuvable (create_group)';
  end if;
  execute def;
end $$;

-- coup d'envoi par le créateur
create or replace function public.start_group_championship(p_group_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  g record;
  m record;
begin
  if not is_group_owner(p_group_id) then raise exception 'Seul le créateur de la ligue peut lancer le championnat'; end if;
  perform pg_advisory_xact_lock(hashtext(p_group_id::text));
  select * into g from groups where id = p_group_id;
  if not g.awaiting_kickoff then raise exception 'Le championnat est déjà lancé'; end if;

  update groups set awaiting_kickoff = false where id = p_group_id;
  insert into group_periods (group_id, label, starts_at, ends_at, is_current)
  values (p_group_id, fr_month_label(now()), now(), now() + period_duration(p_group_id), true);

  -- tout le monde tire son équipe en même temps (animation au prochain passage)
  for m in select profile_id from group_members where group_id = p_group_id order by joined_at loop
    perform ensure_team_assignment(p_group_id, m.profile_id);
  end loop;
  update group_members set team_reveal_seen = false where group_id = p_group_id;

  insert into notifications (profile_id, type, text, ref_table, ref_id)
  select gm.profile_id, 'result',
    '🏁 C''est parti ! Le championnat de « ' || g.name || ' » est lancé : découvre ton équipe tirée au sort 🎡 et fais tes pronos !',
    'groups', p_group_id
  from group_members gm where gm.group_id = p_group_id and gm.profile_id <> auth.uid();
end;
$$;
revoke execute on function public.start_group_championship(uuid) from public, anon;
grant execute on function public.start_group_championship(uuid) to authenticated;

-- rappel au créateur : ligue en attente depuis plus de 3 jours
create or replace function public.remind_awaiting_kickoff()
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare g record;
begin
  for g in
    select * from groups
    where awaiting_kickoff and not kickoff_reminder_sent and created_at <= now() - interval '3 days'
      and created_by is not null
  loop
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    values (g.created_by, 'result',
      '⏳ Tes potes t''attendent dans « ' || g.name || ' » ! Quand tout le monde est là, lance le championnat depuis la ligue ⚽',
      'groups', g.id);
    update groups set kickoff_reminder_sent = true where id = g.id;
  end loop;
end;
$$;
revoke execute on function public.remind_awaiting_kickoff() from public, anon, authenticated;
select cron.schedule('rappel-coup-envoi-ligue', '0 17 * * *', 'select public.remind_awaiting_kickoff();');

-- bienvenue : texte adapté à une ligue en salle d'attente
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.welcome_new_member()'::regprocedure);
  before := def;
  def := replace(def, '  if g.ended_at is not null then',
    $b$  if g.awaiting_kickoff then
    v_text := '👋 Bienvenue dans « ' || g.name || ' » ! Le championnat n''a pas encore commencé : '
      || 'le créateur le lancera quand tout le monde sera là. Tu seras prévenu 🔔';
  elsif g.ended_at is not null then$b$);
  if def = before then raise exception 'motif introuvable (welcome_new_member)'; end if;
  execute def;
end $$;

-- les tâches automatiques ignorent les ligues en salle d'attente
do $$
declare f text; def text; before text;
begin
  foreach f in array array['award_weekly_podium(date, regclass, text, text)', 'run_ghost_matchups()', 'resolve_weekly_special_week(date)',
                           'run_latecomer_matchups()', 'run_latecomer_penalty_matchups()', 'run_ghost_penalty_matchups()', 'send_sunday_reminders()'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    before := def;
    def := replace(def, 'from groups where ended_at is null loop', 'from groups where ended_at is null and not awaiting_kickoff loop');
    if def = before then raise exception 'motif introuvable dans %', f; end if;
    execute def;
  end loop;
  foreach f in array array['run_weekly_matchups(uuid)', 'run_weekly_penalty_matchups(uuid)'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    before := def;
    def := replace(def, 'where ended_at is null and (p_group_id is null or id = p_group_id)',
                        'where ended_at is null and not awaiting_kickoff and (p_group_id is null or id = p_group_id)');
    if def = before then raise exception 'motif introuvable dans %', f; end if;
    execute def;
  end loop;

  -- premiers duels : 48 h après le coup d'envoi (et plus la création)
  def := pg_get_functiondef('public.run_deferred_first_matchups()'::regprocedure);
  before := def;
  def := replace(def, 'where gr.created_at <= now() - interval ''48 hours''',
    'where not gr.awaiting_kickoff and gr.ended_at is null
      and coalesce((select min(gp.starts_at) from group_periods gp where gp.group_id = gr.id), gr.created_at) <= now() - interval ''48 hours''');
  if def = before then raise exception 'motif introuvable (run_deferred_first_matchups)'; end if;
  execute def;

  -- contrôle : une ligue en attente n'a pas de duels, normal
  def := pg_get_functiondef('public.run_health_check(boolean)'::regprocedure);
  before := def;
  def := replace(def, 'where g.created_at <= now() - interval ''48 hours''',
    'where g.created_at <= now() - interval ''48 hours'' and not g.awaiting_kickoff and g.ended_at is null
        and coalesce((select min(gp.starts_at) from group_periods gp where gp.group_id = g.id), g.created_at) <= now() - interval ''48 hours''');
  if def = before then raise exception 'motif introuvable (run_health_check)'; end if;
  execute def;
end $$;
