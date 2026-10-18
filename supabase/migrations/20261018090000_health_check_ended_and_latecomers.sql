-- Contrôle Entre Nous, fausses alertes « duel en redite » :
--  * les ligues arrêtées (fin de championnat) ne sont plus contrôlées ;
--  * un adversaire « jamais affronté » ne compte que s'il était déjà membre
--    au moment du tirage du duel (un nouveau venu ne rend pas un ancien
--    tirage évitable après coup).
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.run_health_check(boolean)'::regprocedure);
  before := def;
  def := replace(def, $a$select d.group_id, 'quiz' game, d.player_a_id a, d.player_b_id b$a$,
                      $b$select d.group_id, 'quiz' game, d.player_a_id a, d.player_b_id b, d.created_at ca$b$);
  def := replace(def, $a$select d.group_id, 'penalty', d.player_a_id, d.player_b_id$a$,
                      $b$select d.group_id, 'penalty', d.player_a_id, d.player_b_id, d.created_at$b$);
  def := replace(def, 'join groups g on g.id = x.group_id', 'join groups g on g.id = x.group_id and g.ended_at is null');
  def := replace(def, 'and not is_draw_excluded(m.profile_id)', 'and not is_draw_excluded(m.profile_id) and m.joined_at <= x.ca');
  if def = before or def not like '%x.ca%' or def not like '%g.ended_at is null%' then
    raise exception 'motif introuvable (run_health_check)';
  end if;
  execute def;
end $$;
