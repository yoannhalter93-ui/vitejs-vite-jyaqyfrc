-- Duo du week-end : binômes équilibrés selon le classement général de la
-- période en cours (1er avec le dernier, 2e avec l'avant-dernier…), au lieu
-- d'un tirage au hasard. Groupe impair : le joueur du milieu forme un trio
-- avec le duo du milieu. Appliqué en base via execute_sql ; dans
-- admin_create_app_event, la boucle de tirage au hasard du duo a été
-- remplacée par : perform assign_balanced_duos(v_id, g.group_id);
create or replace function assign_balanced_duos(p_event_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_members uuid[];
  v_n integer;
  v_pairs integer;
  i integer;
begin
  select array_agg(gm.profile_id order by coalesce(pts.total, 0) desc, random())
    into v_members
  from group_members gm
  left join (
    select pl.profile_id, sum(pl.points) as total
    from points_ledger pl
    join group_periods gp on gp.id = pl.period_id and gp.is_current
    where pl.group_id = p_group_id
    group by pl.profile_id
  ) pts on pts.profile_id = gm.profile_id
  where gm.group_id = p_group_id;

  v_n := coalesce(array_length(v_members, 1), 0);
  if v_n < 4 then return; end if;
  v_pairs := v_n / 2;

  for i in 1..v_pairs loop
    insert into app_event_teams (event_id, group_id, team_no, profile_id)
    values (p_event_id, p_group_id, i, v_members[i]), (p_event_id, p_group_id, i, v_members[v_n + 1 - i])
    on conflict (event_id, group_id, profile_id) do update set team_no = excluded.team_no;
  end loop;
  if v_n % 2 = 1 then
    insert into app_event_teams (event_id, group_id, team_no, profile_id)
    values (p_event_id, p_group_id, v_pairs, v_members[v_pairs + 1])
    on conflict (event_id, group_id, profile_id) do update set team_no = excluded.team_no;
  end if;
end;
$$;
revoke all on function assign_balanced_duos(uuid, uuid) from public, anon, authenticated;

do $$
declare d text; old text;
begin
  d := pg_get_functiondef('admin_create_app_event(text,integer)'::regprocedure);
  old := '      select array_agg(profile_id order by random()) into v_members from group_members where group_id = g.group_id;
      v_n := array_length(v_members, 1);
      for i in 1..v_n loop
        v_team := least((i + 1) / 2, v_n / 2);
        insert into app_event_teams (event_id, group_id, team_no, profile_id) values (v_id, g.group_id, v_team, v_members[i]);
      end loop;';
  if position(old in d) > 0 then
    d := replace(d, old, '      -- duos équilibrés : 1er avec le dernier, 2e avec l''avant-dernier…
      perform assign_balanced_duos(v_id, g.group_id);');
    execute d;
  end if;
end $$;
