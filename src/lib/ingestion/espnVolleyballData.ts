/**
 * Pulls US college volleyball match data from ESPN's public scoreboard API
 * (site.api.espn.com) — same unofficial-but-keyless pattern as
 * nhlData.ts/domesticFootballData.ts. Added as a second volleyball source
 * alongside volleyballData.ts (API-Sports.io, international/pro
 * competitions) after that account was suspended — confirmed live
 * (2026-09-16) this endpoint has no such dependency, plus richer data than
 * API-Sports ever provided: real venue, per-set scores, and season
 * win-loss records, all used below instead of the bare one-liner
 * volleyballData.ts was limited to.
 *
 * Scope is narrower than the API-Sports source (US college only, not
 * international/national-team competitions) — a real gap, not a full
 * replacement, but genuinely free and reliable where it applies.
 *
 * Same RawMatchItem shape as footballData.ts, reused directly.
 */
import type { RawMatchItem } from "./footballData";
import { espnBroadcast, espnLiveClock, espnRecord, espnScore, type EspnStatus } from "../scores/espnStatus";
import { espnFetch } from "../espnFetch";

const LEAGUES: { code: string; label: string }[] = [
  { code: "mens-college-volleyball", label: "NCAA Men's Volleyball" },
  { code: "womens-college-volleyball", label: "NCAA Women's Volleyball" },
];

interface EspnTeam {
  id: string;
  displayName: string;
  logo?: string;
}

interface EspnLinescore {
  displayValue: string;
}

interface EspnRecord {
  name: string;
  summary: string;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score: string;
  team: EspnTeam;
  linescores?: EspnLinescore[];
  records?: EspnRecord[];
}

interface EspnVenue {
  fullName: string;
  address?: { city?: string; state?: string };
}

interface EspnEvent {
  id: string;
  date: string;
  status: EspnStatus;
  competitions: { competitors: EspnCompetitor[]; venue?: EspnVenue; broadcasts?: { names?: string[] }[] }[];
}

function overallRecord(competitor: EspnCompetitor): string | undefined {
  return competitor.records?.find((r) => r.name === "overall")?.summary;
}

function recordContext(teamName: string, record: string | undefined): string {
  if (!record) return "";
  return ` ${teamName} are ${record} this season.`;
}

function setScoreLine(competitors: EspnCompetitor[]): string | undefined {
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home?.linescores?.length || !away?.linescores?.length) return undefined;
  const sets = home.linescores.map((s, i) => `${s.displayValue}-${away.linescores![i]?.displayValue ?? "?"}`);
  return sets.join(", ");
}

async function fetchLeague(league: { code: string; label: string }): Promise<RawMatchItem[]> {
  const res = await espnFetch(
    `https://site.api.espn.com/apis/site/v2/sports/volleyball/${league.code}/scoreboard`
  ).catch((err) => {
    console.error(`ESPN ${league.label} scoreboard fetch failed:`, err);
    return null;
  });
  if (!res || !res.ok) {
    if (res) console.error(`ESPN ${league.label} scoreboard fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
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
    const context = recordContext(homeTeam, overallRecord(home)) + recordContext(awayTeam, overallRecord(away));

    let title: string;
    let summary: string;
    let body: string;

    if (state === "post") {
      const homeScore = home.score;
      const awayScore = away.score;
      const fullDateLabel = new Date(event.date).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      });
      const sets = setScoreLine(competitors);

      title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
      summary = `${homeTeam} played ${awayTeam} in ${league.label}, finishing ${homeScore}-${awayScore} in sets.`;

      const resultSentence =
        Number(homeScore) > Number(awayScore) ? `${homeTeam} won ${homeScore}-${awayScore} in sets${sets ? ` (${sets})` : ""}.`
        : Number(awayScore) > Number(homeScore) ? `${awayTeam} won ${awayScore}-${homeScore} in sets${sets ? ` (${sets})` : ""}.`
        : `The match finished ${homeScore}-${awayScore} in sets.`;
      body = `${homeTeam} played ${awayTeam} in ${league.label} on ${fullDateLabel}. ${resultSentence}${context}`;
    } else {
      const startTime = new Date(event.date);
      const dateLabel = startTime.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const startLabel = startTime.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in ${league.label} on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in ${league.label}. First serve is ${startLabel}.${context}`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.espn.com/${league.code}/game/_/gameId/${event.id}`,
      sourceName: "ESPN Volleyball",
      category: "volleyball",
      publishedAt: new Date(event.date),
      homeCrestUrl: home.team.logo,
      awayCrestUrl: away.team.logo,
      homeTeam,
      awayTeam,
      homeScore: isFinal || isLive ? espnScore(home) : undefined,
      awayScore: isFinal || isLive ? espnScore(away) : undefined,
      matchStatus: isFinal ? "finished" : "scheduled",
      leagueLabel: league.label,
      matchClock: espnLiveClock("sets", event.status),
      homeRecord: espnRecord(home),
      awayRecord: espnRecord(away),
      broadcast: espnBroadcast(event.competitions?.[0]),
      kickoffAt: new Date(event.date),
      dedupeKey: `espn-volleyball-${league.code}-${event.id}`,
      venue,
      seriesLabel: league.label,
    });
  }

  return items;
}

export async function fetchEspnVolleyballData(): Promise<RawMatchItem[]> {
  const results = await Promise.all(LEAGUES.map(fetchLeague));
  return results.flat();
}
