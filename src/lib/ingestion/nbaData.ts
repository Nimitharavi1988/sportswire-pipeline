/**
 * Pulls NBA match data from ESPN's public scoreboard JSON API
 * (site.api.espn.com) — same unofficial/undocumented endpoint family as
 * nflData.ts, confirmed working directly (2026-09-12): real event/team/
 * score/logo fields, identical shape to the NFL endpoint.
 *
 * Standings table added 2026-09-20 (real gap found: the homepage sidebar
 * had no standings widget at all for `/sport/basketball`, unlike
 * football/NFL) — same `site.api.espn.com/apis/v2/sports/.../standings`
 * endpoint family and same stat names (wins/losses/playoffSeed) as NFL's,
 * confirmed live.
 *
 * Same RawMatchItem shape as footballData.ts/nflData.ts, reused directly.
 */
import type { RawMatchItem } from "./footballData";
import { espnBroadcast, espnLiveClock, espnRecord, espnScore, type EspnStatus } from "../scores/espnStatus";
import { espnFetch } from "../espnFetch";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";

interface EspnTeam {
  id: string;
  displayName: string;
  logo?: string;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score: string;
  records?: { type?: string; summary?: string }[];
  team: EspnTeam;
}

interface EspnEvent {
  id: string;
  date: string;
  status: EspnStatus;
  competitions: { competitors: EspnCompetitor[]; broadcasts?: { names?: string[] }[] }[];
}

export async function fetchNbaData(): Promise<RawMatchItem[]> {
  let res: Response;
  try {
    res = await espnFetch(SCOREBOARD_URL);
  } catch (err) {
    console.error("ESPN NBA scoreboard fetch failed (network error):", err);
    return [];
  }
  if (!res.ok) {
    console.error(`ESPN NBA scoreboard fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const items: RawMatchItem[] = [];

  for (const event of (data.events ?? []) as EspnEvent[]) {
    // Only finished results and pre-game previews — an in-progress game
    // would just be a confusing partial snapshot (same reasoning as
    // nflData.ts/mlbData.ts).
    const state = event.status?.type?.state;
    // "in" (live) games are kept with the running score, still matchStatus
    // "scheduled" — same approach and reasoning as nflData.ts.
    if (state !== "post" && state !== "pre" && state !== "in") continue;
    const isFinal = state === "post";
    const isLive = state === "in";

    const competitors = event.competitions?.[0]?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const homeTeam = home.team.displayName;
    const awayTeam = away.team.displayName;

    let title: string;
    let summary: string;
    let body: string;

    if (state === "post") {
      const homeScore = home.score;
      const awayScore = away.score;
      const fullDateLabel = new Date(event.date).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      });

      title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
      summary = `${homeTeam} played ${awayTeam} in the NBA, finishing ${homeScore}-${awayScore}.`;

      const resultSentence =
        Number(homeScore) > Number(awayScore) ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : Number(awayScore) > Number(homeScore) ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The game finished ${homeScore}-${awayScore}.`;
      body = `${homeTeam} played ${awayTeam} in the NBA on ${fullDateLabel}. ${resultSentence}`;
    } else {
      const tipoff = new Date(event.date);
      const dateLabel = tipoff.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const tipoffLabel = tipoff.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the NBA on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the NBA. Tipoff is ${tipoffLabel}.`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.espn.com/nba/game/_/gameId/${event.id}`,
      sourceName: "ESPN NBA",
      category: "basketball",
      publishedAt: new Date(event.date),
      homeCrestUrl: home.team.logo,
      awayCrestUrl: away.team.logo,
      homeTeam,
      awayTeam,
      homeScore: isFinal || isLive ? espnScore(home) : undefined,
      awayScore: isFinal || isLive ? espnScore(away) : undefined,
      matchStatus: isFinal ? "finished" : "scheduled",
      leagueLabel: "NBA",
      matchClock: espnLiveClock("quarters", event.status),
      homeRecord: espnRecord(home),
      awayRecord: espnRecord(away),
      broadcast: espnBroadcast(event.competitions?.[0]),
      kickoffAt: new Date(event.date),
      // event.id is ESPN's own stable game identifier, same reasoning as
      // nflData.ts's dedupeKey.
      dedupeKey: `espn-nba-${event.id}`,
    });
  }

  return items;
}

export interface NbaStandingsRow {
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  wins: number;
  losses: number;
  playoffSeed: number;
}

export interface NbaConferenceStandings {
  conferenceName: string;
  rows: NbaStandingsRow[];
}

// Same shape as nflData.ts's fetchNflStandingsTable — direct copy of that
// pattern, same stat names (confirmed live 2026-09-20: NBA's standings
// entries expose "wins"/"losses"/"playoffSeed" identically to NFL's).
export async function fetchNbaStandingsTable(): Promise<NbaConferenceStandings[] | null> {
  try {
    const res = await espnFetch(`${STANDINGS_URL}?season=${new Date().getFullYear()}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;

    const data = await res.json();
    const conferences: NbaConferenceStandings[] = [];

    for (const conference of data.children ?? []) {
      const rows: NbaStandingsRow[] = (conference.standings?.entries ?? []).map((entry: any) => {
        const stat = (name: string) =>
          Number(entry.stats?.find((s: { name: string }) => s.name === name)?.displayValue ?? 0);
        return {
          teamId: entry.team?.id ?? "",
          teamName: entry.team?.displayName ?? "Unknown",
          teamLogo: entry.team?.logo ?? entry.team?.logos?.[0]?.href ?? null,
          wins: stat("wins"),
          losses: stat("losses"),
          playoffSeed: stat("playoffSeed"),
        };
      });
      rows.sort((a, b) => (a.playoffSeed || 99) - (b.playoffSeed || 99));
      conferences.push({ conferenceName: conference.name ?? "Conference", rows });
    }

    return conferences.length > 0 ? conferences : null;
  } catch (err) {
    console.error("NBA standings table fetch failed:", err);
    return null;
  }
}
