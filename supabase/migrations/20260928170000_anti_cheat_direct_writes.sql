-- ⚠️ PAS ENCORE APPLIQUÉE en base (en attente de l'accord de Yoann, 28/09/2026).
-- Anti-triche : écritures directes dans les tables (sans passer par l'appli).
-- L'appli utilise des fonctions sécurisées (security definer) pour ces
-- actions ; les tables, elles, acceptaient encore des écritures directes via
-- l'API, ce qui permettait :
--   - free_bet_boosts : "doubler" un pari sans payer les 2 jetons et sans
--     limite de temps  → uniquement via use_bonus_double_ou_rien
--   - team_assignments : choisir son équipe au lieu du tirage au sort
--     → uniquement via assign_random_team (et les bonus d'équipe)
--   - group_members : rejoindre n'importe quel groupe sans code d'invitation
--     → uniquement via join_group / create_group
--   - groups : créer un groupe hors create_group (sans période, etc.)
-- Et free_bets (création directe, utilisée par l'appli) : on ne peut plus
-- créer un pari déjà résolu, sans validateur, ou à échéance passée.

drop policy if exists "appliquer un boost" on public.free_bet_boosts;
revoke insert, update, delete on public.free_bet_boosts from anon, authenticated;

drop policy if exists "obtenir son equipe" on public.team_assignments;
revoke insert, update, delete on public.team_assignments from anon, authenticated;

drop policy if exists "Les utilisateurs peuvent rejoindre un groupe" on public.group_members;
revoke insert, update on public.group_members from anon, authenticated;

drop policy if exists "Les utilisateurs peuvent créer un groupe" on public.groups;
revoke insert on public.groups from anon, authenticated;

drop policy if exists "membres peuvent créer un pari" on public.free_bets;
create policy "membres peuvent créer un pari" on public.free_bets
  for insert to authenticated
  with check (
    is_group_member(group_id)
    and author_id = auth.uid()
    and status = 'open'
    and deadline > now()
    and actual_result is null
    and resolved_at is null
    and resolved_by_profile is null
    and final_odds_oui is null
    and final_odds_non is null
    and (validator_id is null or validator_id = auth.uid()
         or exists (select 1 from group_members gm where gm.group_id = free_bets.group_id and gm.profile_id = free_bets.validator_id))
  );
