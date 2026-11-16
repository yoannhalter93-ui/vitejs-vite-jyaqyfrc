-- Une seule notification push sur le téléphone quand le même message part
-- plusieurs fois vers la même personne en peu de temps (ex. « Nouveau duel de
-- penaltys » tiré dans chaque ligue le lundi). Les lignes de la cloche dans
-- l'appli restent une par ligue (chacune ouvre son duel).
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  secret text;
begin
  if exists (
    select 1 from notifications n
    where n.profile_id = new.profile_id and n.text = new.text and n.id <> new.id
      and n.created_at > now() - interval '30 minutes'
  ) then
    return new;
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://aturumvtzbykfhflusun.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret),
    body := jsonb_build_object('notification_id', new.id, 'profile_id', new.profile_id, 'text', new.text),
    timeout_milliseconds := 15000
  );
  return new;
end;
$function$;
