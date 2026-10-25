/**
 * Pulls current/recent cricket matches from CricketData.org's free tier
 * (formerly CricAPI). Covers international matches, IPL, and other major
 * leagues currently in progress or recently finished.
 *
 * Docs: https://cricketdata.org/
 * Free tier: 100 requests/day.
 */
import { db } from "@/db";
import { vertical, source } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { RawMatchItem } from "./footballData";
import { cricketLeagueLabel, cricketTeamScore } from "../scores/cricketLabels";
import { BUSY_DAY_GENERAL_POLL_MS, budgetAllows, isTrackedMatchDay, trackedInPlay, withHits } from "../scores/trackedCricket";
import { fetchCommonsFile } from "./wikimediaImages";
import { matchCountry, isInternationalFormat, type CricketCountry } from "./cricketCountries";
import { deriveSeriesKey } from "./cricketSeries";

const BASE_URL = "https://api.cricapi.com/v1";
const SOURCE_NAME = "CricketData.org";

// Real national flags, reusing the same trusted, license-verified Wikimedia
// pipeline as player photos, for genuinely international matches — team
// crest data doesn't exist in this API tier the way it does for football, so
// every cricket article was previously falling back to a generic,
// frequently-repeated stock photo regardless of who was actually playing.
// Cached per country within a single ingestion run since the same countries
// (India, Australia, England...) recur across many matches in one run.
const flagCache = new Map<string, Awaited<ReturnType<typeof fetchCommonsFile>>>();

async function fetchFlag(country: CricketCountry) {
  if (!flagCache.has(country.flagFile)) {
    flagCache.set(country.flagFile, await fetchCommonsFile(country.flagFile));
  }
  return flagCache.get(country.flagFile)!;
}

// "TeamA vs TeamB, 12th Match, ..." — the consistent shape of `match.name`
// across every sample seen from this API, both franchise and international.
function extractTeams(matchName: string): [string, string] | null {
  const m = matchName.match(/^(.+?)\s+vs\s+(.+?),/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

// match.score entries are labeled by the API as "{Team Name} Inning {N}"
// (confirmed directly from real responses, e.g. "St Kitts and Nevis
// Patriots Inning 1") — matching by substring against the team name
// extracts that team's own score line, e.g. "71/6 (14.3)", for a clean
// "TeamA score vs TeamB score" scoreboard display (matching what a Google
// live-score card shows) instead of only the prose status text. Takes the
// LAST matching entry so a team's most recent innings wins for a Test
// match with more than one innings per side.
export function extractTeamScoreLine(score: unknown, teamName: string): string | undefined {
  if (!Array.isArray(score)) return undefined;
  const matches = score.filter(
    (s: any) => typeof s?.inning === "string" && s.inning.toLowerCase().includes(teamName.toLowerCase())
  );
  if (matches.length === 0) return undefined;
  const latest = matches[matches.length - 1];
  return `${latest.r ?? "?"}/${latest.w ?? "?"} (${latest.o ?? "?"})`;
}

// This API's currentMatches endpoint doesn't expose a clean started/ended
// boolean (or if it does, it wasn't available to verify directly — network
// access to cricapi.com is blocked from the environment this was built in),
// so status is inferred from match.status's free text instead. Genuinely
// finished matches always end with a definitive result phrase; anything
// else (still in progress, or not yet started) is left as "scheduled" —
// imperfect (an in-progress match isn't really "scheduled"), but /scores
// only needs to distinguish "has a final result to show" from "doesn't"
// for cricket, since a live in-play state is handled separately by the
// CricketData.org widget embed, not this ingested data.
export function inferCricketMatchStatus(status: string | undefined): "scheduled" | "finished" {
  if (status && /\bwon by\b|\bdrawn\b|\bmatch tied\b|\bno result\b/i.test(status)) return "finished";
  return "scheduled";
}

// CricketData.org DOES return a real per-team logo directly on the match
// object (`teamInfo[].img`) — this was missed originally (not documented
// clearly, and the sandbox used to investigate it was network-blocked from
// the live API for a while). Confirmed live: most teams get a real,
// team-specific CDN image; a team with no logo on file gets this exact
// generic placeholder icon instead of a missing/null field, so it has to be
// filtered out explicitly rather than just checking truthiness.
export const GENERIC_PLACEHOLDER_IMG = "https://h.cricapi.com/img/icon512.png";

export function isRealLogo(img: unknown): img is string {
  return typeof img === "string" && img.length > 0 && img !== GENERIC_PLACEHOLDER_IMG;
}

// Real logos straight from the source take priority — no extra API call,
// no ambiguity, and (unlike the flag fallback below) covers domestic
// franchise/league teams too, not just national sides. Requires BOTH teams
// to have a real logo, never just one — mixing a real team badge with a
// missing/placeholder crest would look broken, not just incomplete.
export function extractTeamLogos(match: any): { homeCrestUrl?: string; awayCrestUrl?: string } {
  const teamInfo = Array.isArray(match.teamInfo) ? match.teamInfo : [];
  const home = teamInfo[0]?.img;
  const away = teamInfo[1]?.img;
  if (isRealLogo(home) && isRealLogo(away)) {
    return { homeCrestUrl: home, awayCrestUrl: away };
  }
  return {};
}

// Fallback for when CricketData.org has no real logo for one or both teams
// (common for national sides, less common for well-known franchises) — only
// sets real flags when the match is unambiguously international (by
// standard cricket format terminology, not by team name alone) AND both team
// names resolve exactly to a recognized national side — see
// cricketCountries.ts for why this two-part check matters.
export async function fetchInternationalFlags(
  matchName: string
): Promise<{ homeCrestUrl?: string; awayCrestUrl?: string }> {
  if (!isInternationalFormat(matchName)) return {};

  const teams = extractTeams(matchName);
  if (!teams) return {};

  const [homeCountry, awayCountry] = teams.map(matchCountry);
  if (!homeCountry || !awayCountry) return {};

  const [homeFlag, awayFlag] = await Promise.all([fetchFlag(homeCountry), fetchFlag(awayCountry)]);
  if (!homeFlag || !awayFlag) return {};

  return { homeCrestUrl: homeFlag.url, awayCrestUrl: awayFlag.url };
}

// A single ingest run makes exactly one call here, so the real risk to the
// 100 req/day free-tier cap is polling frequency, not per-run volume.
// Matched to the cron's own 15-min cadence (cron-job.org) — 96 calls/day,
// leaving a small 4-call/day buffer for manual/test runs. Tightened from a
// 20-min floor (72 calls/day) to get the freshest possible "live" cricket
// data the free tier allows, per explicit user request — staying on free
// rather than paying for CricketData.org's per-minute-capable paid tiers.
// One CricketData match object (from currentMatches or match_info — same
// shape) -> RawMatchItem. null for an entry without a name/id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cricketItemFrom(match: any): Promise<RawMatchItem | null> {
  if (!match?.name || !match?.id) return null;

  const title = match.name;

  let scoreText = "";
  if (Array.isArray(match.score) && match.score.length > 0) {
    scoreText = match.score
      .map((s: any) => `${s.inning ?? ""}: ${s.r ?? "?"}/${s.w ?? "?"} (${s.o ?? "?"} ov)`)
      .join(", ");
  }

  const summary = scoreText
    ? `${match.status ?? "Match update"}. ${scoreText}`
    : match.status ?? `${title} — match details.`;

  const inningsLines = Array.isArray(match.score)
    ? match.score.map((s: any) => `${s.inning ?? "Innings"}: ${s.r ?? "?"}/${s.w ?? "?"} in ${s.o ?? "?"} overs.`)
    : [];
  const bodyParts = [
    `${title}.`,
    match.status ? `${match.status}.` : null,
    match.venue ? `Venue: ${match.venue}.` : null,
    ...inningsLines,
  ].filter(Boolean);
  const body = bodyParts.join(" ");

  const crests = extractTeamLogos(match);
  if (!crests.homeCrestUrl) {
    Object.assign(crests, await fetchInternationalFlags(title));
  }

  const teams = extractTeams(title);
  // Bilateral international series only (Test/ODI/T20I) — franchise
  // tournaments (IPL etc.) aren't team-pair-shaped, so deriveSeriesKey
  // returns null for them and the match simply isn't grouped.
  const series = teams && isInternationalFormat(title) ? deriveSeriesKey(teams[0], teams[1], title) : null;
  const kickoffAt = match.dateTimeGMT ? new Date(match.dateTimeGMT) : new Date();

  return {
    title,
    summary,
    body,
    sourceUrl: `https://cricketdata.org/`,
    sourceName: "CricketData.org",
    category: "cricket",
    publishedAt: match.dateTimeGMT ? new Date(match.dateTimeGMT) : new Date(),
    ...crests,
    homeTeam: teams?.[0],
    awayTeam: teams?.[1],
    seriesKey: series?.key,
    seriesLabel: series?.label,
    // No single homeScore/awayScore here — a multi-innings cricket score
    // doesn't fit two plain integers the way football/NFL's single score
    // does. homeScoreText/awayScoreText (below) carry a short per-team
    // score line instead, for a "TeamA score vs TeamB score" scoreboard
    // display; matchStatus + the existing summary/body text carry the
    // fuller result/status; see inferCricketMatchStatus above.
    matchStatus: inferCricketMatchStatus(match.status),
    kickoffAt: match.dateTimeGMT ? new Date(match.dateTimeGMT) : new Date(),
    // cricketTeamScore, not extractTeamScoreLine: CricketData labels one
    // side's innings with both team names, which the old substring
    // match attributed to both teams (see cricketLabels.ts).
    homeScoreText: teams ? cricketTeamScore(match.score, teams[0], teams[1]) : undefined,
    awayScoreText: teams ? cricketTeamScore(match.score, teams[1], teams[0]) : undefined,
    venue: match.venue || undefined,
    leagueLabel: cricketLeagueLabel(title) ?? series?.label,
    // CricketData's own status line ("India need 93 runs in 70 balls",
    // "India won by 25 runs") once play has started. Before that it's
    // "Match starts at ..." — not worth a line on a score card.
    matchNote: kickoffAt.getTime() <= Date.now() && match.status ? String(match.status) : null,
  };
}

// General feed cadence. 96 calls/day at 15 min — nearly the whole 100/day
// free plan — so on a day a tracked international is played it drops to
// every 2 hours to leave room for that match (see scores/trackedCricket.ts).
const MIN_POLL_INTERVAL_MS = 15 * 60 * 1000;

async function cricketSource() {
  const [verticalRow] = await db.select().from(vertical).where(eq(vertical.name, "sports")).limit(1);
  const [sourceRow] = verticalRow
    ? await db.select().from(source).where(and(eq(source.verticalId, verticalRow.id), eq(source.name, SOURCE_NAME))).limit(1)
    : [null];
  return { verticalRow: verticalRow ?? null, sourceRow: sourceRow ?? null };
}

// Every CricketData call goes through here: skips once CricketData's own
// hitsToday (stored on the Source row) reaches the safety limit, and
// records the new count after each call. Returns the parsed JSON, or null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cricketDataCall(path: string, markPolled: boolean): Promise<any | null> {
  const apiKey = process.env.CRICKETDATA_API_KEY;
  if (!apiKey) {
    console.warn("CRICKETDATA_API_KEY not set — skipping CricketData.org");
    return null;
  }
  const now = new Date();
  const { verticalRow, sourceRow } = await cricketSource();
  if (sourceRow && !budgetAllows(sourceRow.config, now)) {
    console.log(`CricketData.org daily budget reached (${JSON.stringify(sourceRow.config)}) — skipping ${path.split("?")[0]}`);
    return null;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`);
  } catch (err) {
    // A network-level failure here (DNS, timeout, connection reset) must
    // not throw — this runs inside a Promise.all alongside other sources,
    // so an uncaught rejection would take down the entire ingest run.
    console.error(`CricketData.org ${path.split("?")[0]} failed (network error):`, err);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = res.ok ? await res.json().catch(() => null) : null;

  // Record the attempt regardless of outcome — a failed request still
  // consumes a slot against the daily quota.
  if (verticalRow) {
    const config = withHits(sourceRow?.config, data?.info, now);
    if (sourceRow) {
      await db.update(source).set({ config, ...(markPolled ? { lastPolledAt: now } : {}) }).where(eq(source.id, sourceRow.id));
    } else {
      await db.insert(source).values({
        id: createId(), verticalId: verticalRow.id, name: SOURCE_NAME, type: "api", config, lastPolledAt: markPolled ? now : null,
      });
    }
  }

  if (!res.ok) {
    console.error(`CricketData.org ${path.split("?")[0]} failed: ${res.status}`);
    return null;
  }
  return data;
}

// One tracked match by CricketData id (see scores/trackedCricket.ts).
export async function fetchTrackedCricketMatch(id: string): Promise<RawMatchItem | null> {
  const data = await cricketDataCall(`match_info?id=${encodeURIComponent(id)}`, false);
  return data?.data ? cricketItemFrom(data.data) : null;
}

export async function fetchCricketData(): Promise<RawMatchItem[]> {
  const now = new Date();
  const items: RawMatchItem[] = [];

  // General feed (currentMatches), throttled — slower on tracked-match days.
  const interval = isTrackedMatchDay(now) ? BUSY_DAY_GENERAL_POLL_MS : MIN_POLL_INTERVAL_MS;
  const { sourceRow } = await cricketSource();
  if (sourceRow?.lastPolledAt && now.getTime() - sourceRow.lastPolledAt.getTime() < interval) {
    const nextOkAt = new Date(sourceRow.lastPolledAt.getTime() + interval);
    console.log(
      `CricketData.org currentMatches polled recently (last: ${sourceRow.lastPolledAt.toISOString()}) — skipping until ${nextOkAt.toISOString()} to conserve the 100 req/day free-tier limit`
    );
  } else {
    const data = await cricketDataCall("currentMatches?offset=0", true);
    for (const match of data?.data ?? []) {
      const item = await cricketItemFrom(match);
      if (item) items.push(item);
    }
  }

  // Tracked internationals the general feed doesn't carry.
  for (const tracked of trackedInPlay(now)) {
    if (items.some((i) => i.title === tracked.name)) continue;
    const item = await fetchTrackedCricketMatch(tracked.id);
    if (item) items.push(item);
  }

  return items;
}
