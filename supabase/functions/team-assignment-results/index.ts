// supabase/functions/team-assignment-results/index.ts
//
// Pour chaque équipe attitrée dans chaque groupe, enregistre le delta
// +1/0/-1 de ses matchs de Ligue 1 terminés. Le trigger SQL
// credit_team_assignment_points se charge ensuite d'ajouter les points au
// classement (ou de les inverser si le bonus "inversé" est actif).
//
// 2026-09-25 : réécrite pour ne faire qu'UN SEUL appel à football-data.org
// (tous les matchs FL1 terminés depuis le début de la plus ancienne période
// en cours) au lieu d'un appel par équipe. Avec 14 équipes attribuées,
// l'ancienne version dépassait la limite du plan gratuit (10 requêtes/min),
// prenait un 429 à la 11e équipe et s'arrêtait net : PSG, OM, Angers et
// Lille n'avaient plus jamais de résultat enregistré. Comme la fenêtre
// part du début de période, le premier passage rattrape automatiquement
// tous les résultats manqués (upsert idempotent).
// Conséquence voulue : seuls les matchs de championnat comptent désormais
// (plus les coupes / Coupe d'Europe, qui avantageaient certaines équipes).
//
// IMPORTANT : on ne compte que les matchs joués À PARTIR DU DÉBUT de la
// période en cours du groupe (group_periods.starts_at) — un groupe créé en
// pleine saison n'hérite pas des résultats passés de l'équipe tirée.

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

type Assignment = {
  group_id: string;
  profile_id: string;
  api_team_id: number;
  group_periods: { starts_at: string } | { starts_at: string }[] | null;
};

function periodStartOf(a: Assignment): Date | null {
  const gp = a.group_periods;
  const row = Array.isArray(gp) ? gp[0] : gp;
  return row?.starts_at ? new Date(row.starts_at) : null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (_req) => {
  try {
    const { data: assignments, error } = await supabase
      .from("team_assignments")
      .select("group_id, profile_id, api_team_id, group_periods(starts_at)");
    if (error) throw error;
    if (!assignments || assignments.length === 0) {
      return new Response(JSON.stringify({ message: "Aucune équipe attitrée" }), { status: 200 });
    }

    // Fenêtre : du début de la plus ancienne période concernée à demain
    // (marge pour les matchs finis tard le soir, heure UTC).
    const starts = (assignments as Assignment[])
      .map(periodStartOf)
      .filter((d): d is Date => d !== null);
    const dateFrom = starts.length
      ? new Date(Math.min(...starts.map((d) => d.getTime())))
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const data = await footballData(
      `/competitions/${COMPETITION_CODE}/matches?status=FINISHED&dateFrom=${isoDay(dateFrom)}&dateTo=${isoDay(dateTo)}`,
    );
    const fixtures = data.matches || [];

    const rows = [];
    let skippedPastPeriod = 0;
    for (const a of assignments as Assignment[]) {
      const periodStart = periodStartOf(a);
      for (const fixture of fixtures) {
        const isHome = fixture.homeTeam?.id === a.api_team_id;
        const isAway = fixture.awayTeam?.id === a.api_team_id;
        if (!isHome && !isAway) continue;

        const myScore = isHome ? fixture.score?.fullTime?.home : fixture.score?.fullTime?.away;
        const oppScore = isHome ? fixture.score?.fullTime?.away : fixture.score?.fullTime?.home;
        if (myScore == null || oppScore == null) continue; // score indisponible

        const fixtureDate = fixture.utcDate ? new Date(fixture.utcDate) : null;
        if (periodStart && fixtureDate && fixtureDate < periodStart) {
          skippedPastPeriod++;
          continue;
        }

        let delta = 0;
        let resultLabel = "N";
        if (myScore > oppScore) { delta = 1; resultLabel = "V"; }
        else if (myScore < oppScore) { delta = -1; resultLabel = "D"; }

        rows.push({
          group_id: a.group_id,
          profile_id: a.profile_id,
          api_fixture_id: fixture.id,
          opponent: isHome ? fixture.awayTeam?.name : fixture.homeTeam?.name,
          result_text: `${resultLabel} ${myScore}-${oppScore}`,
          delta,
        });
      }
    }

    // Une ligne à la fois : si une insertion échoue (trigger, contrainte),
    // les autres passent quand même.
    let inserted = 0;
    let failed = 0;
    for (const row of rows) {
      const { error: insertError } = await supabase
        .from("team_assignment_results")
        .upsert(row, { onConflict: "group_id,profile_id,api_fixture_id", ignoreDuplicates: true });
      if (insertError) {
        failed++;
        console.error("upsert team_assignment_results", row, insertError.message);
      } else {
        inserted++;
      }
    }

    return new Response(
      JSON.stringify({ fixtures: fixtures.length, candidates: rows.length, inserted, failed, skippedPastPeriod }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
