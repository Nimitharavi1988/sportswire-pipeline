/**
 * Pulls match data for major domestic football leagues that our existing
 * football-data.org integration (footballData.ts) doesn't cover well —
 * BBC/Sky/ESPN's RSS feeds (rssFeeds.ts) skew heavily toward the Premier
 * League, leaving Bundesliga/Serie A/Ligue 1/MLS with almost no coverage
 * despite real audience reach.
 *
 * Same ESPN public scoreboard API as nflData.ts/mlbData.ts/nbaData.ts
 * (site.api.espn.com) — unofficial and undocumented, but no API key
 * required and confirmed working live (2026-09-16), including real venue
 * data (ESPN provides this for these leagues, unlike football-data.org on
 * our tier — see footballData.ts's RawMatchItem.venue comment).
 *
 * Same RawMatchItem shape as footballData.ts, reused directly.
 */
import type { RawMatchItem } from "./footballData";
import { espnBroadcast, espnLiveClock, espnRecord, espnScore, type EspnStatus } from "../scores/espnStatus";
import { espnFetch } from "../espnFetch";

// Indian Super League removed (2026-09-20, explicit request) — confirmed
// real audience breakdown is mostly USA with Sweden/Ireland second, India
// actually low despite this site's cricket-heavy coverage, so ISL was
// spending ingestion/commentary budget on a league with ~no relevance to
// who's actually reading. Frees the budget for the other four leagues,
// which map onto the real audience far better (MLS for the US directly,
// Bundesliga/Serie A/Ligue 1 for general European-football crossover).
// `days`: also fetch each of those days' own scoreboards (offsets from today,
// UTC). ESPN's default scoreboard is just the current matchday, which is all a
// weekly league needs, but international windows play a round every day or two
// and a Saturday match (England v Croatia, 2026-10-03) had no page until the
// morning it was played.
interface LeagueConfig {
  code: string;
  label: string;
  days?: { back: number; ahead: number };
  /** National-team boards list every match, down to Vanuatu v Fiji: keep a
   *  game only when one side is a nation the audience follows. */
  notableOnly?: boolean;
  /** ESPN names women's national teams like the men's ("England"); this
   *  keeps the two apart on our pages. */
  teamSuffix?: string;
}

// Nations whose games get a page on the international boards (either side).
// Lower-cased ESPN display names.
export const NOTABLE_NATIONS = new Set([
  "england", "france", "germany", "spain", "italy", "portugal", "netherlands", "belgium", "croatia", "scotland", "wales",
  "republic of ireland", "northern ireland", "sweden", "denmark", "norway", "switzerland", "austria", "poland", "türkiye", "turkey",
  "serbia", "ukraine", "czechia", "greece", "brazil", "argentina", "uruguay", "colombia", "ecuador", "chile", "peru", "paraguay",
  "venezuela", "united states", "mexico", "canada", "jamaica", "costa rica", "panama", "haiti", "honduras", "japan", "south korea",
  "australia", "iran", "saudi arabia", "qatar", "india", "morocco", "senegal", "nigeria", "egypt", "ghana", "ivory coast",
  "cameroon", "algeria", "tunisia", "south africa",
]);

export function isNotableMatch(homeTeam: string, awayTeam: string): boolean {
  return NOTABLE_NATIONS.has(homeTeam.toLowerCase()) || NOTABLE_NATIONS.has(awayTeam.toLowerCase());
}

const LEAGUES: LeagueConfig[] = [
  { code: "ger.1", label: "Bundesliga" },
  { code: "ita.1", label: "Serie A" },
  { code: "fra.1", label: "Ligue 1" },
  { code: "usa.1", label: "MLS" },
  // Spanish-audience leagues (2026-10-03): Liga MX, Argentina, Colombia and the
  // two continental cups, for the Spanish edition (and US Hispanic readers of the English one).
  { code: "mex.1", label: "Liga MX" },
  { code: "arg.1", label: "Liga Profesional Argentina" },
  { code: "col.1", label: "Liga BetPlay Colombia" },
  { code: "conmebol.libertadores", label: "Copa Libertadores", days: { back: 1, ahead: 2 } },
  { code: "concacaf.champions", label: "Concacaf Champions Cup", days: { back: 1, ahead: 2 } },
  // International break (2026-10-02: this weekend's football
  // is the Nations League — England v Croatia, Germany v Greece, Belgium v
  // France — and the site had no match pages for any of it). Football-data.org's
  // free tier has no Nations League. It is idle outside the windows, so it
  // costs nothing then.
  { code: "uefa.nations", label: "UEFA Nations League", days: { back: 1, ahead: 2 } },
  // Other national-team fixtures (2026-10-02, explicit request): men's and
  // women's friendlies and the CONCACAF Nations League. Checked live: the
  // 2026 qualifier boards (UEFA/CONMEBOL/CAF/AFC) and the Euro/Women's Euro
  // boards are empty in this window.
  { code: "fifa.friendly", label: "International Friendly", days: { back: 1, ahead: 2 }, notableOnly: true },
  { code: "fifa.friendly.w", label: "Women's International Friendly", days: { back: 1, ahead: 2 }, notableOnly: true, teamSuffix: " Women" },
  { code: "concacaf.nations.league", label: "CONCACAF Nations League", days: { back: 1, ahead: 2 }, notableOnly: true },
];

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
  address?: { city?: string; country?: string };
}

interface EspnEvent {
  id: string;
  date: string;
  status: EspnStatus;
  competitions: { competitors: EspnCompetitor[]; venue?: EspnVenue; broadcasts?: { names?: string[] }[] }[];
}

// YYYYMMDD (UTC) for a day `offset` days from `now`.
export function espnDay(now: Date, offset: number): string {
  return new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchLeague(league: LeagueConfig, date?: string): Promise<RawMatchItem[]> {
  const res = await espnFetch(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.code}/scoreboard${date ? `?dates=${date}` : ""}`
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
    // Only finished results and pre-game previews — an in-progress match
    // (state "in") would be a confusing partial snapshot by the time this
    // article is actually read. Same rule as nflData.ts.
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
      ? [venueInfo.fullName, venueInfo.address?.city, venueInfo.address?.country].filter(Boolean).join(", ")
      : undefined;

    if (league.notableOnly && !isNotableMatch(home.team.displayName, away.team.displayName)) continue;
    const homeTeam = home.team.displayName + (league.teamSuffix ?? "");
    const awayTeam = away.team.displayName + (league.teamSuffix ?? "");

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
      summary = `${homeTeam} played ${awayTeam} in the ${league.label}, finishing ${homeScore}-${awayScore}.`;

      const resultSentence =
        Number(homeScore) > Number(awayScore) ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : Number(awayScore) > Number(homeScore) ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The match ended in a ${homeScore}-${awayScore} draw.`;
      body = `${homeTeam} played ${awayTeam} in the ${league.label} on ${fullDateLabel}. ${resultSentence}`;
    } else {
      const kickoff = new Date(event.date);
      const dateLabel = kickoff.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const kickoffLabel = kickoff.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the ${league.label} on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the ${league.label}. Kickoff is ${kickoffLabel}.`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.espn.com/soccer/match/_/gameId/${event.id}`,
      sourceName: "ESPN Football",
      category: "football",
      publishedAt: new Date(event.date),
      homeCrestUrl: home.team.logo,
      awayCrestUrl: away.team.logo,
      homeTeam,
      awayTeam,
      homeScore: isFinal || isLive ? espnScore(home) : undefined,
      awayScore: isFinal || isLive ? espnScore(away) : undefined,
      matchStatus: isFinal ? "finished" : "scheduled",
      leagueLabel: league.label,
      matchClock: espnLiveClock("soccer", event.status),
      homeRecord: espnRecord(home),
      awayRecord: espnRecord(away),
      broadcast: espnBroadcast(event.competitions?.[0]),
      kickoffAt: new Date(event.date),
      // event.id is ESPN's own stable game identifier — same reasoning as
      // nflData.ts's dedupeKey.
      dedupeKey: `espn-soccer-${league.code}-${event.id}`,
      venue,
      // Real competition name for SportsEvent JSON-LD's organizer field
      // (article/[slug]/page.tsx) — deliberately NOT paired with a
      // seriesKey, since the /series/[seriesKey] grouping page is cricket-
      // specific infrastructure this doesn't need; organizer only reads
      // seriesLabel on its own.
      seriesLabel: league.label,
    });
  }

  return items;
}

export async function fetchDomesticFootballData(now: Date = new Date()): Promise<RawMatchItem[]> {
  const results = await Promise.all(
    LEAGUES.map(async (league) => {
      const calls = [fetchLeague(league)];
      if (league.days) {
        for (let offset = -league.days.back; offset <= league.days.ahead; offset++) calls.push(fetchLeague(league, espnDay(now, offset)));
      }
      // The same match can come back from several days' boards; its dedupeKey
      // is the same, so keep one.
      const seen = new Set<string>();
      return (await Promise.all(calls)).flat().filter((i) => (i.dedupeKey && seen.has(i.dedupeKey) ? false : (i.dedupeKey && seen.add(i.dedupeKey), true)));
    })
  );
  return results.flat();
}
