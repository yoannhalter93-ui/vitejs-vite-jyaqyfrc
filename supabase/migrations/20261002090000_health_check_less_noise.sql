-- Contrôle du matin moins bavard sur les appels serveur :
--  - panne passagère de football-data.org (classement Ligue 1) : signalée
--    seulement si le classement n'a pas réussi à se remettre à jour depuis
--  - autres appels : un raté isolé (qui s'est arrangé tout seul) ne compte pas
do $$
declare src text;
begin
  select pg_get_functiondef('public.run_health_check(boolean)'::regprocedure) into src;
  if position('v_last_fd_err' in src) = 0 then
    src := replace(src, $a$  v_text text;
$a$, $b$  v_text text;
  v_last_fd_err timestamptz;
$b$);
    src := replace(src, $a$  -- 2. appels serveur (push, API foot) en erreur (24 h)
  select count(*) into n from net._http_response
  where created > now() - interval '24 hours' and (status_code >= 400 or status_code is null);
  if n > 0 then
    issues := issues || format('%s appel(s) serveur en erreur ou sans réponse', n);
  end if;$a$, $b$  -- 2. appels serveur en erreur (24 h)
  --  a) panne passagère de football-data.org : on ne la signale que si le
  --     classement n'a pas réussi à se remettre à jour depuis
  select max(created) into v_last_fd_err from net._http_response
  where created > now() - interval '24 hours' and (status_code >= 400 or status_code is null)
    and content::text ilike '%football-data.org%';
  if v_last_fd_err is not null and not exists (
    select 1 from net._http_response
    where created > v_last_fd_err and status_code = 200 and content::text like '{"updated"%'
  ) then
    issues := issues || 'classement Ligue 1 pas mis à jour (football-data.org ne répond pas)';
  end if;
  --  b) autres appels (push, fonctions) : un raté isolé ne compte pas
  select count(*) into n from net._http_response
  where created > now() - interval '24 hours' and (status_code >= 400 or status_code is null)
    and coalesce(content::text, '') not ilike '%football-data.org%';
  if n >= 2 then
    issues := issues || format('%s appel(s) serveur en erreur ou sans réponse', n);
  end if;$b$);
    execute src;
  end if;
end $$;
