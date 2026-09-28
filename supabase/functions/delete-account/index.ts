import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Étape 2 de la suppression de compte (voir la migration
// account_deletion_support) : supprime réellement la ligne auth.users
// (email, mot de passe) via l'API Admin, ce qui coupe l'accès au compte,
// ainsi que la photo de profil importée (bucket avatars, {id}/avatar.jpg).
// L'étape 1 (RPC delete_my_account_data, appelée par le client juste avant
// celle-ci) a déjà anonymisé le profil et retiré l'utilisateur de ses
// groupes.
//
// verify_jwt=false (comme send-push) : avec verify_jwt=true, la plateforme
// rejette avec 401 jusqu'à la requête OPTIONS de préflight CORS envoyée par
// le navigateur avant le vrai POST (elle ne porte pas d'en-tête
// Authorization). L'authentification est donc vérifiée ici, à la main, via
// auth.getUser().
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // photo de profil importée : donnée personnelle, supprimée (sans erreur
    // si la personne n'en avait pas)
    await admin.storage.from("avatars").remove([`${userData.user.id}/avatar.jpg`]);

    const { error: delErr } = await admin.auth.admin.deleteUser(userData.user.id);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
