-- « Mon équipe » : seuls les matchs joués APRÈS le tirage comptent.
-- Avant, un joueur qui tirait son équipe en cours de période (nouveau
-- membre, échange, retirage forcé) récupérait d'un coup tous les résultats
-- de l'équipe depuis le début de la période. assigned_at = moment où
-- l'équipe actuelle a été attribuée ; l'edge function
-- team-assignment-results ignore les matchs antérieurs. Les lignes déjà
-- existantes restent à null (comportement inchangé : début de période).

alter table public.team_assignments add column if not exists assigned_at timestamptz;
alter table public.team_assignments alter column assigned_at set default now();

create or replace function public.team_assignment_touch_assigned_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.api_team_id is distinct from old.api_team_id then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger trg_team_assignment_touch_assigned_at
  before update on public.team_assignments
  for each row execute function public.team_assignment_touch_assigned_at();

-- compte de test Google : tiré le 10/10 à 08:07 UTC
update public.team_assignments ta set assigned_at = '2026-10-10 08:07:00+00'
from public.draw_excluded_profiles d
where d.profile_id = ta.profile_id and ta.assigned_at is null;
