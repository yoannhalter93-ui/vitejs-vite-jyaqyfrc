-- Récap de la semaine écoulée (lundi → dimanche) pour un groupe, vu par
-- l'utilisateur connecté : écran "Récap de la semaine" (Recap.tsx) et case
-- de l'accueil. Mêmes sources que la notification du lundi
-- (send_weekly_recaps) : points_ledger, pronostics, duels, mini-jeu.
create or replace function public.get_week_recap(p_group_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  wk_end timestamptz := date_trunc('week', now());
  wk_start timestamptz := date_trunc('week', now()) - interval '7 days';
  v_game text;
  v_minigame json;
  v_result json;
begin
  if me is null or not exists (
    select 1 from group_members where group_id = p_group_id and profile_id = me
  ) then
    raise exception 'not a member';
  end if;

  select game_key into v_game from minigame_weeks where week_start = wk_start::date;

  if v_game in ('jonglage', 'dribble', 'coup-franc') then
    with s as (
      select profile_id, max(score) as best
      from (
        select profile_id, score from juggle_scores
          where v_game = 'jonglage' and group_id = p_group_id and week_start = wk_start::date
        union all
        select profile_id, score from dribble_scores
          where v_game = 'dribble' and group_id = p_group_id and week_start = wk_start::date
        union all
        select profile_id, score from freekick_scores
          where v_game = 'coup-franc' and group_id = p_group_id and week_start = wk_start::date
      ) x
      group by profile_id
    )
    select json_build_object(
      'game', v_game,
      'winner', (select p.pseudo from s join profiles p on p.id = s.profile_id order by s.best desc limit 1),
      'best', (select max(best) from s),
      'mine', (select best from s where profile_id = me),
      'players', (select count(*) from s)
    ) into v_minigame;
  elsif v_game is not null then
    v_minigame := json_build_object('game', v_game);
  end if;

  with pts as (
    select gm.profile_id, coalesce(sum(pl.points), 0)::int as points
    from group_members gm
    left join points_ledger pl
      on pl.group_id = gm.group_id and pl.profile_id = gm.profile_id
     and pl.created_at >= wk_start and pl.created_at < wk_end
    where gm.group_id = p_group_id
    group by gm.profile_id
  ),
  ranked as (
    select pts.*, rank() over (order by points desc)::int as rnk from pts
  ),
  exacts as (
    select mp.profile_id, count(*)::int as n
    from match_predictions mp
    join matches m on m.id = mp.match_id
    where m.group_id = p_group_id and m.status = 'resolved'
      and m.kickoff_at >= wk_start and m.kickoff_at < wk_end
      and mp.pred_home_score = m.real_home_score and mp.pred_away_score = m.real_away_score
    group by mp.profile_id
  ),
  my_duels as (
    select 'quiz' as kind,
      case when d.player_a_id = me then d.player_b_id else d.player_a_id end as opp,
      case
        when coalesce(d.score_a, 0) = coalesce(d.score_b, 0) then 'draw'
        when (d.player_a_id = me) = (coalesce(d.score_a, 0) > coalesce(d.score_b, 0)) then 'won'
        else 'lost'
      end as result
    from weekly_duels d
    where d.group_id = p_group_id and d.status = 'done' and d.week_start = wk_start::date
      and me in (d.player_a_id, d.player_b_id)
    union all
    select 'penalty',
      case when d.player_a_id = me then d.player_b_id else d.player_a_id end,
      case when d.winner_id is null then 'draw' when d.winner_id = me then 'won' else 'lost' end
    from penalty_duels d
    where d.group_id = p_group_id and d.phase = 'done'
      and d.created_at >= wk_start and d.created_at < wk_end
      and me in (d.player_a_id, d.player_b_id)
  )
  select json_build_object(
    'week_start', wk_start::date,
    'week_end', (wk_end - interval '1 day')::date,
    'podium', coalesce((
      select json_agg(json_build_object(
        'pseudo', p.pseudo, 'avatar_url', p.avatar_url, 'avatar_emoji', p.avatar_emoji,
        'points', r.points, 'rank', r.rnk, 'is_me', r.profile_id = me
      ) order by r.points desc, p.pseudo)
      from (select * from ranked where points > 0 order by points desc limit 3) r
      join profiles p on p.id = r.profile_id
    ), '[]'::json),
    'me', (select json_build_object('points', points, 'rank', rnk) from ranked where profile_id = me),
    'members', (select count(*) from ranked),
    'exact_king', (
      select json_build_object('pseudo', p.pseudo, 'count', e.n)
      from exacts e join profiles p on p.id = e.profile_id
      order by e.n desc, p.pseudo limit 1
    ),
    'my_exact', coalesce((select n from exacts where profile_id = me), 0),
    'duels', coalesce((
      select json_agg(json_build_object('kind', d.kind, 'opponent', p.pseudo, 'result', d.result))
      from my_duels d left join profiles p on p.id = d.opp
    ), '[]'::json),
    'minigame', v_minigame
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_week_recap(uuid) from public, anon;
grant execute on function public.get_week_recap(uuid) to authenticated;
