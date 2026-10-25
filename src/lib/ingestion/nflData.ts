/**
 * Pulls NFL match data from ESPN's public scoreboard/standings JSON API
 * (site.api.espn.com). Unofficial and undocumented — ESPN doesn't publish
 * or support it, so it could change or get rate-limited without notice —
 * but no API key is required, confirmed working directly (2026-09-10), and
 * this exact endpoint shape has been stable and widely used by developers
 * for years (unlike, for example, Reddit's recently-locked-down endpoint).
 *
 * Same RawMatchItem shape as footballData.ts, reused directly rather than
 * duplicated.
 */
import { ordinal } from "./standings";
import type { RawMatchItem } from "./footballData";
import { espnBroadcast, espnLiveClock, espnRecord, espnScore, type EspnStatus } from "../scores/espnStatus";
import { espnFetch } from "../espnFetch";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";

interface EspnTeam {
  id: string;
  displayName: string;
  logo?: string;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score: string;
  team: EspnTeam;
  records?: { type?: string; summary?: string }[];
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
  ties: number;
  playoffSeed: number;
  conferenceName: string;
}

// Standings give each match real analytical depth (season record, playoff
// seed) instead of just restating the score — same reasoning as
// standings.ts's use for football. Conference standings here are already
// flat (32 teams total across the two conferences, no further division
// nesting in this endpoint), so no recursion needed.
async function fetchTeamRecords(): Promise<Map<string, TeamRecord>> {
  try {
    const res = await espnFetch(`${STANDINGS_URL}?season=${new Date().getFullYear()}`);
    if (!res.ok) {
      console.error(`ESPN NFL standings fetch failed: ${res.status}`);
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
          ties: stat("ties"),
          playoffSeed: stat("playoffSeed"),
          conferenceName: conference.name ?? "",
        });
      }
    }
    return records;
  } catch (err) {
    console.error("ESPN NFL standings fetch failed:", err);
    return new Map();
  }
}

export interface NflStandingsRow {
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  wins: number;
  losses: number;
  ties: number;
  playoffSeed: number;
}

export interface NflConferenceStandings {
  conferenceName: string;
  rows: NflStandingsRow[];
}

// Same underlying ESPN standings endpoint as fetchTeamRecords above, but
// keeping team name/logo/full record for direct display (fetchTeamRecords
// only keeps what's needed for match-article context text and discards
// the rest) — same fetchStandings-vs-fetchStandingsTable split as
// standings.ts uses for football. Team logo field name (`team.logo` vs
// `team.logos[0].href`) wasn't verified against a live response — network
// access to ESPN's API was blocked in the environment this was built in —
// so both shapes are checked defensively; a missing logo just renders
// without one rather than breaking.
export async function fetchNflStandingsTable(): Promise<NflConferenceStandings[] | null> {
  try {
    const res = await espnFetch(`${STANDINGS_URL}?season=${new Date().getFullYear()}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;

    const data = await res.json();
    const conferences: NflConferenceStandings[] = [];

    for (const conference of data.children ?? []) {
      const rows: NflStandingsRow[] = (conference.standings?.entries ?? []).map((entry: any) => {
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
    console.error("NFL standings table fetch failed:", err);
    return null;
  }
}

function recordContext(teamName: string, record: TeamRecord | undefined): string {
  if (!record) return "";
  const recordStr = record.ties > 0 ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`;
  const seedText = record.playoffSeed > 0 ? `, seeded ${ordinal(record.playoffSeed)} in the ${record.conferenceName}` : "";
  return ` ${teamName} are ${recordStr}${seedText}.`;
}

// "NFL · Week 3" in the regular season (season.type 2), otherwise the
// phase — the heading games are grouped under on /scores.
function nflLeagueLabel(data: { week?: { number?: number }; season?: { type?: number } }): string {
  const seasonType = data.season?.type;
  if (seasonType === 1) return "NFL Preseason";
  if (seasonType === 3) return "NFL Playoffs";
  const week = data.week?.number;
  return seasonType === 2 && week ? `NFL · Week ${week}` : "NFL";
}

export async function fetchNflData(): Promise<RawMatchItem[]> {
  const [scoreboardRes, teamRecords] = await Promise.all([
    espnFetch(SCOREBOARD_URL).catch((err) => {
      console.error("ESPN NFL scoreboard fetch failed:", err);
      return null;
    }),
    fetchTeamRecords(),
  ]);

  if (!scoreboardRes || !scoreboardRes.ok) {
    if (scoreboardRes) console.error(`ESPN NFL scoreboard fetch failed: ${scoreboardRes.status}`);
    return [];
  }

  const data = await scoreboardRes.json();
  const leagueLabel = nflLeagueLabel(data);
  const items: RawMatchItem[] = [];

  for (const event of (data.events ?? []) as EspnEvent[]) {
    // "pre" = upcoming, "in" = in progress (live, halftime, etc.), "post" =
    // final. In-progress games used to be skipped entirely, so a live game
    // showed no score anywhere until it ended. They're now kept with the
    // running score but stay matchStatus "scheduled" (see below): every
    // score display already reads "scheduled + kickoff in the past" as live
    // (liveMatches.ts, MatchTicker, /scores), and "finished" stays reserved
    // for final results so a live game never lands in results sections or
    // the hero. runIngest.ts's duplicate refresh updates the score each poll.
    const state = event.status?.type?.state;
    if (state !== "post" && state !== "pre" && state !== "in") continue;
    const isFinal = state === "post";
    const isLive = state === "in";

    const competitors = event.competitions?.[0]?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    // Real venue data, confirmed live in ESPN's own scoreboard response —
    // unlike football-data.org, which doesn't provide this on our tier.
    // Powers SportsEvent JSON-LD's "location" field (see
    // article/[slug]/page.tsx) — Google Search Console flagged this as a
    // critical missing field for Events structured data (2026-09-15).
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

    if (isFinal) {
      const homeScore = home.score;
      const awayScore = away.score;
      const fullDateLabel = new Date(event.date).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      });

      title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
      summary = `${homeTeam} played ${awayTeam} in the NFL, finishing ${homeScore}-${awayScore}.`;

      const resultSentence =
        Number(homeScore) > Number(awayScore) ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : Number(awayScore) > Number(homeScore) ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The game ended in a ${homeScore}-${awayScore} tie.`;
      body = `${homeTeam} played ${awayTeam} in the NFL on ${fullDateLabel}. ${resultSentence}${context}`;
    } else {
      const kickoff = new Date(event.date);
      const dateLabel = kickoff.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const kickoffLabel = kickoff.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the NFL on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the NFL. Kickoff is ${kickoffLabel}.${context}`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.espn.com/nfl/game/_/gameId/${event.id}`,
      sourceName: "ESPN NFL",
      category: "american-football",
      publishedAt: new Date(event.date),
      homeCrestUrl: home.team.logo,
      awayCrestUrl: away.team.logo,
      homeTeam,
      awayTeam,
      // Final score, or the running score while live. scoreOf drops a
      // missing/non-numeric value rather than storing 0 or NaN.
      homeScore: isFinal || isLive ? espnScore(home) : undefined,
      awayScore: isFinal || isLive ? espnScore(away) : undefined,
      matchStatus: isFinal ? "finished" : "scheduled",
      leagueLabel,
      // Live clock only while in progress; null clears it at the final.
      matchClock: espnLiveClock("quarters", event.status),
      homeRecord: espnRecord(home),
      awayRecord: espnRecord(away),
      broadcast: espnBroadcast(event.competitions?.[0]),
      kickoffAt: new Date(event.date),
      // event.id is ESPN's own stable game identifier — unlike the title
      // (which embeds a kickoff date ESPN can revise as broadcast slots get
      // finalized), it never changes for a given game, so dedup keyed on it
      // can't be fooled by a schedule-time update. See dedupe.ts.
      dedupeKey: `espn-nfl-${event.id}`,
      venue,
    });
  }

  return items;
}
