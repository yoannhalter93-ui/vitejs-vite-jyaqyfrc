-- « Mon équipe » : barème du foot — victoire +3, nul +1, défaite 0 (au lieu
-- de +1 / 0 / -1). Bonus inversé : victoire 0, nul +1, défaite +3.
-- team_assignment_results.delta reste le résultat brut (+1/0/-1) ; seul ce
-- qui part au classement change. S'applique aux prochains matchs, les
-- points déjà crédités ne bougent pas.

create or replace function public.credit_team_assignment_points()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inverted boolean;
  v_credited integer;
begin
  select inverted into v_inverted from team_assignments
    where group_id = new.group_id and profile_id = new.profile_id and period_id = new.period_id;

  v_credited := case
    when new.delta > 0 then case when coalesce(v_inverted, false) then 0 else 3 end
    when new.delta < 0 then case when coalesce(v_inverted, false) then 3 else 0 end
    else 1
  end;

  insert into points_ledger (group_id, profile_id, period_id, source_type, source_id, points)
  values (new.group_id, new.profile_id, new.period_id, 'team_assignment', new.id, v_credited)
  on conflict do nothing;
  return new;
end;
$$;

do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.use_bonus_inverse(uuid, uuid)'::regprocedure);
  before := def;
  def := replace(def, 'ses victoires vont maintenant te faire perdre des points !',
                      'ses victoires ne te rapportent plus rien et ses défaites te rapportent 3 points !');
  if def = before then raise exception 'motif introuvable'; end if;
  execute def;
end $$;
