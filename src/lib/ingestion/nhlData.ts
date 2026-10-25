/**
 * Pulls NHL match data from ESPN's public scoreboard/standings JSON API
 * (site.api.espn.com) — same source and pattern as nflData.ts, confirmed
 * working live for hockey/nhl (2026-09-16). New sport category "hockey".
 *
 * Same RawMatchItem shape as footballData.ts, reused directly.
 */
import type { RawMatchItem } from "./footballData";
import { espnBroadcast, espnLiveClock, espnRecord, espnScore, type EspnStatus } from "../scores/espnStatus";
import { espnFetch } from "../espnFetch";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";
const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings";

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

interface EspnVenue {
  fullName: string;
  address?: { city?: string; state?: string; country?: string };
}

interface EspnEvent {
  id: string;
  date: string;
  status: EspnStatus;
  competitions: { competitors: EspnCompetitor[]; venue?: EspnVenue; broadcasts?: { names?: string[] }[] }[];
}

interface TeamRecord {
  wins: number;
  losses: number;
  otLosses: number;
}

// Same reasoning as nflData.ts's fetchTeamRecords — real season context
// instead of just restating the score.
async function fetchTeamRecords(): Promise<Map<string, TeamRecord>> {
  try {
    const res = await espnFetch(`${STANDINGS_URL}?season=${new Date().getFullYear()}`);
    if (!res.ok) {
      console.error(`ESPN NHL standings fetch failed: ${res.status}`);
      return new Map();
    }
    const data = await res.json();
    const records = new Map<string, TeamRecord>();
    for (const conference of data.children ?? []) {
      for (const entry of conference.standings?.entries ?? []) {
        const stat = (name: string) =>
          Number(entry.stats?.find((s: { name: string }) => s.name === name)?.displayValue ?? 0);
        records.set(entry.team?.id, {
          wins: stat("wins"),
          losses: stat("losses"),
          otLosses: stat("otLosses"),
        });
      }
    }
    return records;
  } catch (err) {
    console.error("ESPN NHL standings fetch failed:", err);
    return new Map();
  }
}

function recordContext(teamName: string, record: TeamRecord | undefined): string {
  if (!record) return "";
  return ` ${teamName} are ${record.wins}-${record.losses}-${record.otLosses} this season.`;
}

export async function fetchNhlData(): Promise<RawMatchItem[]> {
  const [scoreboardRes, teamRecords] = await Promise.all([
    espnFetch(SCOREBOARD_URL).catch((err) => {
      console.error("ESPN NHL scoreboard fetch failed:", err);
      return null;
    }),
    fetchTeamRecords(),
  ]);

  if (!scoreboardRes || !scoreboardRes.ok) {
    if (scoreboardRes) console.error(`ESPN NHL scoreboard fetch failed: ${scoreboardRes.status}`);
    return [];
  }

  const data = await scoreboardRes.json();
  const items: RawMatchItem[] = [];

  for (const event of (data.events ?? []) as EspnEvent[]) {
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

    const venueInfo = event.competitions?.[0]?.venue;
    const venue = venueInfo
      ? [venueInfo.fullName, venueInfo.address?.city, venueInfo.address?.state].filter(Boolean).join(", ")
      : undefined;

    const homeTeam = home.team.displayName;
    const awayTeam = away.team.displayName;
    const context = recordContext(homeTeam, teamRecords.get(home.team.id)) + recordContext(awayTeam, teamRecords.get(away.team.id));

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
      summary = `${homeTeam} played ${awayTeam} in the NHL, finishing ${homeScore}-${awayScore}.`;

      const resultSentence =
        Number(homeScore) > Number(awayScore) ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : Number(awayScore) > Number(homeScore) ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The game finished ${homeScore}-${awayScore}.`;
      body = `${homeTeam} played ${awayTeam} in the NHL on ${fullDateLabel}. ${resultSentence}${context}`;
    } else {
      const puckDrop = new Date(event.date);
      const dateLabel = puckDrop.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const puckDropLabel = puckDrop.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the NHL on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the NHL. Puck drop is ${puckDropLabel}.${context}`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.espn.com/nhl/game/_/gameId/${event.id}`,
      sourceName: "ESPN NHL",
      category: "hockey",
      publishedAt: new Date(event.date),
      homeCrestUrl: home.team.logo,
      awayCrestUrl: away.team.logo,
      homeTeam,
      awayTeam,
      homeScore: isFinal || isLive ? espnScore(home) : undefined,
      awayScore: isFinal || isLive ? espnScore(away) : undefined,
      matchStatus: isFinal ? "finished" : "scheduled",
      leagueLabel: "NHL",
      matchClock: espnLiveClock("hockey", event.status),
      homeRecord: espnRecord(home),
      awayRecord: espnRecord(away),
      broadcast: espnBroadcast(event.competitions?.[0]),
      kickoffAt: new Date(event.date),
      dedupeKey: `espn-nhl-${event.id}`,
      venue,
    });
  }

  return items;
}

export interface NhlStandingsRow {
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  playoffSeed: number;
}

export interface NhlConferenceStandings {
  conferenceName: string;
  rows: NhlStandingsRow[];
}

// Added 2026-09-20 (real gap: no standings widget existed for
// `/sport/hockey`) — same shape as nflData.ts's fetchNflStandingsTable,
// but hockey standings are conventionally ranked/displayed by points (not
// raw win-loss, since an OT/shootout loss still earns a point) — confirmed
// live the endpoint exposes "otLosses" (not "ties") and "points" alongside
// the usual wins/losses/playoffSeed.
export async function fetchNhlStandingsTable(): Promise<NhlConferenceStandings[] | null> {
  try {
    const res = await espnFetch(`${STANDINGS_URL}?season=${new Date().getFullYear()}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;

    const data = await res.json();
    const conferences: NhlConferenceStandings[] = [];

    for (const conference of data.children ?? []) {
      const rows: NhlStandingsRow[] = (conference.standings?.entries ?? []).map((entry: any) => {
        const stat = (name: string) =>
          Number(entry.stats?.find((s: { name: string }) => s.name === name)?.displayValue ?? 0);
        return {
          teamId: entry.team?.id ?? "",
          teamName: entry.team?.displayName ?? "Unknown",
          teamLogo: entry.team?.logo ?? entry.team?.logos?.[0]?.href ?? null,
          wins: stat("wins"),
          losses: stat("losses"),
          otLosses: stat("otLosses"),
          points: stat("points"),
          playoffSeed: stat("playoffSeed"),
        };
      });
      rows.sort((a, b) => (a.playoffSeed || 99) - (b.playoffSeed || 99));
      conferences.push({ conferenceName: conference.name ?? "Conference", rows });
    }

    return conferences.length > 0 ? conferences : null;
  } catch (err) {
    console.error("NHL standings table fetch failed:", err);
    return null;
  }
}
