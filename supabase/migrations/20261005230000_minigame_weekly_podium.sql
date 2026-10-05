-- Jeu de la semaine : podium au lieu du seul 1er.
--   1er : 3 points + 2 jetons ; 2e : 2 points + 1 jeton ; 3e : 1 point.
-- Meilleur score de chacun ; ex aequo = même place ; une place n'est donnée
-- que s'il reste quelqu'un derrière (2e : 3 joueurs min., 3e : 4 min.).
create or replace function public.award_weekly_podium(p_week date, p_scores regclass, p_source text, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  r record;
  v_period_id uuid;
begin
  for g in select id as group_id from groups loop
    select gp.id into v_period_id from group_periods gp where gp.group_id = g.group_id and gp.is_current;
    if v_period_id is null then continue; end if;

    for r in execute format($q$
      with best as (
        select distinct on (s.profile_id) s.profile_id, s.id as score_id, s.score
        from %s s
        where s.group_id = $1 and s.week_start = $2 and s.score > 0
        order by s.profile_id, s.score desc, s.created_at
      ), ranked as (
        select b.*, rank() over (order by b.score desc) as place, count(*) over () as n from best b
      )
      select * from ranked where place <= 3$q$, p_scores)
      using g.group_id, p_week
    loop
      if (r.place = 2 and r.n < 3) or (r.place = 3 and r.n < 4) then continue; end if;
      if exists (select 1 from points_ledger pl where pl.group_id = g.group_id
                 and pl.source_type = p_source and pl.source_id = r.score_id) then continue; end if;
      insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points, created_at)
      values (g.group_id, r.profile_id, v_period_id, p_source, r.score_id, 4 - r.place, now());
      if r.place <= 2 then
        insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
        values (g.group_id, r.profile_id, v_period_id, 3 - r.place, p_reason, r.score_id);
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function award_weekly_podium(date, regclass, text, text) from public, anon, authenticated;

do $$
declare x text[]; d text;
begin
  foreach x slice 1 in array array[
    array['resolve_weekly_toro_contest', 'toro', 'toro_scores', 'toro_chrono', 'victoire_toro'],
    array['resolve_weekly_juggle_contest', 'jonglage', 'juggle_scores', 'jonglage_chrono', 'victoire_jonglage'],
    array['resolve_weekly_dribble_contest', 'dribble', 'dribble_scores', 'dribble_chrono', 'victoire_dribble'],
    array['resolve_weekly_freekick_contest', 'coup-franc', 'freekick_scores', 'coup_franc_chrono', 'victoire_coup_franc']]
  loop
    d := format($f$
create or replace function public.%1$I()
returns void
language plpgsql
security definer
set search_path to 'public'
as $b$
declare
  wk date := (date_trunc('week', now()) - interval '7 days')::date; -- semaine précédente, complète
begin
  if public.get_active_minigame(wk) <> %2$L then return; end if;
  -- podium : 1er 3 pts + 2 jetons, 2e 2 pts + 1 jeton, 3e 1 pt
  perform award_weekly_podium(wk, %3$L::regclass, %4$L, %5$L);
end;
$b$;$f$, x[1], x[2], x[3], x[4], x[5]);
    execute d;
  end loop;
end $$;
