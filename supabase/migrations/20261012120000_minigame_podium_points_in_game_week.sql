-- Podium du jeu de la semaine : distribué le lundi matin, mais les points
-- comptent désormais dans la semaine du jeu (dimanche 23:59:59), comme les
-- duels clôturés le lundi. Rattrapage des podiums déjà distribués.

do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.award_weekly_podium(date, regclass, text, text)'::regprocedure);
  before := def;
  def := replace(def, '4 - r.place, now())', '4 - r.place, p_week + interval ''7 days'' - interval ''1 second'')');
  if def = before then raise exception 'motif introuvable'; end if;
  execute def;
end $$;

update public.points_ledger pl set created_at = s.week_start + interval '7 days' - interval '1 second'
from public.juggle_scores s where pl.source_type = 'jonglage_chrono' and pl.source_id = s.id
  and pl.created_at >= s.week_start + interval '7 days';
update public.points_ledger pl set created_at = s.week_start + interval '7 days' - interval '1 second'
from public.dribble_scores s where pl.source_type = 'dribble_chrono' and pl.source_id = s.id
  and pl.created_at >= s.week_start + interval '7 days';
update public.points_ledger pl set created_at = s.week_start + interval '7 days' - interval '1 second'
from public.freekick_scores s where pl.source_type = 'coup_franc_chrono' and pl.source_id = s.id
  and pl.created_at >= s.week_start + interval '7 days';
update public.points_ledger pl set created_at = s.week_start + interval '7 days' - interval '1 second'
from public.toro_scores s where pl.source_type = 'toro_chrono' and pl.source_id = s.id
  and pl.created_at >= s.week_start + interval '7 days';
