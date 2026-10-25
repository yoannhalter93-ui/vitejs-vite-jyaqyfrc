// supabase/functions/resolve-fixtures/index.ts
//
// Version football-data.org (remplace API-Football, voir la même
// note que dans fetch-fixtures/index.ts pour le contexte du switch).
//
// Point important, honnête, à garder en tête : football-data.org,
// sur le plan gratuit, ne garantit PAS toujours le détail des
// buteurs (contrairement à API-Football qui avait un endpoint
// /fixtures/events dédié). Le score final est fiable, mais le bonus
// "buteur" du prono pourrait rester non crédité sur certains matchs
// si l'info n'est pas dans la réponse — ce n'est pas un bug, juste
// une limite de la donnée disponible gratuitement. À vérifier après
// le premier vrai match résolu.
//
// 2026-10-25 : matchs reportés. L'heure de coup d'envoi était figée à
// l'import (fetch-fixtures) : un match reporté fermait les pronos à
// l'heure initiale et restait « en attente ». Désormais, à chaque passage
// (toutes les 30 min), un seul appel liste les matchs de Ligue 1 autour
// d'aujourd'hui et, pour chaque match encore ouvert dont la date a changé
// (report, avancement), on met à jour kickoff_at dans toutes les ligues
// (et sur le But en or) : les pronos restent ouverts jusqu'au vrai coup
// d'envoi.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FOOTBALL_DATA_TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COMPETITION_CODE = "FL1";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Met à jour l'heure des matchs encore ouverts dont la date a bougé.
async function syncRescheduledKickoffs() {
  const now = Date.now();
  const from = isoDay(new Date(now - 7 * 24 * 3600 * 1000));
  const to = isoDay(new Date(now + 30 * 24 * 3600 * 1000));
  const data = await footballData(`/competitions/${COMPETITION_CODE}/matches?dateFrom=${from}&dateTo=${to}`);
  const apiDates = new Map<number, string>();
  for (const m of data.matches || []) {
    // seulement les matchs pas encore joués avec une date connue
    if (!m.utcDate || !["SCHEDULED", "TIMED", "POSTPONED"].includes(m.status)) continue;
    apiDates.set(m.id, m.utcDate);
  }
  if (apiDates.size === 0) return [];

  const { data: open, error } = await supabase
    .from("matches")
    .select("api_fixture_id, kickoff_at")
    .eq("status", "open")
    .in("api_fixture_id", [...apiDates.keys()]);
  if (error) throw error;

  const changed = new Map<number, { from: string; to: string }>();
  for (const row of open || []) {
    const apiDate = apiDates.get(row.api_fixture_id);
    if (!apiDate) continue;
    const newMs = new Date(apiDate).getTime();
    // nouvelle date connue et dans le futur (un report sans nouvelle date
    // garde son ancienne heure côté API : on n'y touche pas)
    if (newMs <= now) continue;
    if (Math.abs(newMs - new Date(row.kickoff_at).getTime()) < 60 * 1000) continue;
    changed.set(row.api_fixture_id, { from: row.kickoff_at, to: apiDate });
  }

  const updates = [];
  for (const [fixtureId, c] of changed) {
    await supabase.from("matches").update({ kickoff_at: c.to }).eq("api_fixture_id", fixtureId).eq("status", "open");
    await supabase.from("weekly_special_matches").update({ kickoff_at: c.to }).eq("api_fixture_id", fixtureId).eq("resolved", false);
    updates.push({ api_fixture_id: fixtureId, ancien: c.from, nouveau: c.to });
  }
  return updates;
}

Deno.serve(async (_req) => {
  try {
    // 0. Matchs reportés : nouvelle heure de coup d'envoi (un échec ici ne
    //    doit pas empêcher la résolution des scores)
    let reschedules: unknown = [];
    try {
      reschedules = await syncRescheduledKickoffs();
    } catch (e) {
      console.error("sync reports", e);
      reschedules = { erreur: String(e) };
    }

    // 1. Récupère tous les matchs "open" dont le coup d'envoi est passé
    //    depuis au moins 2h (le temps qu'un match + prolongations finisse)
    const { data: pendingMatches, error } = await supabase
      .from("matches")
      .select("id, api_fixture_id")
      .eq("status", "open")
      .lt("kickoff_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    if (error) throw error;
    if (!pendingMatches || pendingMatches.length === 0) {
      return new Response(JSON.stringify({ message: "Rien à résoudre", reports: reschedules }), { status: 200 });
    }

    const results = [];

    for (const match of pendingMatches) {
      // 2. Interroge football-data.org pour CE match précis
      const data = await footballData(`/matches/${match.api_fixture_id}`);
      const m = data;

      if (!m || m.status !== "FINISHED") {
        // Match pas encore fini côté API (retard, report...) — on
        // le laisse "open", on réessaiera au prochain passage du cron
        results.push({ match: match.id, status: "pas encore terminé" });
        continue;
      }

      const homeScore = m.score?.fullTime?.home;
      const awayScore = m.score?.fullTime?.away;

      if (homeScore == null || awayScore == null) {
        results.push({ match: match.id, status: "score indisponible, réessai plus tard" });
        continue;
      }

      // 3. Buteurs, si présents dans la réponse (voir note en haut de
      //    fichier — pas garanti sur le plan gratuit pour tous les matchs)
      const goals = m.goals || [];
      for (const goal of goals) {
        if (!goal.scorer?.id) continue;

        await supabase.from("players").upsert({
          id: goal.scorer.id,
          name: goal.scorer.name,
          api_team_id: goal.team?.id,
        }, { onConflict: "id" });

        await supabase.from("match_scorers").upsert({
          match_id: match.id,
          player_id: goal.scorer.id,
          minute: goal.minute,
        }, { onConflict: "match_id,player_id" });
      }

      // 4. Met à jour le match : score + data_finalized = true SEULEMENT
      //    maintenant que tout est confirmé en base
      await supabase
        .from("matches")
        .update({
          real_home_score: homeScore,
          real_away_score: awayScore,
          data_finalized: true,
        })
        .eq("id", match.id);

      // 5. Déclenche la résolution des points (fonction SQL security
      //    definer — accessible ici car on est en service_role)
      const { error: resolveError } = await supabase.rpc("resolve_match", { p_match_id: match.id });
      if (resolveError) throw resolveError;

      results.push({ match: match.id, status: "résolu", score: `${homeScore}-${awayScore}`, buteurs: goals.length });
    }

    return new Response(JSON.stringify({ results, reports: reschedules }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
