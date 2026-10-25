/**
 * Pulls MLB match data from the official MLB Stats API (statsapi.mlb.com) —
 * genuinely public and free, no API key required, confirmed working
 * directly (2026-09-12). Unlike football-data.org/CricketData.org, this is
 * MLB's own official data, not a third-party aggregator, so no daily
 * request cap to self-throttle against.
 *
 * Standings table added 2026-09-20 (real gap: no standings widget existed
 * for `/sport/baseball`) — uses ESPN's standings endpoint instead of the
 * MLB Stats API above, same `site.api.espn.com/apis/v2/sports/.../standings`
 * family already used for NFL/NBA, confirmed live with the same stat names
 * plus `ties`.
 *
 * Same RawMatchItem shape as footballData.ts/nflData.ts, reused directly.
 */
import type { RawMatchItem } from "./footballData";
import { espnFetch } from "../espnFetch";

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";
const ESPN_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings";

// Static per-team logo CDN — MLB's own, confirmed working directly
// (2026-09-12): https://www.mlbstatic.com/team-logos/{teamId}.svg
function teamLogo(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

interface MlbTeamRef {
  team: { id: number; name: string };
  score?: number;
  leagueRecord?: { wins: number; losses: number };
}

interface MlbLinescore {
  currentInningOrdinal?: string;
  inningState?: string; // "Top" | "Middle" | "Bottom" | "End"
  outs?: number;
}

export interface MlbGame {
  gamePk: number;
  gameDate: string;
  status: { abstractGameState: string; detailedState?: string };
  linescore?: MlbLinescore;
  teams: { home: MlbTeamRef; away: MlbTeamRef };
  venue?: { name: string };
}

// Live game clock from the linescore: "Top 8th", "Mid 7th", "End 7th",
// "Bot 9th · 2 out"; "Delayed" for a weather/other delay. null when the
// game isn't in progress or the linescore hasn't started (warmup).
export function mlbLiveClock(game: Pick<MlbGame, "status" | "linescore">): string | null {
  if (game.status?.abstractGameState !== "Live") return null;
  if (/delay|suspend/i.test(game.status.detailedState ?? "")) return "Delayed";
  const inning = game.linescore?.currentInningOrdinal;
  const half = game.linescore?.inningState;
  if (!inning || !half) return null;
  const label = { Top: "Top", Bottom: "Bot", Middle: "Mid", End: "End" }[half] ?? half;
  const outs = game.linescore?.outs;
  const inPlay = half === "Top" || half === "Bottom";
  return inPlay && outs !== undefined && outs < 3 ? `${label} ${inning} · ${outs} out` : `${label} ${inning}`;
}

function recordContext(teamName: string, record: MlbTeamRef["leagueRecord"]): string {
  if (!record) return "";
  return ` ${teamName} are ${record.wins}-${record.losses}.`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function fetchMlbData(): Promise<RawMatchItem[]> {
  const now = new Date();
  const startDate = isoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const endDate = isoDate(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));

  let res: Response;
  try {
    // hydrate=linescore adds live innings/outs for in-progress games.
    res = await fetch(`${SCHEDULE_URL}?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=linescore`);
  } catch (err) {
    console.error("MLB Stats API fetch failed (network error):", err);
    return [];
  }
  if (!res.ok) {
    console.error(`MLB Stats API fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const items: RawMatchItem[] = [];

  for (const dateEntry of data.dates ?? []) {
    for (const game of (dateEntry.games ?? []) as MlbGame[]) {
      // Only finished results and pre-game previews — an in-progress game
      // would just be a confusing partial snapshot by the time this
      // article is actually read (same reasoning as nflData.ts).
      const state = game.status?.abstractGameState;
      // "Live" games were skipped until 2026-09-26, so a game in progress
      // had no score at all. Kept now with the running score and inning
      // (matchStatus stays "scheduled", same as the ESPN sources).
      if (state !== "Final" && state !== "Preview" && state !== "Live") continue;
      const isLive = state === "Live";

      const { home, away } = game.teams;
      const homeTeam = home.team.name;
      const awayTeam = away.team.name;
      const context = recordContext(homeTeam, home.leagueRecord) + recordContext(awayTeam, away.leagueRecord);

      let title: string;
      let summary: string;
      let body: string;

      if (state === "Final") {
        const homeScore = home.score ?? 0;
        const awayScore = away.score ?? 0;
        const fullDateLabel = new Date(game.gameDate).toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
        });

        title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
        summary = `${homeTeam} played ${awayTeam} in MLB, finishing ${homeScore}-${awayScore}.`;

        const resultSentence =
          homeScore > awayScore ? `${homeTeam} won ${homeScore}-${awayScore}.`
          : awayScore > homeScore ? `${awayTeam} won ${awayScore}-${homeScore}.`
          : `The game ended ${homeScore}-${awayScore}.`;
        body = `${homeTeam} played ${awayTeam} in MLB on ${fullDateLabel}${game.venue ? ` at ${game.venue.name}` : ""}. ${resultSentence}${context}`;
      } else {
        const firstPitch = new Date(game.gameDate);
        const dateLabel = firstPitch.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const firstPitchLabel = firstPitch.toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
        });

        title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
        summary = `${homeTeam} face ${awayTeam} in MLB on ${dateLabel}.`;
        body = `${homeTeam} face ${awayTeam} in MLB. First pitch is ${firstPitchLabel}.${context}`;
      }

      items.push({
        title,
        summary,
        body,
        sourceUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
        sourceName: "MLB Stats API",
        category: "baseball",
        publishedAt: new Date(game.gameDate),
        homeCrestUrl: teamLogo(home.team.id),
        awayCrestUrl: teamLogo(away.team.id),
        homeTeam,
        awayTeam,
        homeScore: state === "Final" || isLive ? home.score : undefined,
        awayScore: state === "Final" || isLive ? away.score : undefined,
        matchStatus: state === "Final" ? "finished" : "scheduled",
        leagueLabel: "MLB",
        matchClock: mlbLiveClock(game),
        homeRecord: home.leagueRecord ? `${home.leagueRecord.wins}-${home.leagueRecord.losses}` : undefined,
        awayRecord: away.leagueRecord ? `${away.leagueRecord.wins}-${away.leagueRecord.losses}` : undefined,
        venue: game.venue?.name,
        kickoffAt: new Date(game.gameDate),
        // gamePk is MLB's own stable game identifier — unlike the title
        // (which embeds a date), it never changes for a given game.
        dedupeKey: `mlb-${game.gamePk}`,
      });
    }
  }

  return items;
}

export interface MlbStandingsRow {
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  wins: number;
  losses: number;
  ties: number;
  playoffSeed: number;
}

export interface MlbConferenceStandings {
  conferenceName: string;
  rows: MlbStandingsRow[];
}

// Same shape as nflData.ts's fetchNflStandingsTable — direct copy of that
// pattern (confirmed live 2026-09-20: MLB's ESPN standings entries expose
// the same stat names as NFL's, plus "ties").
export async function fetchMlbStandingsTable(): Promise<MlbConferenceStandings[] | null> {
  try {
    const res = await espnFetch(`${ESPN_STANDINGS_URL}?season=${new Date().getFullYear()}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;

    const data = await res.json();
    const conferences: MlbConferenceStandings[] = [];

    for (const conference of data.children ?? []) {
      const rows: MlbStandingsRow[] = (conference.standings?.entries ?? []).map((entry: any) => {
        const stat = (name: string) =>
          Number(entry.stats?.find((s: { name: string }) => s.name === name)?.displayValue ?? 0);
        return {
          teamId: entry.team?.id ?? "",
          teamName: entry.team?.displayName ?? "Unknown",
          teamLogo: entry.team?.logo ?? entry.team?.logos?.[0]?.href ?? null,
          wins: stat("wins"),
          losses: stat("losses"),
          ties: stat("ties"),
          playoffSeed: stat("playoffSeed"),
        };
      });
      rows.sort((a, b) => (a.playoffSeed || 99) - (b.playoffSeed || 99));
      conferences.push({ conferenceName: conference.name ?? "Conference", rows });
    }

    return conferences.length > 0 ? conferences : null;
  } catch (err) {
    console.error("MLB standings table fetch failed:", err);
    return null;
  }
}
