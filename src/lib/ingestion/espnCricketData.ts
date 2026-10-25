/**
 * Cricket from ESPN (Cricinfo's scoreboard, free, no key): every match in
 * progress or about to start across international and domestic cricket,
 * with live scores. Added 2026-09-26 because the free CricketData tier
 * returned only English county matches for days — no internationals (e.g.
 * the Asian Games) at all. CricketData stays; where both have the same
 * match, the first to store it owns it (runIngest.ts, via matchKey), so no
 * match shows twice.
 *
 * Source: site.api.espn.com/apis/personalized/v2/scoreboard/header
 * ?sport=cricket — current events grouped by league. Shape checked live
 * 2026-09-26: event.status "pre"|"in"|"post", fullStatus.{longSummary,
 * dayNumber}, competitors[].{homeAway, displayName, score, logo}.
 */
import type { RawMatchItem } from "./footballData";
import { espnFetch } from "../espnFetch";

const HEADER_URL = "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=us&lang=en";

interface EspnCricketCompetitor {
  homeAway?: "home" | "away";
  displayName: string;
  score?: string;
  logo?: string;
}

export interface EspnCricketEvent {
  id: string;
  date: string;
  endDate?: string;
  status: string;
  summary?: string;
  location?: string;
  link?: string;
  fullStatus?: { longSummary?: string; summary?: string; dayNumber?: number; type?: { detail?: string } };
  competitors: EspnCricketCompetitor[];
}

// A result line means the match is over even when ESPN still lists it as
// "in" for a while (seen live: "No result" on an "in" event).
const RESULT = /\b(won by|won the match|match drawn|drawn|tied|no result|abandoned|cancelled)\b/i;
// ESPN flips an event to "in" at its scheduled start even when play hasn't
// begun ("Match scheduled to begin at 10:00 local time", seen 2026-09-26).
const NOT_BEGUN = /\b(scheduled to begin|yet to begin|start delayed)\b/i;
// Placeholder for a knockout slot not decided yet — not a real fixture.
const TBA = /^(tba|tbc|tbd)$/i;

function isMultiDay(event: EspnCricketEvent): boolean {
  return Boolean(event.endDate) && Date.parse(event.endDate!) - Date.parse(event.date) > 24 * 60 * 60 * 1000;
}

// One ESPN event -> the standard match item (pure, unit-tested).
export function espnCricketEventToItem(event: EspnCricketEvent, leagueName: string): RawMatchItem | null {
  const home = event.competitors.find((c) => c.homeAway === "home") ?? event.competitors[0];
  const away = event.competitors.find((c) => c.homeAway === "away") ?? event.competitors[1];
  if (!home || !away || home === away) return null;
  if (TBA.test(home.displayName.trim()) || TBA.test(away.displayName.trim())) return null;
  if (event.status !== "pre" && event.status !== "in" && event.status !== "post") return null;

  const statusLine = (event.fullStatus?.longSummary || event.summary || "").trim();
  const finished = event.status === "post" || RESULT.test(statusLine);
  const noScores = !home.score?.trim() && !away.score?.trim();
  const started = event.status !== "pre" && !(NOT_BEGUN.test(statusLine) && noScores);
  // "Day 2: Stumps" for a multi-day match, matching CricketData's status
  // lines, so the scoreboard's stumps/day handling reads both the same way.
  const day = event.fullStatus?.dayNumber;
  // Day prefix only where it means something: day 2 onwards, or stumps.
  const showDay = isMultiDay(event) && day && (day >= 2 || /stumps/i.test(statusLine)) && !/^day \d/i.test(statusLine);
  // Kept for a delayed start too, so readers see why nothing's happening.
  const note = event.status !== "pre" && statusLine ? (showDay ? `Day ${day}: ${statusLine}` : statusLine) : undefined;
  const start = new Date(event.date);
  const dateLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const homeTeam = home.displayName;
  const awayTeam = away.displayName;
  const scoreText = (c: EspnCricketCompetitor) => (c.score?.trim() ? c.score.trim() : undefined);

  return {
    // Same title shape as CricketData ("X vs Y, <competition>"): it never
    // encodes the score, so it doesn't change as the match goes on.
    title: `${homeTeam} vs ${awayTeam}, ${leagueName}`,
    summary: finished && statusLine ? `${statusLine}.` : `${homeTeam} face ${awayTeam} in the ${leagueName} on ${dateLabel}.`,
    body: [
      `${homeTeam} ${finished ? "played" : "face"} ${awayTeam} in the ${leagueName}${event.location ? ` at ${event.location}` : ""}.`,
      scoreText(home) || scoreText(away) ? `Scores: ${homeTeam} ${scoreText(home) ?? "yet to bat"}, ${awayTeam} ${scoreText(away) ?? "yet to bat"}.` : "",
      note ? `${note}.` : "",
    ].filter(Boolean).join(" "),
    sourceUrl: event.link ?? `https://www.espncricinfo.com/`,
    sourceName: "ESPN Cricket",
    category: "cricket",
    publishedAt: start,
    // "" when ESPN has no logo for the team.
    homeCrestUrl: home.logo || undefined,
    awayCrestUrl: away.logo || undefined,
    homeTeam,
    awayTeam,
    homeScoreText: started ? scoreText(home) : undefined,
    awayScoreText: started ? scoreText(away) : undefined,
    matchStatus: finished ? "finished" : "scheduled",
    leagueLabel: leagueName,
    matchNote: note ?? null,
    kickoffAt: start,
    venue: event.location,
    dedupeKey: `espn-cricket-${event.id}`,
  };
}

// The undated header lists only what's in progress or about to start, so a
// series starting in a few days (e.g. India v West Indies ODIs, 2026-09-26)
// never reached the site. Ingestion also asks for each of the next
// `daysAhead` days (`dates=YYYYMMDD`, checked live) to store upcoming
// fixtures; the live refresh only needs the undated list. Multi-day matches
// appear under every day they span, so events are kept once by id — the
// undated response first, as it carries the freshest live state.
export const UPCOMING_DAYS = 7;

function dayParam(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchHeaderEvents(url: string): Promise<{ event: EspnCricketEvent; leagueName: string }[]> {
  const res = await espnFetch(url);
  if (!res.ok) throw new Error(`ESPN cricket scoreboard fetch failed: ${res.status} (${url})`);
  const data = await res.json();
  const out: { event: EspnCricketEvent; leagueName: string }[] = [];
  for (const sport of data.sports ?? []) {
    for (const league of sport.leagues ?? []) {
      for (const event of (league.events ?? []) as EspnCricketEvent[]) out.push({ event, leagueName: league.name ?? "Cricket" });
    }
  }
  return out;
}

// ESPN lists a logo URL for teams it has no image for — 27 of 47 distinct
// cricket logos returned 404 when checked 2026-09-30, mostly women's, A and
// youth sides. A dead URL stored with the match draws a broken image until the
// page hydrates and swaps in initials, so each distinct logo is checked once
// and a dead one is not stored (the match then shows initials straight away,
// and the story can use its stock photo instead of a crest that isn't there).
// Only a definite 404/410 counts as dead: a timeout or error keeps the URL.
export function withoutDeadLogos<T extends { homeCrestUrl?: string; awayCrestUrl?: string }>(items: T[], dead: Set<string>): T[] {
  return items.map((i) => ({
    ...i,
    homeCrestUrl: i.homeCrestUrl && dead.has(i.homeCrestUrl) ? undefined : i.homeCrestUrl,
    awayCrestUrl: i.awayCrestUrl && dead.has(i.awayCrestUrl) ? undefined : i.awayCrestUrl,
  }));
}

async function findDeadLogos(urls: string[]): Promise<Set<string>> {
  const dead = new Set<string>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
        if (res.status === 404 || res.status === 410) dead.add(url);
      } catch {
        // Unreachable right now is not the same as missing — keep it.
      }
    })
  );
  return dead;
}

export async function fetchEspnCricketData(daysAhead = 0, now: Date = new Date()): Promise<RawMatchItem[]> {
  const urls = [HEADER_URL];
  for (let d = 1; d <= daysAhead; d++) urls.push(`${HEADER_URL}&dates=${dayParam(new Date(now.getTime() + d * 24 * 60 * 60 * 1000))}`);
  const results = await Promise.allSettled(urls.map(fetchHeaderEvents));
  const seen = new Set<string>();
  const items: RawMatchItem[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(r.reason instanceof Error ? r.reason.message : r.reason);
      continue;
    }
    for (const { event, leagueName } of r.value) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const item = espnCricketEventToItem(event, leagueName);
      if (item) items.push(item);
    }
  }
  // Full ingestion only (it looks ahead). The 2-minute live refresh just
  // updates scores of matches already stored, so it skips the extra requests.
  if (daysAhead > 0) {
    const urls = [...new Set(items.flatMap((i) => [i.homeCrestUrl, i.awayCrestUrl]).filter((u): u is string => Boolean(u)))];
    return withoutDeadLogos(items, await findDeadLogos(urls));
  }
  return items;
}
