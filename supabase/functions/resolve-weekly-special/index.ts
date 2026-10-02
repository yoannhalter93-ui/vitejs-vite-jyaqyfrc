// supabase/functions/resolve-weekly-special/index.ts
//
// Résout automatiquement le résultat réel (équipe + minute du 1er but) des
// matchs "But en or" (weekly_special_matches) à partir de football-data.org,
// au lieu de la saisie manuelle faite jusqu'ici. Nécessite que le token
// FOOTBALL_DATA_TOKEN soit sur un plan qui renvoie le champ `goals[]`
// (confirmé par le support football-data.org : plan payant "Free + Deep
// Data", ~29€/mois — le plan gratuit ne renvoie PAS ce champ, vérifié en
// direct le 2026-09-21 sur un vrai match terminé : hasGoalsField=false).
//
// Tant que le plan n'est pas actif, cette fonction ne fait RIEN de mal :
// si `goals` est absent de la réponse API, le match reste non résolu et on
// réessaiera au prochain passage du cron (aucun résultat "aucun_but" écrit
// par erreur faute de donnée).
//
// Créé le 2026-09-21, demande de Yoann suite à la confirmation de Daniel
// (football-data.org) que le plan Deep Data couvre bien les buteurs en
// direct pour la Ligue 1. En-têtes CORS ajoutés uniquement pour permettre
// un appel de vérification manuel depuis le navigateur (l'usage réel se
// fait via pg_cron/net.http_post, qui n'en a pas besoin).
//
// 2026-10-02 : le message d'erreur renvoyé est lisible (une erreur Supabase
// n'est pas une Error JS : String(err) donnait "[object Object]").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FOOTBALL_DATA_TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function footballData(path: string) {
  const res = await fetch(`https://api.football-data.org/v4${path}`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data.org error ${res.status} sur ${path} : ${body}`);
  }
  return res.json();
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    try { return JSON.stringify(err); } catch { /* on retombe sur String() */ }
  }
  return String(err);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // Matchs "But en or" pas encore résolus, dont le coup d'envoi est passé
    // depuis au moins 2h (même délai que resolve-fixtures, le temps que le
    // match + prolongations éventuelles se termine côté API)
    const { data: pending, error } = await supabase
      .from("weekly_special_matches")
      .select("id, week_start, match_number, api_fixture_id")
      .eq("resolved", false)
      .not("api_fixture_id", "is", null)
      .lt("kickoff_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    if (error) throw error;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ message: "Rien à résoudre" }), { status: 200, headers: corsHeaders });
    }

    const results = [];
    const weeksToCheck = new Set<string>();

    for (const m of pending) {
      const data = await footballData(`/matches/${m.api_fixture_id}`);

      if (data.status !== "FINISHED") {
        results.push({ match: m.id, status: "pas encore terminé" });
        continue;
      }

      if (!("goals" in data)) {
        results.push({ match: m.id, status: "buteurs indisponibles sur le plan actuel" });
        continue;
      }

      const goals = (data.goals || []).slice().sort((a: any, b: any) => (a.minute ?? 999) - (b.minute ?? 999));
      let realTeam: string;
      let realMinute: number | null;

      if (goals.length === 0) {
        realTeam = "aucun_but";
        realMinute = null;
      } else {
        const first = goals[0];
        realTeam = first.team?.id === data.homeTeam?.id ? "domicile" : "exterieur";
        realMinute = first.minute ?? null;
      }

      const { error: updateError } = await supabase
        .from("weekly_special_matches")
        .update({
          real_first_scorer_team: realTeam,
          real_first_goal_minute: realMinute,
          resolved: true,
        })
        .eq("id", m.id);
      if (updateError) throw updateError;

      weeksToCheck.add(m.week_start);
      results.push({ match: m.id, status: "résolu", real_first_scorer_team: realTeam, real_first_goal_minute: realMinute });
    }

    for (const week of weeksToCheck) {
      const { data: weekMatches } = await supabase
        .from("weekly_special_matches")
        .select("resolved")
        .eq("week_start", week);
      const bothResolved = (weekMatches ?? []).length === 2 && (weekMatches ?? []).every((x) => x.resolved);
      if (bothResolved) {
        const { error: resolveError } = await supabase.rpc("resolve_weekly_special_week", { p_week_start: week });
        if (resolveError) throw resolveError;
        results.push({ week, status: "semaine résolue, points attribués" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: errorText(err) }), { status: 500, headers: corsHeaders });
  }
});
