import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Appelée par le trigger trg_notify_push (insert dans notifications) :
// envoie la notif en push à tous les appareils abonnés du destinataire.
Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: secretsRows, error: secretsErr } = await admin.rpc("get_push_secrets");
    if (secretsErr || !secretsRows || secretsRows.length === 0) {
      return new Response(JSON.stringify({ error: "secrets_unavailable" }), { status: 500 });
    }
    const { vapid_public_key, vapid_private_key, vapid_subject, webhook_secret } = secretsRows[0];

    const provided = req.headers.get("x-webhook-secret");
    if (!provided || !webhook_secret || provided !== webhook_secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const profileId = body.profile_id as string | undefined;
    const notificationId = (body.notification_id as string | undefined) ?? null;
    const text = (body.text as string) ?? "Nouvelle notification";
    if (!profileId) {
      return new Response(JSON.stringify({ error: "missing profile_id" }), { status: 400 });
    }

    const { data: subs, error: subsErr } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", profileId);
    if (subsErr) {
      return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    webpush.setVapidDetails(vapid_subject, vapid_public_key, vapid_private_key);

    // Le site est publié sous /vitejs-vite-jyaqyfrc/ (GitHub Pages, site de
    // projet) : il faut inclure le sous-chemin. ?notif=<id> permet à l'appli
    // d'ouvrir directement le bon écran (voir public/sw.js et App.tsx).
    const url = notificationId
      ? `/vitejs-vite-jyaqyfrc/?notif=${notificationId}`
      : "/vitejs-vite-jyaqyfrc/";
    const payload = JSON.stringify({ title: "Entre Nous", body: text, url, notificationId });

    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
