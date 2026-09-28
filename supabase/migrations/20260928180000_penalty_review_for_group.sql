-- Déroulé d'un duel de penaltys : une fois le duel TERMINÉ, tous les membres
-- du groupe peuvent voir le détail des tirs et des arrêts (écran "revoir le
-- duel"). Tant qu'il est en cours, seuls les deux joueurs y ont accès, et le
-- gardien ne voit toujours pas la zone d'un tir avant d'avoir plongé.
create or replace function public.get_penalty_duel_attempts(p_duel_id uuid)
returns table(attempt_number integer, phase_number integer, shooter_id uuid, keeper_id uuid, shooter_zone text, keeper_zone text, scored boolean, points integer, resolved boolean, shot_taken boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  d penalty_duels%rowtype;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  select * into d from penalty_duels where id = p_duel_id;
  if not found then raise exception 'Duel introuvable'; end if;

  if not (
    auth.uid() in (d.player_a_id, d.player_b_id)
    or (d.phase = 'done' and exists (
      select 1 from group_members where group_id = d.group_id and profile_id = auth.uid()))
  ) then
    raise exception 'Tu ne participes pas à ce duel';
  end if;

  return query
    select
      a.attempt_number, a.phase_number, a.shooter_id, a.keeper_id,
      -- le tireur voit toujours son propre tir ; le gardien ne le voit QUE
      -- si ce tir précis est déjà résolu (jamais avant d'avoir plongé)
      case when a.resolved_at is not null or auth.uid() = a.shooter_id then a.shooter_zone else null end,
      a.keeper_zone,
      a.scored, a.points, (a.resolved_at is not null),
      -- indique au gardien que le tir a été pris, SANS révéler la zone
      (a.shooter_zone is not null)
    from penalty_duel_attempts a
    where a.duel_id = p_duel_id
    order by a.phase_number, a.attempt_number;
end;
$$;
