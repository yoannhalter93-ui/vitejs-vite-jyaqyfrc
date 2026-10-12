-- Duels clôturés le lundi matin (expire_stale_*) : les points comptent
-- désormais dans la semaine OÙ LE DUEL A ÉTÉ JOUÉ (created_at = dimanche
-- 23:59:59 de cette semaine) au lieu du lundi suivant — sinon le récap de
-- la semaine mélangeait les duels de la semaine précédente.
-- Rattrapage des clôtures déjà faites.

do $$
declare
  def text;
  before text;
begin
  def := pg_get_functiondef('public.expire_stale_weekly_duels()'::regprocedure);
  before := def;
  def := replace(def,
    'insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)',
    'insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points, created_at)');
  def := replace(def, '''duel'', d.id, pts_a)', '''duel'', d.id, pts_a, date_trunc(''week'', d.week_start) + interval ''7 days'' - interval ''1 second'')');
  def := replace(def, '''duel'', d.id, pts_b)', '''duel'', d.id, pts_b, date_trunc(''week'', d.week_start) + interval ''7 days'' - interval ''1 second'')');
  if def = before or position('created_at)' in def) = 0 then raise exception 'motif introuvable (quiz)'; end if;
  execute def;

  def := pg_get_functiondef('public.expire_stale_penalty_duels()'::regprocedure);
  before := def;
  def := replace(def,
    'insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)',
    'insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points, created_at)');
  def := replace(def, '''minijeu'', d.id, pts_a)', '''minijeu'', d.id, pts_a, date_trunc(''week'', d.created_at) + interval ''7 days'' - interval ''1 second'')');
  def := replace(def, '''minijeu'', d.id, pts_b)', '''minijeu'', d.id, pts_b, date_trunc(''week'', d.created_at) + interval ''7 days'' - interval ''1 second'')');
  if def = before then raise exception 'motif introuvable (penalty)'; end if;
  execute def;
end $$;

update public.points_ledger pl
set created_at = date_trunc('week', wd.week_start) + interval '7 days' - interval '1 second'
from public.weekly_duels wd
where pl.source_type = 'duel' and pl.source_id = wd.id
  and pl.created_at >= date_trunc('week', wd.week_start) + interval '7 days';

update public.points_ledger pl
set created_at = date_trunc('week', pd.created_at) + interval '7 days' - interval '1 second'
from public.penalty_duels pd
where pl.source_type = 'minijeu' and pl.source_id = pd.id
  and pl.created_at >= date_trunc('week', pd.created_at) + interval '7 days';
