-- Contrôle Entre Nous : un duel en redite n'est « évitable » que s'il
-- restait un adversaire jamais affronté ET tirable. Le compte de test
-- Google (exclu des tirages, voir draw_excluded_profiles) était compté
-- comme adversaire possible → fausse alerte « duel quiz en redite ».
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.run_health_check(boolean)'::regprocedure);
  before := def;
  def := replace(def, 'm.profile_id not in (x.a, x.b)',
                      'm.profile_id not in (x.a, x.b) and not is_draw_excluded(m.profile_id)');
  if def = before then raise exception 'motif introuvable (run_health_check)'; end if;
  execute def;
end $$;
