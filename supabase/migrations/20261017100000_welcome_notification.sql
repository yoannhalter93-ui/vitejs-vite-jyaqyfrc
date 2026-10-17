-- Notification de bienvenue pour un nouveau membre d'une ligue : il ne
-- reçoit pas les anciennes notifications (envoyées aux membres présents à
-- l'époque), donc on lui résume la situation à son arrivée.
-- Pas pour le créateur (il entre dans sa propre ligue à la création).
create or replace function public.welcome_new_member()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  g record;
  p record;
  v_champion text;
  v_text text;
begin
  if new.role = 'owner' or is_draw_excluded(new.profile_id) then return new; end if;
  select * into g from groups where id = new.group_id;

  if g.ended_at is not null then
    select r.pseudo into v_champion
    from group_periods gp, period_ranking(gp.id) r
    where gp.id = (select id from group_periods where group_id = g.id and not is_current and not voided
                   order by ends_at desc limit 1)
      and r.rank = 1 and r.points > 0
    order by r.pseudo limit 1;
    v_text := '👋 Bienvenue dans « ' || g.name || ' » ! Le championnat est terminé'
      || coalesce(' (champion : ' || v_champion || ' 👑)', '')
      || '. Ouvre la ligue pour voir la page de fin. Si le créateur relance un championnat, tout le monde repartira à 0 avec toi.';
  else
    select * into p from group_periods where group_id = g.id and is_current limit 1;
    v_text := '👋 Bienvenue dans « ' || g.name || ' » !'
      || case when p.id is not null
           then ' Le championnat est en cours jusqu''au ' || to_char(p.ends_at at time zone 'Europe/Paris', 'DD/MM') || ' : tu pars de 0,'
           else '' end
      || ' découvre ton équipe tirée au sort 🎡, fais tes pronos et tes duels arrivent très vite. Bonne chance !';
  end if;

  insert into notifications (profile_id, type, text, ref_table, ref_id)
  values (new.profile_id, 'result', v_text, 'groups', g.id);
  return new;
end;
$$;

create trigger trg_welcome_new_member after insert on public.group_members
for each row execute function public.welcome_new_member();
