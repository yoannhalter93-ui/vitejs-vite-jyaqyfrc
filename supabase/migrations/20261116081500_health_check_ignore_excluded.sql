-- Contrôle quotidien : on ne compte plus comme « sans duel » les comptes
-- exclus du tirage exprès (ex. le compte « Testeur Google » de la ligue beta test).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.run_health_check(boolean)'::regprocedure);
  if position('and not is_draw_excluded(gm.profile_id)' in d) = 0 then
    d := replace(d, 'from groups g join group_members gm on gm.group_id = g.id
      where g.created_at', 'from groups g join group_members gm on gm.group_id = g.id and not is_draw_excluded(gm.profile_id)
      where g.created_at');
    execute d;
  end if;
end $$;
