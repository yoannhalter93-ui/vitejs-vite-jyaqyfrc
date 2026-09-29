-- Pas de Joker x2 sur le match x2 d'un événement But en or (pas de x4) :
--  - use_bonus_joker refuse ce match
--  - un Joker posé AVANT le lancement de l'événement sur ce match est
--    annulé et ses 3 jetons remboursés (avec une notification)
--  - resolve_match : le match x2 ne cumule jamais avec un Joker (sécurité)
do $$
declare src text;
begin
  -- 1. use_bonus_joker
  select pg_get_functiondef('public.use_bonus_joker(uuid)'::regprocedure) into src;
  if position('comptent déjà x2' in src) = 0 then
    src := replace(src, $a$  if not exists (select 1 from match_predictions where match_id = p_match_id and profile_id = auth.uid()) then$a$,
      $b$  if exists (select 1 from weekly_bonus_matches where api_fixture_id = m.api_fixture_id) then
    raise exception 'Les pronos de ce match comptent déjà x2 (événement) : pas de Joker possible';
  end if;
  if not exists (select 1 from match_predictions where match_id = p_match_id and profile_id = auth.uid()) then$b$);
    execute src;
  end if;

  -- 2. resolve_match : x2 de l'événement OU Joker, jamais les deux
  select pg_get_functiondef('public.resolve_match(uuid)'::regprocedure) into src;
  src := replace(src,
    $a$    if exists (select 1 from match_jokers where match_id = p_match_id and profile_id = pred.profile_id) then$a$,
    $b$    if not v_bonus_x2 and exists (select 1 from match_jokers where match_id = p_match_id and profile_id = pred.profile_id) then$b$);
  execute src;

  -- 3. lancement d'un événement : remboursement des Jokers déjà posés
  select pg_get_functiondef('public.admin_create_golden_goal_event(integer,integer,integer)'::regprocedure) into src;
  if position('remboursement_joker' in src) = 0 then
    src := replace(src,
      $a$    v_bonus_text := '. Bonus : tes pronos sur '$a$,
      $b$    -- Jokers déjà posés sur ce match : annulés et remboursés (pas de x4)
    insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
    select mt.group_id, j.profile_id, gp.id, 3, 'remboursement_joker', mt.id
    from match_jokers j
    join matches mt on mt.id = j.match_id
    join group_periods gp on gp.group_id = mt.group_id and gp.is_current
    where mt.api_fixture_id = fb.api_fixture_id;
    insert into notifications (profile_id, type, text, ref_table, ref_id)
    select j.profile_id, 'result',
      '🃏 Ton Joker sur ' || fb.home_team || ' - ' || fb.away_team
        || ' est remboursé (3 🪙) : ce match compte déjà x2 grâce à l''événement But en or !',
      'matches', mt.id
    from match_jokers j join matches mt on mt.id = j.match_id
    where mt.api_fixture_id = fb.api_fixture_id;
    delete from match_jokers j using matches mt
    where mt.id = j.match_id and mt.api_fixture_id = fb.api_fixture_id;

    v_bonus_text := '. Bonus : tes pronos sur '$b$);
    execute src;
  end if;
end $$;
