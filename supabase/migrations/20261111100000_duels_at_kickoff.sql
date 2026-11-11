-- Les premiers duels (quiz + penalty) sont tirés dès que le créateur lance le
-- championnat : plus d'attente de 48 h, tout le monde est déjà là. Les
-- retardataires sont mis en duel par run_latecomer_*_matchups comme avant.
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.start_group_championship(uuid)'::regprocedure);
  before := def;
  def := replace(def, '  update group_members set team_reveal_seen = false where group_id = p_group_id;',
    '  update group_members set team_reveal_seen = false where group_id = p_group_id;

  -- duels de la semaine tirés tout de suite
  perform run_weekly_matchups(p_group_id);
  perform run_weekly_penalty_matchups(p_group_id);');
  if def = before then raise exception 'motif introuvable (start_group_championship)'; end if;
  execute def;

  -- filet de sécurité : plus de délai de 48 h
  def := pg_get_functiondef('public.run_deferred_first_matchups()'::regprocedure);
  before := def;
  def := replace(def, 'gr.created_at) <= now() - interval ''48 hours''', 'gr.created_at) <= now()');
  if def = before then raise exception 'motif introuvable (run_deferred_first_matchups)'; end if;
  execute def;
end $$;
