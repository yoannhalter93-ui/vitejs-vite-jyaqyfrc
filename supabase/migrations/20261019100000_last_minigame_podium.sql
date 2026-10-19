-- Tuiles du menu Jeux : podium (3 premiers) de la dernière édition de
-- chaque mini-jeu, même règle que get_last_minigame_result.
create or replace function public.get_last_minigame_podium(p_group_id uuid, p_game_key text)
returns json
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_table text;
  v_week date;
  v_res json;
begin
  if not is_group_member(p_group_id) then raise exception 'Non autorisé'; end if;
  v_table := case p_game_key
    when 'jonglage' then 'juggle_scores'
    when 'dribble' then 'dribble_scores'
    when 'coup-franc' then 'freekick_scores'
    when 'toro' then 'toro_scores'
  end;
  if v_table is null then return null; end if;

  select mw.week_start into v_week from minigame_weeks mw
  where mw.game_key = p_game_key and mw.week_start < date_trunc('week', now())::date
  order by mw.week_start desc limit 1;
  if v_week is null then return null; end if;

  execute format($q$
    with best as (
      select s.profile_id, max(s.score)::int sc from %I s
      where s.group_id = $1 and s.week_start = $2 and not is_draw_excluded(s.profile_id)
      group by s.profile_id
    ), ranked as (
      select b.sc, p.pseudo, rank() over (order by b.sc desc) rk
      from best b join profiles p on p.id = b.profile_id where b.sc > 0
    )
    select json_build_object('week_start', $2,
      'podium', coalesce(json_agg(json_build_object('rank', rk, 'pseudo', pseudo, 'score', sc) order by rk, pseudo), '[]'::json))
    from ranked where rk <= 3
  $q$, v_table) into v_res using p_group_id, v_week;
  return v_res;
end;
$$;
revoke execute on function public.get_last_minigame_podium(uuid, text) from public, anon;
grant execute on function public.get_last_minigame_podium(uuid, text) to authenticated;
