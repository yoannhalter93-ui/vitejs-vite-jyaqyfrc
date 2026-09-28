-- Contrôle de santé quotidien : repère les anomalies AVANT que les joueurs
-- ne les découvrent, et prévient l'administrateur (Yoann) par une
-- notification (donc aussi en push). Rien n'est envoyé si tout va bien.
--   select public.run_health_check(true);  -- aperçu, sans notifier
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
  -- 1. tâches planifiées en échec (24 h)
  for r in
    select j.jobname, count(*) c
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.status <> 'succeeded'
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
        select d.group_id, 'quiz' game, d.player_a_id a, d.player_b_id b
          from weekly_duels d where d.week_start = wk and d.player_b_id is not null
        union all
        select d.group_id, 'penalty', d.player_a_id, d.player_b_id
          from penalty_duels d where d.created_at >= wk and d.player_b_id is not null and not d.is_ghost
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

revoke execute on function public.run_health_check(boolean) from public, anon, authenticated;

select cron.schedule('daily-health-check', '5 7 * * *', 'select public.run_health_check()');
