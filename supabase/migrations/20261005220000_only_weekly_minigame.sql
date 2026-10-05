-- Un mini-jeu qui n'est pas le jeu de la semaine (ex. une vieille version de
-- l'appli qui lançait les Jonglages par défaut) : score refusé et pas de
-- notification « X joue… ».
create or replace function public.only_weekly_minigame()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if tg_argv[0] not in (get_active_minigame((now() at time zone 'utc')::date), get_active_minigame((now() at time zone 'Europe/Paris')::date)) then
    raise exception 'Ce mini-jeu n''est pas le jeu de la semaine : mets à jour l''appli (ferme-la complètement puis rouvre-la)';
  end if;
  return new;
end;
$$;
create trigger trg_only_weekly_minigame before insert on juggle_scores for each row execute function only_weekly_minigame('jonglage');
create trigger trg_only_weekly_minigame before insert on dribble_scores for each row execute function only_weekly_minigame('dribble');
create trigger trg_only_weekly_minigame before insert on freekick_scores for each row execute function only_weekly_minigame('coup-franc');
create trigger trg_only_weekly_minigame before insert on toro_scores for each row execute function only_weekly_minigame('toro');

do $$
declare f text; k text; d text;
begin
  foreach f in array array['notify_juggle_start(uuid):jonglage', 'notify_dribble_start(uuid):dribble', 'notify_freekick_start(uuid):coup-franc', 'notify_toro_start(uuid):toro'] loop
    k := split_part(f, ':', 2);
    d := pg_get_functiondef(split_part(f, ':', 1)::regprocedure);
    if position('get_active_minigame()' in d) > 0 then continue; end if;
    d := replace(d, E'\nbegin\n', E'\nbegin\n  -- pas de notif pour un jeu qui n''est pas celui de la semaine\n  if get_active_minigame() <> ''' || k || E''' then return; end if;\n');
    execute d;
  end loop;
end $$;
