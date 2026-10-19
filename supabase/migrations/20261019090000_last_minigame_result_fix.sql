-- Tuiles du menu Jeux (« Semaine dernière : X — score ») : le gagnant était
-- retrouvé via points_ledger.source_id → ligne de score, ce qui ne marche
-- plus depuis le podium à 3 places (retombait sur une vieille semaine, ou
-- mélangeait les 3 du podium). On lit maintenant directement les scores de
-- la dernière semaine où ce jeu était le jeu de la semaine (minigame_weeks) :
-- le(s) meilleur(s) score(s) de la ligue cette semaine-là.
create or replace function public.get_last_minigame_result(p_group_id uuid, p_game_key text)
returns table(week_start date, winners text[], score integer)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_table text;
  v_week date;
begin
  if not is_group_member(p_group_id) then raise exception 'Non autorisé'; end if;
  v_table := case p_game_key
    when 'jonglage' then 'juggle_scores'
    when 'dribble' then 'dribble_scores'
    when 'coup-franc' then 'freekick_scores'
    when 'toro' then 'toro_scores'
  end;
  if v_table is null then return; end if;

  select mw.week_start into v_week from minigame_weeks mw
  where mw.game_key = p_game_key and mw.week_start < date_trunc('week', now())::date
  order by mw.week_start desc limit 1;
  if v_week is null then return; end if;

  return query execute format($q$
    with best as (
      select s.profile_id, max(s.score)::int sc from %I s
      where s.group_id = $1 and s.week_start = $2 and not is_draw_excluded(s.profile_id)
      group by s.profile_id
    ), top as (select max(sc) m from best)
    select $2, array_agg(p.pseudo order by p.pseudo), (select m from top)
    from best b join profiles p on p.id = b.profile_id
    where b.sc = (select m from top) and (select m from top) > 0
    having count(*) > 0
  $q$, v_table) using p_group_id, v_week;
end;
$$;
