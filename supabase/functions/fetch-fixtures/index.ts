// supabase/functions/fetch-fixtures/index.ts
//
// Importe les prochains matchs de Ligue 1 (football-data.org, compétition
// FL1 — même code que fetch-standings) dans la table `matches`, pour
// chaque groupe ayant une période en cours. Appelée chaque lundi par le
// cron `weekly-fetch-fixtures`, avec une fenêtre de 14 jours à partir
// d'aujourd'hui (~2 journées de Ligue 1 d'avance, comme demandé).
//
// Idempotent : la contrainte unique (group_id, api_fixture_id) fait que
// rejouer l'import ne duplique jamais un match déjà en base (upsert avec
// ignoreDuplicates). On ne touche jamais un match déjà importé (donc
// jamais son statut/score s'il a déjà été résolu par resolve-fixtures).
//
// NB: cette fonction avait accidentellement le code de fetch-squad
// (copié-collé lors d'un déploiement précédent) — corrigé le 2026-09-08,
// c'est pour ça qu'aucun nouveau match n'arrivait automatiquement.
//
// 2026-09-09 : ajout du numéro de journée (m.matchday, fourni par
// football-data.org) — stocké sur les nouveaux matchs importés, et
// rétro-rempli (update ciblé, sans toucher status/score) sur les matchs
// déjà en base dans la fenêtre courante qui n'avaient pas encore cette
// valeur (ancien import, avant cet ajout).
//
// 2026-10-12 : un championnat se termine à la fin d'une journée (voir
// rotate_expired_group_periods) — si une journée commence avant la date
// de fin de la période, TOUS ses matchs sont importés, même ceux joués
// après cette date.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FOOTBALL_DATA_TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const COMPETITION_CODE = "FL1"; // Ligue 1, même code que fetch-standings
const WINDOW_DAYS = 14; // ~2 semaines / 2 journées d'avance à chaque import

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

Deno.serve(async (_req) => {
  try {
    const today = new Date();
    const dateFrom = today.toISOString().slice(0, 10);
    const dateTo = new Date(today.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const data = await footballData(
      `/competitions/${COMPETITION_CODE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    );
    const fixtures = (data.matches || []).filter(
      (m: any) => m.status === "SCHEDULED" || m.status === "TIMED",
    );

    // Un groupe = une période en cours = où importer ces matchs. On ne
    // dépasse pas la date de fin de la période du groupe, sauf pour finir
    // une journée déjà commencée avant cette date.
    const { data: periods, error: periodsError } = await supabase
      .from("group_periods")
      .select("id, group_id, ends_at")
      .eq("is_current", true);
    if (periodsError) throw periodsError;

    let attempted = 0;
    let failed = 0;
    let matchdayBackfilled = 0;
    for (const period of periods || []) {
      const periodEnd = new Date(period.ends_at).getTime();
      const startedMatchdays = new Set(
        fixtures
          .filter((m: any) => m.matchday != null && new Date(m.utcDate).getTime() <= periodEnd)
          .map((m: any) => m.matchday),
      );
      for (const m of fixtures) {
        if (new Date(m.utcDate).getTime() > periodEnd && !startedMatchdays.has(m.matchday)) continue;
        attempted++;
        const { error } = await supabase.from("matches").upsert(
          {
            group_id: period.group_id,
            period_id: period.id,
            api_fixture_id: m.id,
            home_team: m.homeTeam?.name ?? m.homeTeam?.shortName ?? "?",
            away_team: m.awayTeam?.name ?? m.awayTeam?.shortName ?? "?",
            home_team_api_id: m.homeTeam?.id,
            away_team_api_id: m.awayTeam?.id,
            kickoff_at: m.utcDate,
            matchday: m.matchday ?? null,
            status: "open",
            data_finalized: false,
          },
          { onConflict: "group_id,api_fixture_id", ignoreDuplicates: true },
        );
        if (error) failed++;

        // Rétro-remplissage ciblé : si ce match existait déjà (import
        // précédent, avant l'ajout de la colonne matchday), on complète
        // uniquement matchday, sans toucher au reste (status, scores...).
        if (m.matchday != null) {
          const { data: updated, error: updateError } = await supabase
            .from("matches")
            .update({ matchday: m.matchday })
            .eq("group_id", period.group_id)
            .eq("api_fixture_id", m.id)
            .is("matchday", null)
            .select("id");
          if (!updateError && updated) matchdayBackfilled += updated.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        fixtures_found: fixtures.length,
        groups: (periods || []).length,
        attempted,
        failed,
        matchday_backfilled: matchdayBackfilled,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
