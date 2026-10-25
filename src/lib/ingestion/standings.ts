/**
 * League table standings from football-data.org — real, factual, public
 * sports data (not copyrighted prose), used to give match articles genuine
 * analytical depth (league position, form, goal difference) instead of just
 * restating the final score.
 */

const BASE_URL = "https://api.football-data.org/v4";

// Table zones (the colored bars + legend on standings), per league. Only
// places fixed by the league's own rules are marked; European places that
// depend on cup winners or coefficients (Portugal, Netherlands, Brazil's
// continental spots) are deliberately left out rather than guessed.
// `from`/`to` count from the top; `fromBottom`/`toBottom` from last place,
// so one rule fits 18-, 20- and 24-team leagues.
export interface StandingsZone {
  key: string;
  label: string;
  color: string;
  from?: number;
  to?: number;
  fromBottom?: number;
  toBottom?: number;
}

export const ZONE_COLORS = { qualify: "#1a73e8", promote: "#188038", playoff: "#f29900", relegate: "#d93025" } as const;
const CL = { key: "cl", label: "Champions League", color: ZONE_COLORS.qualify };
const RELEGATION = { key: "rel", label: "Relegation", color: ZONE_COLORS.relegate };
const REL_PLAYOFF = { key: "relpo", label: "Relegation play-off", color: ZONE_COLORS.playoff };

export const LEAGUE_ZONES: Record<string, StandingsZone[]> = {
  PL: [{ ...CL, from: 1, to: 4 }, { ...RELEGATION, fromBottom: 1, toBottom: 3 }],
  ELC: [
    { key: "promo", label: "Promotion", color: ZONE_COLORS.promote, from: 1, to: 2 },
    { key: "promopo", label: "Promotion play-offs", color: ZONE_COLORS.qualify, from: 3, to: 6 },
    { ...RELEGATION, fromBottom: 1, toBottom: 3 },
  ],
  PD: [{ ...CL, from: 1, to: 4 }, { ...RELEGATION, fromBottom: 1, toBottom: 3 }],
  SA: [{ ...CL, from: 1, to: 4 }, { ...RELEGATION, fromBottom: 1, toBottom: 3 }],
  BL1: [{ ...CL, from: 1, to: 4 }, { ...REL_PLAYOFF, fromBottom: 3, toBottom: 3 }, { ...RELEGATION, fromBottom: 1, toBottom: 2 }],
  FL1: [{ ...CL, from: 1, to: 3 }, { ...REL_PLAYOFF, fromBottom: 3, toBottom: 3 }, { ...RELEGATION, fromBottom: 1, toBottom: 2 }],
  PPL: [{ ...REL_PLAYOFF, fromBottom: 3, toBottom: 3 }, { ...RELEGATION, fromBottom: 1, toBottom: 2 }],
  DED: [{ ...REL_PLAYOFF, fromBottom: 3, toBottom: 3 }, { ...RELEGATION, fromBottom: 1, toBottom: 2 }],
  BSA: [{ ...RELEGATION, fromBottom: 1, toBottom: 4 }],
};

// The zone a table position falls in, if any (pure, unit-tested).
export function zoneFor(code: string, position: number, teams: number): StandingsZone | undefined {
  const fromBottom = teams - position + 1;
  return (LEAGUE_ZONES[code] ?? []).find((z) =>
    z.from !== undefined
      ? position >= z.from && position <= (z.to ?? z.from)
      : z.fromBottom !== undefined && fromBottom >= z.fromBottom && fromBottom <= (z.toBottom ?? z.fromBottom)
  );
}

// The domestic leagues covered by football-data.org's free tier that actually
// have a league table (knockout-only competitions like the Champions League,
// World Cup, and Euros don't — confirmed via direct API testing).
export const STANDINGS_LEAGUES = [
  { code: "PL", name: "Premier League" },
  { code: "ELC", name: "Championship" },
  { code: "PD", name: "La Liga" },
  { code: "SA", name: "Serie A" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "DED", name: "Eredivisie" },
  { code: "BSA", name: "Brasileirão" },
];

export interface TeamStanding {
  position: number;
  points: number;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export async function fetchStandings(
  apiKey: string,
  competitionCode: string
): Promise<Map<number, TeamStanding>> {
  const map = new Map<number, TeamStanding>();

  try {
    const res = await fetch(`${BASE_URL}/competitions/${competitionCode}/standings`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!res.ok) {
      // Not every competition has a league table (e.g. knockout-only stages) —
      // that's expected, not an error worth surfacing.
      return map;
    }

    const data = await res.json();
    for (const standing of data.standings ?? []) {
      if (standing.type !== "TOTAL") continue; // skip home/away-only splits
      for (const row of standing.table ?? []) {
        if (!row.team?.id) continue;
        map.set(row.team.id, {
          position: row.position,
          points: row.points,
          playedGames: row.playedGames,
          won: row.won,
          draw: row.draw,
          lost: row.lost,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference,
        });
      }
    }
  } catch (err) {
    console.error(`Standings fetch failed for ${competitionCode}:`, err);
  }

  return map;
}

export interface StandingsTableRow extends TeamStanding {
  teamId: number;
  teamName: string;
  teamCrest: string | null;
}

export interface StandingsTable {
  competitionName: string;
  rows: StandingsTableRow[];
}

/**
 * Full standings table with team names/crests, for direct display (the
 * homepage widget and the /standings detail page) — as opposed to
 * fetchStandings' Map-by-team-id, which is built for match-enrichment
 * lookups and deliberately doesn't carry team name/crest.
 */
export async function fetchStandingsTable(
  apiKey: string,
  competitionCode: string
): Promise<StandingsTable | null> {
  try {
    // Called from every homepage/article/player/club page render with no
    // caching, this was hitting the free tier's 10 requests/minute limit
    // almost immediately under normal browsing — the widget would then
    // silently render nothing (see the `!res.ok` branch below). Next.js's
    // Data Cache reuses this response across all renders, cutting real API
    // calls from "once per page view" to "once per competition per window"
    // site-wide. Shortened from 300s to 60s — confirmed live that a stale
    // standings table (showing a since-corrected points total) was visible
    // on player pages, which cache their own page HTML for a full hour
    // (see player/[slug]/page.tsx's own revalidate) on top of this fetch
    // cache; 60s keeps this fetch itself from ever being the long pole,
    // trading a bit more API-quota usage for correctness on genuinely
    // live sports data.
    const res = await fetch(`${BASE_URL}/competitions/${competitionCode}/standings`, {
      headers: { "X-Auth-Token": apiKey },
      next: { revalidate: 60 },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const table = data.standings?.find((s: any) => s.type === "TOTAL")?.table ?? [];

    return {
      competitionName: data.competition?.name ?? competitionCode,
      rows: table.map((row: any) => ({
        teamId: row.team?.id,
        teamName: row.team?.name ?? "Unknown",
        teamCrest: row.team?.crest ?? null,
        position: row.position,
        points: row.points,
        playedGames: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
      })),
    };
  } catch (err) {
    console.error(`Standings table fetch failed for ${competitionCode}:`, err);
    return null;
  }
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
