/**
 * Pulls match data from football-data.org's free tier — all 12 competitions
 * included in the free plan, both finished results and upcoming fixtures
 * (previews). Includes retry-with-backoff if the free tier's rate limit
 * (10 requests/minute) gets hit.
 *
 * Docs: https://www.football-data.org/documentation/quickstart
 */

import { fetchStandings, ordinal, type TeamStanding } from "./standings";
import { attachFootballVenues } from "./apiFootballVenue";

const BASE_URL = "https://api.football-data.org/v4";

const COMPETITIONS = [
  "PL", "ELC", "BL1", "DED", "BSA", "PD", "FL1", "SA", "PPL", "CL", "EC", "WC",
];

// Stay well under the free tier's 10 requests/minute limit.
const REQUEST_DELAY_MS = 7000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function categoryFor(code: string): string {
  if (code === "WC") return "football/world-cup";
  if (code === "EC") return "football/euros";
  return "football";
}

function dateRange() {
  const today = new Date();
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(today.getDate() - 14);
  const twoWeeksAhead = new Date(today);
  twoWeeksAhead.setDate(today.getDate() + 14);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    dateFromPast: fmt(twoWeeksAgo),
    dateToPast: fmt(today),
    dateFromFuture: fmt(today),
    dateToFuture: fmt(twoWeeksAhead),
  };
}

export interface RawMatchItem {
  title: string;
  // The feed's own headline when `title` was translated to English (foreignHeadlines.ts). The source text is
  // in the feed's language, so "is this text about the headline" (groundingRules.ts) must compare against
  // this one: an English headline shares only names with Spanish text and failed the check (2026-10-15).
  originalTitle?: string;
  summary: string;
  body?: string;
  sourceSnippet?: string;
  sourceUrl: string;
  sourceName: string;
  category: string;
  publishedAt: Date;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  // A real, story-specific photo carried directly in the publisher's own RSS
  // feed (media:thumbnail / media:content) — see rssFeeds.ts. Takes priority
  // over both the Wikimedia person-photo lookup and the generic stock-photo
  // fallback in runIngest.ts, since it's the most specific image available.
  heroImageUrl?: string;
  heroImageCredit?: string;
  // Stable per-event identifier, for sources where the title can legitimately
  // change across runs (e.g. a preview's embedded kickoff date, when the
  // upstream API revises it) — see dedupe.ts's computeStableDedupeHash.
  dedupeKey?: string;
  // Set when the source already knows exactly which person an item is
  // about (e.g. playerNewsFeeds.ts, which fetches per-player by name) —
  // lets runIngest.ts look up that person's real Wikimedia photo directly,
  // instead of only being reachable via Gemini's personNames extraction,
  // which never runs at all when the commentary budget is exhausted for
  // that item. Real gap this closes: budget-starved player-news items were
  // shipping with no image whatsoever, not even though we already knew
  // exactly who the photo should be of.
  knownPersonName?: string;
  // Structured match data — set only by footballData.ts/cricketData.ts/
  // nflData.ts, which already have all of this before flattening it into
  // the title/body prose above. Persisted on Article so /scores and the
  // multi-sport MatchTicker can query real fields instead of regex-parsing
  // the title.
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  matchStatus?: "scheduled" | "finished";
  kickoffAt?: Date;
  // Cricket only — a short per-team score line (e.g. "221/3 (4.1)"), since
  // a multi-innings cricket score doesn't fit the single homeScore/
  // awayScore integer football/NFL use. See cricketData.ts's
  // extractTeamScoreLine.
  homeScoreText?: string;
  awayScoreText?: string;
  // Cricket only, for now — groups every article (match-data AND editorial
  // RSS/player-news alike) belonging to the same bilateral international
  // series (e.g. "India vs Afghanistan, T20I") under one key, so /series/
  // [seriesKey] can list them together instead of the site only ever
  // showing a flat chronological feed. See cricketSeries.ts.
  seriesKey?: string;
  seriesLabel?: string;
  // Cricket (CricketData.org's match.venue) and NFL (ESPN's venue field) —
  // football-data.org doesn't provide real venue data on our tier, so
  // SportsEvent JSON-LD's "location" (see article/[slug]/page.tsx) stays
  // unset for football. Google's Events structured-data report flagged
  // this as a critical missing field, and fabricating a venue isn't an
  // option.
  venue?: string;
  // Standard scoreboard fields (see Article's schema comments and
  // src/lib/scores/). All optional: a source sets what it really has and
  // leaves the rest unset — never a placeholder. matchClock/matchNote use
  // null (not undefined) to clear a value, e.g. the live clock at the final.
  leagueLabel?: string;
  matchClock?: string | null;
  matchNote?: string | null;
  homeRecord?: string;
  awayRecord?: string;
  broadcast?: string;
}

function standingsContext(
  homeTeam: string,
  awayTeam: string,
  homeTeamId: number | undefined,
  awayTeamId: number | undefined,
  standings: Map<number, TeamStanding>
): string {
  const home = homeTeamId ? standings.get(homeTeamId) : undefined;
  const away = awayTeamId ? standings.get(awayTeamId) : undefined;
  if (!home || !away) return "";

  return ` ${homeTeam} sit ${ordinal(home.position)} in the table with ${home.points} points from ${home.playedGames} games (${home.won}W ${home.draw}D ${home.lost}L), while ${awayTeam} are ${ordinal(away.position)} with ${away.points} points from ${away.playedGames} games (${away.won}W ${away.draw}D ${away.lost}L).`;
}

async function fetchCompetitionMatches(
  apiKey: string,
  competitionCode: string,
  status: "FINISHED" | "SCHEDULED",
  dateFrom: string,
  dateTo: string,
  standings: Map<number, TeamStanding>,
  attempt = 1
): Promise<RawMatchItem[]> {
  const res = await fetch(
    `${BASE_URL}/competitions/${competitionCode}/matches?status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    { headers: { "X-Auth-Token": apiKey } }
  );

  if (res.status === 429 && attempt < 3) {
    const backoffMs = 20000 * attempt; // 20s, then 40s
    console.warn(`Rate limited on ${competitionCode} (${status}), waiting ${backoffMs / 1000}s before retry ${attempt + 1}/3`);
    await sleep(backoffMs);
    return fetchCompetitionMatches(apiKey, competitionCode, status, dateFrom, dateTo, standings, attempt + 1);
  }

  if (!res.ok) {
    console.error(`football-data.org fetch failed for ${competitionCode} (${status}): ${res.status}`);
    return [];
  }

  const data = await res.json();
  const items: RawMatchItem[] = [];

  for (const match of data.matches ?? []) {
    const homeTeam = match.homeTeam?.name ?? "Home";
    const awayTeam = match.awayTeam?.name ?? "Away";
    const competitionName = match.competition?.name ?? "match";
    const homeCrestUrl = match.homeTeam?.crest || undefined;
    const awayCrestUrl = match.awayTeam?.crest || undefined;
    const context = standingsContext(homeTeam, awayTeam, match.homeTeam?.id, match.awayTeam?.id, standings);

    let title: string;
    let summary: string;
    let body: string;

    if (status === "FINISHED") {
      const homeScore = match.score?.fullTime?.home;
      const awayScore = match.score?.fullTime?.away;
      const fullDateLabel = new Date(match.utcDate).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      });

      title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
      summary = `${homeTeam} played ${awayTeam} in the ${competitionName}, finishing ${homeScore}-${awayScore}.`;

      const resultSentence =
        homeScore > awayScore ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : awayScore > homeScore ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The match ended in a ${homeScore}-${awayScore} draw.`;
      body = `${homeTeam} played ${awayTeam} in the ${competitionName} on ${fullDateLabel}. ${resultSentence}${context}`;
    } else {
      const kickoff = new Date(match.utcDate);
      const dateLabel = kickoff.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const kickoffLabel = kickoff.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the ${competitionName} on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the ${competitionName}. Kickoff is ${kickoffLabel}.${context}`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.football-data.org/matches/${match.id}`,
      sourceName: "football-data.org",
      leagueLabel: match.competition?.name,
      category: categoryFor(competitionCode),
      publishedAt: new Date(match.utcDate),
      homeCrestUrl,
      awayCrestUrl,
      homeTeam,
      awayTeam,
      homeScore: status === "FINISHED" ? match.score?.fullTime?.home : undefined,
      awayScore: status === "FINISHED" ? match.score?.fullTime?.away : undefined,
      matchStatus: status === "FINISHED" ? "finished" : "scheduled",
      kickoffAt: new Date(match.utcDate),
      // Stable per-match id, not title-based — without this, the SAME
      // match hashed differently as "Preview: X vs Y" (scheduled) and
      // "X 2-1 Y" (finished), so finishing a match created a brand-new
      // duplicate article instead of updating the preview in place. The
      // preview then sat stuck forever at "scheduled" with no score,
      // while a separate, correct result article existed alongside it —
      // exactly the kind of duplicate-content problem the www/non-www
      // canonical work earlier in this project was fighting, just
      // self-inflicted this time. See runIngest.ts's duplicate-refresh
      // block, which now needs this key to find the existing row at all.
      dedupeKey: `football-data-${match.id}`,
    });
  }

  return items;
}

export async function fetchFootballData(): Promise<RawMatchItem[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    console.warn("FOOTBALL_DATA_API_KEY not set — skipping football-data.org ingestion");
    return [];
  }

  const { dateFromPast, dateToPast, dateFromFuture, dateToFuture } = dateRange();
  const items: RawMatchItem[] = [];

  for (const competitionCode of COMPETITIONS) {
    // Real league-table context (position, points, form) — not every
    // competition/stage has one (e.g. knockout-only rounds), in which case
    // this comes back empty and match articles just skip the extra context.
    const standings = await fetchStandings(apiKey, competitionCode);
    await sleep(REQUEST_DELAY_MS);

    const finished = await fetchCompetitionMatches(
      apiKey, competitionCode, "FINISHED", dateFromPast, dateToPast, standings
    );
    items.push(...finished);
    await sleep(REQUEST_DELAY_MS);

    const scheduled = await fetchCompetitionMatches(
      apiKey, competitionCode, "SCHEDULED", dateFromFuture, dateToFuture, standings
    );
    items.push(...scheduled);
    await sleep(REQUEST_DELAY_MS);
  }

  // Best-effort real venue data (see apiFootballVenue.ts) — football-data.org
  // itself doesn't provide this on our tier. Self-throttled to roughly
  // hourly, so most runs are a no-op here.
  await attachFootballVenues(items);

  return items;
}