-- Paris libres : un même pari publié dans plusieurs groupes (une copie par
-- groupe, même auteur / texte / échéance). Confirmer le résultat dans un
-- groupe le confirme aussi dans tous les autres groupes où l'on a le droit
-- de le faire (auteur du pari, ou créateur du groupe), et le résultat est
-- appliqué tout de suite (points + notifications) au lieu d'attendre le
-- prochain passage automatique.
create or replace function public.confirm_free_bet_result(p_bet_id uuid, p_side text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  b free_bets%rowtype;
  s record;
  v_count integer := 0;
begin
  if me is null then raise exception 'Utilisateur non authentifié'; end if;
  if p_side not in ('oui', 'non') then raise exception 'Résultat invalide'; end if;
  select * into b from free_bets where id = p_bet_id;
  if not found then raise exception 'Pari introuvable'; end if;

  for s in
    select fb.id from free_bets fb
    where (fb.id = b.id
           or (fb.author_id = b.author_id and fb.text = b.text and fb.deadline = b.deadline))
      and fb.status = 'closed'
      and (
        (fb.validation_mode = 'confiance' and (fb.validator_id = me or exists (
          select 1 from group_members gm where gm.group_id = fb.group_id and gm.role = 'owner' and gm.profile_id = me)))
        or (fb.validation_mode = 'majorite' and fb.id = b.id and is_group_member(fb.group_id))
      )
      and not exists (select 1 from free_bet_resolutions r where r.bet_id = fb.id and r.profile_id = me)
  loop
    insert into free_bet_resolutions (bet_id, profile_id, confirmed_side) values (s.id, me, p_side);
    perform try_resolve_free_bet(s.id);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Tu ne peux pas (ou plus) confirmer ce pari'; end if;
  return v_count;
end;
$$;

revoke execute on function public.confirm_free_bet_result(uuid, text) from public, anon;
grant execute on function public.confirm_free_bet_result(uuid, text) to authenticated;
