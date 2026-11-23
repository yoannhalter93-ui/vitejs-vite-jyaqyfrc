-- Le trigger anti-triche plafonnait tous les mini-jeux à 2000 : le coup franc
-- (score en centaines) monte maintenant jusqu'à 100000.
create or replace function public.force_minigame_score_week()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    new.week_start := date_trunc('week', now())::date;
    -- coup franc : score en centaines (but 100, lucarne 200, x combo) -> plafond 100000
    new.score := least(greatest(new.score, 0), case when tg_table_name = 'freekick_scores' then 100000 else 2000 end);
  end if;
  return new;
end;
$function$;
