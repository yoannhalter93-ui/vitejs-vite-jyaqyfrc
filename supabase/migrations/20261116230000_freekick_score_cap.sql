-- Coup franc version « image de référence » : score en centaines
-- (but 100, lucarne 200, x combo jusqu'à 5) -> plafond relevé de 2000 à 100000.
alter table public.freekick_scores drop constraint if exists freekick_scores_score_check;
alter table public.freekick_scores add constraint freekick_scores_score_check check (score >= 0 and score <= 100000);

create or replace function public.submit_freekick_score_all_leagues(p_score integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_score integer := least(greatest(p_score, 0), 100000);
  v_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié'; end if;
  with inserted as (
    insert into freekick_scores (group_id, profile_id, week_start, score)
    select gm.group_id, auth.uid(), v_week, v_score
    from group_members gm
    where gm.profile_id = auth.uid() and not has_red_card(gm.group_id, auth.uid())
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$function$;
