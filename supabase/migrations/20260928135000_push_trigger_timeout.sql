-- L'appel à send-push n'attendait la réponse qu'1 s (délai par défaut de
-- pg_net) : au démarrage à froid de la fonction, la réponse arrivait trop
-- tard et l'envoi était noté en échec (34 cas sur 2 jours), impossible à
-- surveiller. 15 s laisse le temps d'envoyer à tous les appareils.
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  secret text;
begin
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
$$;
