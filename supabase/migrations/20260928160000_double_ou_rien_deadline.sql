-- Double ou rien : seulement tant que le pari est ouvert ET avant son
-- échéance (même règle que le vote). Avant, on pouvait doubler un pari déjà
-- fermé (statut 'closed'), donc en connaissant quasiment le résultat.
create or replace function public.use_bonus_double_ou_rien(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  bet free_bets%rowtype;
  v_balance integer;
  v_actor_pseudo text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;

  select * into bet from free_bets where id = p_bet_id for update;
  if not found then raise exception 'Pari introuvable'; end if;
  if bet.status <> 'open' or now() >= bet.deadline then
    raise exception 'Les paris sont fermés, impossible de doubler';
  end if;
  if not exists (select 1 from free_bet_votes where bet_id = p_bet_id and profile_id = auth.uid()) then
    raise exception 'Tu dois avoir voté sur ce pari pour le booster';
  end if;
  if exists (select 1 from free_bet_boosts where bet_id = p_bet_id and profile_id = auth.uid()) then
    raise exception 'Tu as déjà boosté ce pari';
  end if;

  select coalesce(sum(amount), 0) into v_balance from token_ledger
    where group_id = bet.group_id and profile_id = auth.uid() and period_id = bet.period_id;
  if v_balance < 2 then raise exception 'Pas assez de jetons'; end if;

  insert into free_bet_boosts (bet_id, profile_id) values (p_bet_id, auth.uid());

  insert into token_ledger (group_id, profile_id, period_id, amount, reason, source_id)
  values (bet.group_id, auth.uid(), bet.period_id, -2, 'bonus_double_ou_rien', p_bet_id);

  select pseudo into v_actor_pseudo from profiles where id = auth.uid();

  insert into notifications (profile_id, type, text, ref_table, ref_id, related_profile_id)
  select gm.profile_id, 'result',
         coalesce(v_actor_pseudo, 'Un joueur') || ' a boosté son pari en Double ou Rien !',
         'free_bets', p_bet_id, auth.uid()
  from group_members gm
  where gm.group_id = bet.group_id and gm.profile_id <> auth.uid();
end;
$$;
