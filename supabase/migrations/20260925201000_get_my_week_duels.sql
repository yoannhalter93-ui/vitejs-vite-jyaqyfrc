-- État réel de mes duels (quiz + penalty) de la semaine dans un groupe, pour
-- les tuiles de l'accueil (avant : textes fixes "Un pote t'attend" /
-- "Nouveau duel", affichés même sans duel ou une fois le duel fini).
-- state : none | waiting_draw | to_play | waiting | won | lost | draw
create or replace function public.get_my_week_duels(p_group_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  q weekly_duels%rowtype;
  p penalty_duels%rowtype;
  v_opp uuid;
  v_quiz json;
  v_pen json;
  v_state text;
  v_answered int;
begin
  if v_me is null then raise exception 'Utilisateur non authentifié'; end if;
  if not is_group_member(p_group_id) then raise exception 'Pas membre de ce groupe'; end if;

  -- quiz : duel de la semaine la plus récente du groupe
  select * into q from weekly_duels
  where group_id = p_group_id and v_me in (player_a_id, player_b_id)
    and week_start = (select max(week_start) from weekly_duels where group_id = p_group_id)
  order by is_ghost, created_at desc limit 1;

  if not found then
    v_quiz := json_build_object('state', 'none');
  else
    v_opp := case when q.player_a_id = v_me then q.player_b_id else q.player_a_id end;
    if q.status = 'waiting_opponent' then v_state := 'waiting_draw';
    elsif q.status = 'done' then
      v_state := case
        when coalesce(q.score_a, 0) = coalesce(q.score_b, 0) then 'draw'
        when (q.player_a_id = v_me) = (coalesce(q.score_a, 0) > coalesce(q.score_b, 0)) then 'won'
        else 'lost' end;
    else
      select count(*) into v_answered from duel_answers where duel_id = q.id and profile_id = v_me;
      v_state := case when v_answered < 10 then 'to_play' else 'waiting' end;
    end if;
    v_quiz := json_build_object('state', v_state,
      'opponent', (select pseudo from profiles where id = v_opp));
  end if;

  -- penalty : dernier duel créé cette semaine
  select * into p from penalty_duels
  where group_id = p_group_id and v_me in (player_a_id, player_b_id)
    and created_at >= date_trunc('week', now())
  order by is_ghost, created_at desc limit 1;

  if not found then
    v_pen := json_build_object('state', 'none');
  else
    v_opp := case when p.player_a_id = v_me then p.player_b_id else p.player_a_id end;
    if p.phase = 'waiting_opponent' then v_state := 'waiting_draw';
    elsif p.phase = 'done' then
      v_state := case when p.winner_id is null then 'draw' when p.winner_id = v_me then 'won' else 'lost' end;
    elsif exists (
      select 1 from penalty_duel_attempts a
      where a.duel_id = p.id
        and ((a.shooter_id = v_me and a.shooter_zone is null)
          or (a.keeper_id = v_me and a.shooter_zone is not null and a.resolved_at is null))
    ) then v_state := 'to_play';
    else v_state := 'waiting';
    end if;
    v_pen := json_build_object('state', v_state,
      'opponent', (select pseudo from profiles where id = v_opp));
  end if;

  return json_build_object('quiz', v_quiz, 'penalty', v_pen);
end;
$$;

revoke execute on function public.get_my_week_duels(uuid) from public, anon;
grant execute on function public.get_my_week_duels(uuid) to authenticated;
