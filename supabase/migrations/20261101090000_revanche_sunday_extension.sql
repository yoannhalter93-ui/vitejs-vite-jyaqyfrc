-- Revanche lancée le dimanche (moins de 24 h avant la clôture des duels du
-- lundi ~7h) : l'adversaire n'a pas le temps de rejouer et perdait par
-- forfait. Désormais une Revanche lancée à partir du dimanche matin peut être
-- jouée pendant toute la semaine suivante (revanche_until) ; si l'adversaire
-- ne l'a toujours pas jouée à la fin de cette semaine-là, il perd (forfait).
alter table public.weekly_duels add column if not exists revanche_until timestamptz;
alter table public.penalty_duels add column if not exists revanche_until timestamptz;

do $$
declare def text; before text;
  v_ext constant text := $x$
  if now() >= date_trunc('week', now()) + interval '6 days 6 hours' then
    update %s set revanche_until = date_trunc('week', now()) + interval '14 days' where id = p_duel_id;
  end if;
$x$;
  v_msg constant text := $x$ || case when now() >= date_trunc('week', now()) + interval '6 days 6 hours' then ' Vous avez jusqu''à dimanche prochain pour la jouer.' else '' end$x$;
begin
  -- quiz
  def := pg_get_functiondef('public.use_bonus_revanche_quiz(uuid)'::regprocedure);
  before := def;
  def := replace(def, 'update weekly_duels set status = ''scheduled'', score_a = null, score_b = null where id = p_duel_id;',
    'update weekly_duels set status = ''scheduled'', score_a = null, score_b = null where id = p_duel_id;' || format(v_ext, 'weekly_duels'));
  def := replace(def, 'recommence à zéro avec de nouvelles questions !''', 'recommence à zéro avec de nouvelles questions !''' || v_msg);
  def := replace(def, 'à vous de rejouer !'',', 'à vous de rejouer !''' || v_msg || ',');
  if def = before or def not like '%revanche_until%' or def not like '%dimanche prochain%' then
    raise exception 'motif introuvable (revanche quiz)';
  end if;
  execute def;

  -- penalty
  def := pg_get_functiondef('public.use_bonus_revanche_penalty(uuid)'::regprocedure);
  before := def;
  def := replace(def, 'where id = p_duel_id;

  insert into token_ledger',
    'where id = p_duel_id;' || format(v_ext, 'penalty_duels') || '
  insert into token_ledger');
  def := replace(def, 'votre duel de penaltys recommence à zéro !''', 'votre duel de penaltys recommence à zéro !''' || v_msg);
  def := replace(def, 'à vous de rejouer !'',', 'à vous de rejouer !''' || v_msg || ',');
  if def = before or def not like '%revanche_until%' or def not like '%dimanche prochain%' then
    raise exception 'motif introuvable (revanche penalty)';
  end if;
  execute def;

  -- clôture du lundi : on attend la fin du délai de revanche
  def := pg_get_functiondef('public.expire_stale_weekly_duels()'::regprocedure);
  before := def;
  def := replace(def, 'where status <> ''done'' and status <> ''waiting_opponent'' and week_start < wk',
    'where status <> ''done'' and status <> ''waiting_opponent'' and week_start < wk
      and (revanche_until is null or revanche_until <= now())');
  if def = before then raise exception 'motif introuvable (expire quiz)'; end if;
  execute def;

  def := pg_get_functiondef('public.expire_stale_penalty_duels()'::regprocedure);
  before := def;
  def := replace(def, 'where phase <> ''done'' and phase <> ''waiting_opponent'' and created_at < wk',
    'where phase <> ''done'' and phase <> ''waiting_opponent'' and created_at < wk
      and (revanche_until is null or revanche_until <= now())');
  if def = before then raise exception 'motif introuvable (expire penalty)'; end if;
  execute def;
end $$;
