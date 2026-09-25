-- Statistiques personnelles (écran Profil > Mes statistiques), tous groupes
-- confondus. Barème des pronos identique à la page Règles : score exact,
-- bon écart + bon résultat, bon résultat.
create or replace function public.get_my_stats()
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() as id),
  preds as (
    select mp.pred_home_score ph, mp.pred_away_score pa, m.real_home_score rh, m.real_away_score ra
    from match_predictions mp join matches m on m.id = mp.match_id
    where mp.profile_id = (select id from me) and m.status = 'resolved'
      and m.real_home_score is not null and m.real_away_score is not null
  ),
  quiz as (
    select case
      when coalesce(score_a,0) = coalesce(score_b,0) then 'draw'
      when (player_a_id = (select id from me)) = (coalesce(score_a,0) > coalesce(score_b,0)) then 'won'
      else 'lost' end res
    from weekly_duels
    where status = 'done' and (select id from me) in (player_a_id, player_b_id)
      and not (is_ghost and player_b_id = (select id from me))
  ),
  pen as (
    select case when winner_id is null then 'draw' when winner_id = (select id from me) then 'won' else 'lost' end res
    from penalty_duels
    where phase = 'done' and (select id from me) in (player_a_id, player_b_id)
      and not (is_ghost and player_b_id = (select id from me))
  )
  select json_build_object(
    'predictions', json_build_object(
      'played', (select count(*) from preds),
      'exact', (select count(*) from preds where ph = rh and pa = ra),
      'good_result', (select count(*) from preds where sign(ph - pa) = sign(rh - ra)),
      'points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me) and source_type = 'match')
    ),
    'quiz', json_build_object(
      'played', (select count(*) from quiz),
      'won', (select count(*) from quiz where res = 'won'),
      'draw', (select count(*) from quiz where res = 'draw'),
      'lost', (select count(*) from quiz where res = 'lost')
    ),
    'penalty', json_build_object(
      'played', (select count(*) from pen),
      'won', (select count(*) from pen where res = 'won'),
      'draw', (select count(*) from pen where res = 'draw'),
      'lost', (select count(*) from pen where res = 'lost')
    ),
    'minigames', json_build_object(
      'best_juggle', (select max(score) from juggle_scores where profile_id = (select id from me)),
      'best_dribble', (select max(score) from dribble_scores where profile_id = (select id from me)),
      'games_played', (select count(*) from juggle_scores where profile_id = (select id from me))
                    + (select count(*) from dribble_scores where profile_id = (select id from me))
    ),
    'free_bets', json_build_object(
      'votes', (select count(*) from free_bet_votes where profile_id = (select id from me)),
      'created', (select count(*) from free_bets where author_id = (select id from me)),
      'points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me) and source_type = 'free_bet')
    ),
    'total_points', (select coalesce(sum(points),0) from points_ledger where profile_id = (select id from me))
  );
$$;

revoke execute on function public.get_my_stats() from public, anon;
grant execute on function public.get_my_stats() to authenticated;
