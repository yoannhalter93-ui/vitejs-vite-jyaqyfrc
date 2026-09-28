-- Tirage des duels (quiz et penalty) : fin des adversaires en double.
--
-- Bug 1 : run_latecomer_(penalty_)matchups (toutes les 15 min) tournait dès
-- lundi 00:00. À cette heure-là personne n'a encore de duel pour la nouvelle
-- semaine, donc TOUT le monde était considéré comme "retardataire" et
-- apparié par ordre d'inscription dans le groupe, sans regarder qui s'était
-- déjà affronté. Le vrai tirage de 06:00/06:10 ne trouvait ensuite plus
-- personne à apparier. → les retardataires attendent lundi 06:30.
--
-- Bug 2 : le vrai tirage était glouton (premier adversaire encore jamais
-- rencontré, sinon n'importe qui) et pouvait forcer une redite alors qu'un
-- tirage sans redite existait. → draw_duel_pairs essaie des centaines de
-- combinaisons et garde celle qui coûte le moins : 0 tant que chacun n'a pas
-- croisé tout le groupe ; ensuite on privilégie les paires qui se sont le
-- moins, et le moins récemment, affrontées.

create or replace function public.draw_duel_pairs(
  p_group_id uuid, p_game text, p_members uuid[], p_tries int default 300
)
returns table(pa uuid, pb uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int := coalesce(array_length(p_members, 1), 0);
  costs jsonb;
  best uuid[];
  best_cost numeric;
  shuffled uuid[];
  used boolean[];
  cur uuid[];
  cur_cost numeric;
  t int; i int; j int; bj int;
  bc numeric; c numeric; exact numeric;
  k int;
begin
  if n < 2 then return; end if;

  -- coût d'une paire : 1000 par rencontre passée + jusqu'à 52 selon la
  -- fraîcheur de la dernière (une redite récente coûte plus cher)
  select coalesce(jsonb_object_agg(key, cost), '{}'::jsonb) into costs
  from (
    select player_low_id::text || '|' || player_high_id::text as key,
      count(*) * 1000 + greatest(0, 52 - min((current_date - week_start) / 7)) as cost
    from duel_pairing_history
    where group_id = p_group_id and game_type = p_game
    group by player_low_id, player_high_id
  ) x;

  for t in 1..p_tries loop
    select array_agg(m order by random()) into shuffled from unnest(p_members) m;
    used := array_fill(false, array[n]);
    cur := '{}';
    cur_cost := 0;

    for i in 1..n loop
      if used[i] then continue; end if;
      bj := null; bc := null;
      for j in (i + 1)..n loop
        if used[j] then continue; end if;
        exact := coalesce((costs ->> (least(shuffled[i], shuffled[j])::text || '|' || greatest(shuffled[i], shuffled[j])::text))::numeric, 0);
        c := exact + random() * 0.5;
        if bc is null or c < bc then bj := j; bc := c; end if;
      end loop;
      exit when bj is null;  -- nombre impair : le dernier reste seul
      used[i] := true;
      used[bj] := true;
      cur := cur || shuffled[i] || shuffled[bj];
      cur_cost := cur_cost + floor(bc);
    end loop;

    if best_cost is null or cur_cost < best_cost then
      best := cur;
      best_cost := cur_cost;
    end if;
    exit when best_cost = 0;
  end loop;

  k := 1;
  while k < coalesce(array_length(best, 1), 0) loop
    pa := best[k];
    pb := best[k + 1];
    return next;
    k := k + 2;
  end loop;
end;
$$;

revoke execute on function public.draw_duel_pairs(uuid, text, uuid[], int) from public, anon, authenticated;

-- ===== Quiz =====
create or replace function public.run_weekly_matchups(p_group_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  r record;
  members uuid[];
  wk date := date_trunc('week', now())::date;
  pa uuid;
  pb uuid;
  new_duel_id uuid;
  leftover uuid[];
begin
  for g in
    select id as group_id from groups
    where (p_group_id is null or id = p_group_id)
      and created_at <= now() - interval '48 hours'
  loop
    select array_agg(profile_id) into members
    from group_members gm
    where gm.group_id = g.group_id
      and gm.profile_id not in (
        select player_a_id from weekly_duels where group_id = g.group_id and week_start = wk
        union
        select player_b_id from weekly_duels where group_id = g.group_id and week_start = wk and player_b_id is not null
      );

    if members is not null and array_length(members, 1) >= 2 then
      for r in select * from draw_duel_pairs(g.group_id, 'quiz', members) loop
        insert into weekly_duels (group_id, player_a_id, player_b_id, week_start, status, score_a, score_b)
        values (g.group_id, r.pa, r.pb, wk, 'scheduled', null, null)
        returning id into new_duel_id;

        insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
        values (g.group_id, 'quiz', least(r.pa, r.pb), greatest(r.pa, r.pb), wk);

        insert into notifications (profile_id, type, text, ref_table, ref_id)
        values
          (r.pa, 'duel', 'Nouveau duel de quiz cette semaine !', 'weekly_duels', new_duel_id),
          (r.pb, 'duel', 'Nouveau duel de quiz cette semaine !', 'weekly_duels', new_duel_id);
      end loop;
    end if;

    -- nombre impair : le dernier joue un 2e duel contre quelqu'un qu'il a
    -- le moins affronté (et qui n'a pas déjà 2 duels)
    leftover := array(
      select gm2.profile_id
      from group_members gm2
      where gm2.group_id = g.group_id
        and gm2.profile_id not in (
          select player_a_id from weekly_duels where group_id = g.group_id and week_start = wk
          union
          select player_b_id from weekly_duels where group_id = g.group_id and week_start = wk and player_b_id is not null
        )
    );

    if array_length(leftover, 1) = 1 then
      pa := leftover[1];
      pb := null;

      select gm2.profile_id into pb
      from group_members gm2
      where gm2.group_id = g.group_id and gm2.profile_id <> pa
      order by
        (select count(*) from duel_pairing_history
          where group_id = g.group_id and game_type = 'quiz'
            and player_low_id = least(pa, gm2.profile_id) and player_high_id = greatest(pa, gm2.profile_id)),
        (
          (select count(*) from weekly_duels wd
             where wd.group_id = g.group_id and wd.week_start = wk
               and (wd.player_a_id = gm2.profile_id or wd.player_b_id = gm2.profile_id)) >= 2
        )::int,
        random()
      limit 1;

      if pb is not null then
        insert into weekly_duels (group_id, player_a_id, player_b_id, week_start, status, score_a, score_b)
        values (g.group_id, pa, pb, wk, 'scheduled', null, null)
        returning id into new_duel_id;

        insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
        values (g.group_id, 'quiz', least(pa, pb), greatest(pa, pb), wk);

        insert into notifications (profile_id, type, text, ref_table, ref_id)
        values
          (pa, 'duel', 'Nouveau duel de quiz cette semaine !', 'weekly_duels', new_duel_id),
          (pb, 'duel', 'Nouveau duel de quiz cette semaine !', 'weekly_duels', new_duel_id);
      end if;
    end if;
  end loop;
end;
$$;

-- ===== Penalty =====
create or replace function public.run_weekly_penalty_matchups(p_group_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  r record;
  members uuid[];
  wk date := date_trunc('week', now())::date;
  wk_end date := wk + 7;
  k int;
  pa uuid;
  pb uuid;
  new_duel_id uuid;
  leftover uuid[];
begin
  for g in
    select id as group_id from groups
    where (p_group_id is null or id = p_group_id)
      and created_at <= now() - interval '48 hours'
  loop
    select array_agg(profile_id) into members
    from group_members gm
    where gm.group_id = g.group_id
      and gm.profile_id not in (
        select player_a_id from penalty_duels
          where group_id = g.group_id and created_at >= wk and created_at < wk_end
        union
        select player_b_id from penalty_duels
          where group_id = g.group_id and created_at >= wk and created_at < wk_end and player_b_id is not null
      );

    if members is not null and array_length(members, 1) >= 2 then
      for r in select * from draw_duel_pairs(g.group_id, 'penalty', members) loop
        insert into penalty_duels (group_id, player_a_id, player_b_id)
        values (g.group_id, r.pa, r.pb)
        returning id into new_duel_id;

        for k in 1..3 loop
          insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
          values (new_duel_id, 1, k, r.pa, r.pb);
          insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
          values (new_duel_id, 2, k, r.pb, r.pa);
        end loop;

        insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
        values (g.group_id, 'penalty', least(r.pa, r.pb), greatest(r.pa, r.pb), wk);

        insert into notifications (profile_id, type, text, ref_table, ref_id)
        values
          (r.pa, 'duel', 'Nouveau duel de penaltys ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', new_duel_id),
          (r.pb, 'duel', 'Nouveau duel de penaltys ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', new_duel_id);
      end loop;
    end if;

    leftover := array(
      select gm2.profile_id
      from group_members gm2
      where gm2.group_id = g.group_id
        and gm2.profile_id not in (
          select player_a_id from penalty_duels
            where group_id = g.group_id and created_at >= wk and created_at < wk_end
          union
          select player_b_id from penalty_duels
            where group_id = g.group_id and created_at >= wk and created_at < wk_end and player_b_id is not null
        )
    );

    if array_length(leftover, 1) = 1 then
      pa := leftover[1];
      pb := null;

      select gm2.profile_id into pb
      from group_members gm2
      where gm2.group_id = g.group_id and gm2.profile_id <> pa
      order by
        (select count(*) from duel_pairing_history
          where group_id = g.group_id and game_type = 'penalty'
            and player_low_id = least(pa, gm2.profile_id) and player_high_id = greatest(pa, gm2.profile_id)),
        (
          (select count(*) from penalty_duels pd
             where pd.group_id = g.group_id and pd.created_at >= wk and pd.created_at < wk_end
               and (pd.player_a_id = gm2.profile_id or pd.player_b_id = gm2.profile_id)) >= 2
        )::int,
        random()
      limit 1;

      if pb is not null then
        insert into penalty_duels (group_id, player_a_id, player_b_id)
        values (g.group_id, pa, pb)
        returning id into new_duel_id;

        for k in 1..3 loop
          insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
          values (new_duel_id, 1, k, pa, pb);
          insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
          values (new_duel_id, 2, k, pb, pa);
        end loop;

        insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
        values (g.group_id, 'penalty', least(pa, pb), greatest(pa, pb), wk);

        insert into notifications (profile_id, type, text, ref_table, ref_id)
        values
          (pa, 'duel', 'Nouveau duel de penaltys ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', new_duel_id),
          (pb, 'duel', 'Nouveau duel de penaltys ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', new_duel_id);
      end if;
    end if;
  end loop;
end;
$$;

-- ===== Retardataires : pas avant le vrai tirage du lundi =====
-- Même code qu'avant, avec une seule garde en tête : rien avant lundi 06:30
-- UTC (le tirage de la semaine tourne à 06:00 / 06:10).
create or replace function public.run_latecomer_matchups()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  wk date := date_trunc('week', now())::date;
  straggler_id uuid;
  placeholder_id uuid;
  placeholder_player_a uuid;
  new_duel_id uuid;
  v_pseudo text;
begin
  if now() < wk::timestamptz + interval '6 hours 30 minutes' then
    return;
  end if;

  for g in select id as group_id from groups loop
    if not exists (select 1 from weekly_duels where group_id = g.group_id) then
      continue;
    end if;

    for straggler_id in
      select gm.profile_id
      from group_members gm
      where gm.group_id = g.group_id
        and gm.profile_id not in (
          select player_a_id from weekly_duels where group_id = g.group_id and week_start = wk
          union
          select player_b_id from weekly_duels where group_id = g.group_id and week_start = wk and player_b_id is not null
        )
      order by gm.joined_at
    loop
      begin
        placeholder_id := null;
        select id, player_a_id into placeholder_id, placeholder_player_a
          from weekly_duels
          where group_id = g.group_id and week_start = wk and status = 'waiting_opponent'
          order by created_at asc limit 1;

        if placeholder_id is not null then
          update weekly_duels set player_b_id = straggler_id, status = 'scheduled'
            where id = placeholder_id;

          insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
          values (g.group_id, 'quiz', least(placeholder_player_a, straggler_id), greatest(placeholder_player_a, straggler_id), wk);

          select pseudo into v_pseudo from profiles where id = straggler_id;
          insert into notifications (profile_id, type, text, ref_table, ref_id) values
            (placeholder_player_a, 'duel', 'Ton adversaire est arrivé (' || coalesce(v_pseudo, '???') || ') ! À toi de jouer au quiz.', 'weekly_duels', placeholder_id),
            (straggler_id, 'duel', 'Nouveau duel de quiz cette semaine !', 'weekly_duels', placeholder_id);
        else
          insert into weekly_duels (group_id, player_a_id, player_b_id, week_start, status, score_a, score_b)
          values (g.group_id, straggler_id, null, wk, 'waiting_opponent', null, null)
          returning id into new_duel_id;

          insert into notifications (profile_id, type, text, ref_table, ref_id) values
            (straggler_id, 'duel', 'Duel de quiz de la semaine : en attente d''un adversaire...', 'weekly_duels', new_duel_id);
        end if;
      exception when others then
        raise warning 'run_latecomer_matchups: pairing echoue pour group %, straggler % (placeholder %): %', g.group_id, straggler_id, placeholder_id, sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;

create or replace function public.run_latecomer_penalty_matchups()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  wk date := date_trunc('week', now())::date;
  wk_end date := wk + 7;
  straggler_id uuid;
  placeholder_id uuid;
  placeholder_player_a uuid;
  new_duel_id uuid;
  v_pseudo text;
  k int;
begin
  if now() < wk::timestamptz + interval '6 hours 30 minutes' then
    return;
  end if;

  for g in select id as group_id from groups loop
    if not exists (select 1 from penalty_duels where group_id = g.group_id) then
      continue;
    end if;

    for straggler_id in
      select gm.profile_id
      from group_members gm
      where gm.group_id = g.group_id
        and gm.profile_id not in (
          select player_a_id from penalty_duels
            where group_id = g.group_id and created_at >= wk and created_at < wk_end
          union
          select player_b_id from penalty_duels
            where group_id = g.group_id and created_at >= wk and created_at < wk_end and player_b_id is not null
        )
      order by gm.joined_at
    loop
      begin
        placeholder_id := null;
        select id, player_a_id into placeholder_id, placeholder_player_a
          from penalty_duels
          where group_id = g.group_id and created_at >= wk and created_at < wk_end and phase = 'waiting_opponent'
          order by created_at asc limit 1;

        if placeholder_id is not null then
          update penalty_duels set player_b_id = straggler_id, phase = 'in_progress'
            where id = placeholder_id;

          for k in 1..3 loop
            insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
            values (placeholder_id, 1, k, placeholder_player_a, straggler_id);
            insert into penalty_duel_attempts (duel_id, phase_number, attempt_number, shooter_id, keeper_id)
            values (placeholder_id, 2, k, straggler_id, placeholder_player_a);
          end loop;

          insert into duel_pairing_history (group_id, game_type, player_low_id, player_high_id, week_start)
          values (g.group_id, 'penalty', least(placeholder_player_a, straggler_id), greatest(placeholder_player_a, straggler_id), wk);

          select pseudo into v_pseudo from profiles where id = straggler_id;
          insert into notifications (profile_id, type, text, ref_table, ref_id) values
            (placeholder_player_a, 'duel', 'Ton adversaire est arrivé (' || coalesce(v_pseudo, '???') || ') ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', placeholder_id),
            (straggler_id, 'duel', 'Nouveau duel de penaltys ! Tire tes 3 penaltys quand tu veux.', 'penalty_duels', placeholder_id);
        else
          insert into penalty_duels (group_id, player_a_id, player_b_id, phase, score_a, score_b)
          values (g.group_id, straggler_id, null, 'waiting_opponent', 0, 0)
          returning id into new_duel_id;

          insert into notifications (profile_id, type, text, ref_table, ref_id) values
            (straggler_id, 'duel', 'Duel de penaltys de la semaine : en attente d''un adversaire...', 'penalty_duels', new_duel_id);
        end if;
      exception when others then
        raise warning 'run_latecomer_penalty_matchups: pairing echoue pour group %, straggler % (placeholder %): %', g.group_id, straggler_id, placeholder_id, sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;
