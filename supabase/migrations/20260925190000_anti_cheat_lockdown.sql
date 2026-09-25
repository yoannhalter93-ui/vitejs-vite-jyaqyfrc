-- Anti-triche : l'appli ne passe QUE par des RPC SECURITY DEFINER pour jouer
-- (submit_duel_answer, request_duel_question, submit_shot, submit_save...).
-- Les policies d'écriture directe ci-dessous permettaient pourtant, avec la
-- clé publique du site, de réécrire son score/celui de l'adversaire, de
-- créer des duels arbitraires, de relancer le chrono d'une question, et les
-- policies de lecture de voir les bonnes réponses du quiz / la zone de tir de
-- l'adversaire avant de plonger.

-- 1. Duels quiz / penalty : plus aucune écriture directe
drop policy if exists "creer un duel" on public.weekly_duels;
drop policy if exists "maj son duel" on public.weekly_duels;
drop policy if exists "creer un duel penalty" on public.penalty_duels;
drop policy if exists "maj son duel penalty" on public.penalty_duels;
drop policy if exists "tirer" on public.penalty_duel_attempts;
drop policy if exists "arreter" on public.penalty_duel_attempts;
drop policy if exists "repondre a sa question" on public.duel_answers;
drop policy if exists "creer sequence de son duel" on public.duel_question_sequence;
drop policy if exists "demarrer question de son duel" on public.duel_question_state;
drop policy if exists "maj timing de son duel" on public.duel_question_state;

revoke insert, update, delete on public.weekly_duels, public.penalty_duels,
  public.penalty_duel_attempts, public.duel_answers,
  public.duel_question_sequence, public.duel_question_state
  from anon, authenticated;

-- 2. Lectures qui révélaient la solution
--    - quiz_questions.correct_index + duel_question_sequence = les 10
--      questions et leurs réponses lisibles avant de jouer. Le client
--      n'utilise que request_duel_question / get_duel_review (DEFINER).
drop policy if exists "lecture questions quiz" on public.quiz_questions;
drop policy if exists "voir sequence de son duel" on public.duel_question_sequence;
revoke select on public.quiz_questions, public.duel_question_sequence from anon, authenticated;

--    - penalty_duel_attempts.shooter_zone lisible par le gardien avant sa
--      plongée. Le jeu passe par get_penalty_duel_attempts (qui masque déjà
--      la zone) ; la liste "Mes duels" utilise désormais
--      get_penalty_play_flags ci-dessous.
drop policy if exists "voir ses tirs" on public.penalty_duel_attempts;
revoke select on public.penalty_duel_attempts from anon, authenticated;

create or replace function public.get_penalty_play_flags(p_duel_ids uuid[])
returns table(duel_id uuid, shooter_id uuid, keeper_id uuid, shot_taken boolean, save_made boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.duel_id, a.shooter_id, a.keeper_id,
         a.shooter_zone is not null, a.keeper_zone is not null
  from penalty_duel_attempts a
  join penalty_duels d on d.id = a.duel_id
  where a.duel_id = any(p_duel_ids)
    and is_group_member(d.group_id);
$$;
revoke execute on function public.get_penalty_play_flags(uuid[]) from public, anon;
grant execute on function public.get_penalty_play_flags(uuid[]) to authenticated;

-- 3. Tirage d'équipe : le client choisissait l'équipe lui-même. Le nouveau
--    front appelle assign_random_team (DEFINER, tirage côté serveur) ; en
--    attendant qu'il soit déployé, un insert direct depuis le client voit
--    son équipe remplacée par un tirage serveur.
grant execute on function public.assign_random_team(uuid) to authenticated;

create or replace function public.force_server_team_draw()
returns trigger
language plpgsql
-- volontairement SECURITY INVOKER : current_user doit refléter l'appelant
set search_path to 'public'
as $$
declare
  v_pick record;
begin
  -- uniquement pour les inserts directs du client (les fonctions DEFINER
  -- comme ensure_team_assignment tournent en tant que propriétaire)
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select lt.api_team_id, lt.name into v_pick
  from ligue1_teams lt
  where lt.api_team_id not in (
    select ta.api_team_id from team_assignments ta
    where ta.group_id = new.group_id and ta.period_id = new.period_id
  )
  order by random()
  limit 1;

  if v_pick is null then
    raise exception 'Toutes les équipes sont déjà prises dans ce groupe';
  end if;

  new.team_name := v_pick.name;
  new.api_team_id := v_pick.api_team_id;
  new.inverted := false;
  return new;
end;
$$;

drop trigger if exists trg_force_server_team_draw on public.team_assignments;
create trigger trg_force_server_team_draw
  before insert on public.team_assignments
  for each row execute function public.force_server_team_draw();

-- 4. Scores jonglage / dribble : plafond et semaine imposés côté serveur
--    (même garde-fou que les RPC *_all_leagues, qui plafonnent à 2000).
alter table public.juggle_scores
  add constraint juggle_scores_score_range check (score between 0 and 2000);
alter table public.dribble_scores
  add constraint dribble_scores_score_range check (score between 0 and 2000);

create or replace function public.force_minigame_score_week()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.week_start := date_trunc('week', now())::date;
    new.score := least(greatest(new.score, 0), 2000);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_force_juggle_week on public.juggle_scores;
create trigger trg_force_juggle_week
  before insert on public.juggle_scores
  for each row execute function public.force_minigame_score_week();

drop trigger if exists trg_force_dribble_week on public.dribble_scores;
create trigger trg_force_dribble_week
  before insert on public.dribble_scores
  for each row execute function public.force_minigame_score_week();

-- 5. Fonctions de cron appelables par n'importe quel joueur connecté
revoke execute on function public.expire_stale_weekly_duels() from public, anon, authenticated;
revoke execute on function public.expire_stale_penalty_duels() from public, anon, authenticated;
