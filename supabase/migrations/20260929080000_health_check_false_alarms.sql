-- Contrôle de santé : deux fausses alertes du 29/09 corrigées
--  1. une tâche encore "en cours" au moment du contrôle comptait comme un
--     échec (le contrôle lui-même, et deferred-first-matchups qui tourne à
--     la même minute) → seules les tâches 'failed' comptent
--  2. les redites de duels tirées par l'ancien tirage (lundi 28/09 00:00),
--     gardées parce que déjà commencées, sont connues → ignorées
-- Et les appels du serveur vers les fonctions (cron-runner, resolve-fixtures,
-- team-assignment-results) : les fonctions répondent bien (200) mais en 1 à
-- 3 s, au-delà du délai d'attente d'1 s → faux "sans réponse". Délai porté à
-- 30 s (l'appel reste asynchrone, la tâche planifiée n'attend pas).

create or replace function public.run_health_check(p_dry_run boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_id constant uuid := '6fa7a7a3-5b6a-4667-9aa7-9a5275aaf532'; -- yoann
  wk date := date_trunc('week', now())::date;
  issues text[] := '{}';
  r record;
  n int;
  v_text text;
begin
  -- 1. tâches planifiées en échec (24 h) — 'failed' uniquement : une tâche
  --    encore en cours au moment du contrôle (dont ce contrôle lui-même)
  --    n'est pas un échec
  for r in
    select j.jobname, count(*) c
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.status = 'failed'
    group by j.jobname
  loop
    issues := issues || format('tâche « %s » en échec (%s fois)', r.jobname, r.c);
  end loop;

  -- 2. appels serveur (push, API foot) en erreur (24 h)
  select count(*) into n from net._http_response
  where created > now() - interval '24 hours' and (status_code >= 400 or status_code is null);
  if n > 0 then
    issues := issues || format('%s appel(s) serveur en erreur ou sans réponse', n);
  end if;

  -- 3. duels : à partir du lundi 07:00 UTC, chaque membre doit avoir son
  --    duel quiz et penalty de la semaine (groupes de plus de 48 h)
  if now() >= wk::timestamptz + interval '7 hours' then
    for r in
      select g.name,
        count(*) filter (where not exists (
          select 1 from weekly_duels d where d.group_id = g.id and d.week_start = wk
            and gm.profile_id in (d.player_a_id, d.player_b_id))) sans_quiz,
        count(*) filter (where not exists (
          select 1 from penalty_duels d where d.group_id = g.id and d.created_at >= wk
            and gm.profile_id in (d.player_a_id, d.player_b_id))) sans_penalty
      from groups g join group_members gm on gm.group_id = g.id
      where g.created_at <= now() - interval '48 hours'
      group by g.name
      having count(*) >= 2  -- un groupe d'un seul joueur n'a pas de duel
    loop
      if r.sans_quiz > 0 or r.sans_penalty > 0 then
        issues := issues || format('« %s » : %s joueur(s) sans duel quiz, %s sans duel penalty',
          r.name, r.sans_quiz, r.sans_penalty);
      end if;
    end loop;

    -- 4. redite évitable : une paire de la semaine déjà rencontrée alors que
    --    les deux joueurs avaient encore des adversaires jamais affrontés
    for r in
      select g.name, x.game, count(*) c
      from (
        -- (les duels tirés avant la correction du tirage du 28/09 13:00 UTC
        --  et gardés car déjà commencés sont connus : on ne les signale pas)
        select d.group_id, 'quiz' game, d.player_a_id a, d.player_b_id b
          from weekly_duels d where d.week_start = wk and d.player_b_id is not null
            and d.created_at >= '2026-09-28 13:00+00'
        union all
        select d.group_id, 'penalty', d.player_a_id, d.player_b_id
          from penalty_duels d where d.created_at >= wk and d.player_b_id is not null and not d.is_ghost
            and d.created_at >= '2026-09-28 13:00+00'
      ) x
      join groups g on g.id = x.group_id
      where exists (
          select 1 from duel_pairing_history h
          where h.group_id = x.group_id and h.game_type = x.game and h.week_start < wk
            and h.player_low_id = least(x.a, x.b) and h.player_high_id = greatest(x.a, x.b))
        and exists (
          select 1 from group_members m where m.group_id = x.group_id and m.profile_id not in (x.a, x.b)
            and not exists (select 1 from duel_pairing_history h where h.group_id = x.group_id and h.game_type = x.game
              and h.player_low_id = least(x.a, m.profile_id) and h.player_high_id = greatest(x.a, m.profile_id)))
        and exists (
          select 1 from group_members m where m.group_id = x.group_id and m.profile_id not in (x.a, x.b)
            and not exists (select 1 from duel_pairing_history h where h.group_id = x.group_id and h.game_type = x.game
              and h.player_low_id = least(x.b, m.profile_id) and h.player_high_id = greatest(x.b, m.profile_id)))
      group by g.name, x.game
    loop
      issues := issues || format('« %s » : %s duel(s) %s en redite peut-être évitable', r.name, r.c, r.game);
    end loop;

    -- 5. mini-jeu de la semaine attribué
    if not exists (select 1 from minigame_weeks where week_start = wk) then
      issues := issues || 'aucun mini-jeu attribué cette semaine';
    end if;
  end if;

  -- 6. matchs commencés depuis plus de 6 h et toujours pas résolus
  select count(*) into n from matches
  where status = 'open' and kickoff_at < now() - interval '6 hours';
  if n > 0 then
    issues := issues || format('%s match(s) terminé(s) mais pas encore résolu(s)', n);
  end if;

  if array_length(issues, 1) is null then
    return 'OK';
  end if;

  v_text := '🩺 Contrôle Entre Nous : ' || array_to_string(issues, ' · ');
  if not p_dry_run then
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    values (admin_id, 'result', v_text, null, null);
  end if;
  return v_text;
end;
$$;


do $$
declare j record;
begin
  for j in select jobid, command from cron.job where command ilike '%net.http_post%' loop
    perform cron.alter_job(j.jobid, command := regexp_replace(j.command, 'timeout_milliseconds\s*:=\s*\d+', 'timeout_milliseconds:=30000'));
  end loop;
end $$;
