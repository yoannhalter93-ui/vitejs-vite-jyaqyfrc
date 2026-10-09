-- Réglage "Pronostics dans toutes mes ligues" : jusqu'ici, un prono n'était
-- recopié dans les autres ligues qu'au moment où on l'enregistrait. Si on
-- rejoignait une ligue après coup (ou si les matchs d'une ligue étaient créés
-- après), les pronos déjà faits n'y apparaissaient pas.
--
-- copy_existing_predictions recopie, pour les joueurs qui ont activé le
-- réglage, leur dernier prono fait ailleurs sur le même match réel
-- (api_fixture_id), uniquement sur les matchs encore ouverts et pas
-- commencés, et sans écraser un prono déjà posé dans la ligue.

create or replace function public.copy_existing_predictions(p_group_id uuid, p_profile_id uuid default null, p_match_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into match_predictions (match_id, profile_id, pred_home_score, pred_away_score, pred_scorer_id)
  select distinct on (m.id, gm.profile_id)
         m.id, gm.profile_id, src.pred_home_score, src.pred_away_score, src.pred_scorer_id
  from matches m
  join group_members gm on gm.group_id = m.group_id
  join profiles pr on pr.id = gm.profile_id and pr.auto_apply_all_leagues
  join matches m2 on m2.api_fixture_id = m.api_fixture_id and m2.id <> m.id
  join match_predictions src on src.match_id = m2.id and src.profile_id = gm.profile_id
  where m.group_id = p_group_id
    and (p_profile_id is null or gm.profile_id = p_profile_id)
    and (p_match_id is null or m.id = p_match_id)
    and m.api_fixture_id is not null
    and m.status = 'open'
    and now() < m.kickoff_at
  order by m.id, gm.profile_id, src.updated_at desc nulls last
  on conflict (match_id, profile_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.copy_existing_predictions(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.copy_predictions_on_member_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform copy_existing_predictions(new.group_id, new.profile_id, null);
  return new;
end;
$$;

create or replace function public.copy_predictions_on_match_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform copy_existing_predictions(new.group_id, null, new.id);
  return new;
end;
$$;

revoke execute on function public.copy_predictions_on_member_insert() from public, anon, authenticated;
revoke execute on function public.copy_predictions_on_match_insert() from public, anon, authenticated;

create or replace trigger trg_copy_predictions_on_member_insert
  after insert on public.group_members
  for each row execute function public.copy_predictions_on_member_insert();

create or replace trigger trg_copy_predictions_on_match_insert
  after insert on public.matches
  for each row execute function public.copy_predictions_on_match_insert();

-- rattrapage : ligues déjà rejointes
select public.copy_existing_predictions(g.id) from public.groups g;
