/**
 * Pulls volleyball match data from API-Sports.io's volleyball API
 * (v1.volleyball.api-sports.io), the same account/key as
 * apiFootballVenue.ts (API_FOOTBALL_KEY — one key works across every
 * api-sports.io sport). Confirmed live (2026-09-16): date-based queries
 * work on the free tier (season-history queries don't, same rule as
 * football), and this sub-API has its own independent 100 req/day quota,
 * separate from the football one.
 *
 * Self-throttled the same way as apiFootballVenue.ts / cricketData.ts —
 * a persistent Source.lastPolledAt row, since each ingestion run is a
 * fresh process (no in-memory state survives between runs).
 *
 * New sport category "volleyball". No real venue field confirmed in this
 * API's /games response, so RawMatchItem.venue is left unset here rather
 * than guessed at.
 */
import { createHash } from "node:crypto";
import { db } from "@/db";
import { vertical, source } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { RawMatchItem } from "./footballData";

const SOURCE_NAME = "API-Volleyball";
const MIN_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — same conservatism as apiFootballVenue.ts

// API-Sports.io serves a generic placeholder image (not a 404, not null —
// a real 200 response) for teams without a real crest on file, confirmed
// live (2026-09-16): two completely different teams (Atom-Kursk W,
// Zabaikalka Chita W — different numeric team IDs, so different URLs)
// returned byte-identical images, MD5 a3208b617675b595f3d1a11c7d6642fb.
// hasRealImage() (autoApprove.ts) treats any homeCrestUrl as real, so this
// placeholder was silently passing as a genuine image on every smaller/
// regional team that lacks real crest art — reads as "no images" since
// every such team shows the identical generic blank badge. Checked here at
// ingestion time so a placeholder crest is treated as no crest at all,
// falling through to the Pexels stock-photo fallback (stockImages.ts)
// instead, same as any other article with no real image.
const PLACEHOLDER_CREST_HASH = "a3208b617675b595f3d1a11c7d6642fb";

async function isPlaceholderCrest(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    return createHash("md5").update(buffer).digest("hex") === PLACEHOLDER_CREST_HASH;
  } catch {
    // A failed check isn't evidence either way — treat the crest as real
    // rather than discarding a possibly-genuine image over a network blip.
    return false;
  }
}

// Resolves real-vs-placeholder for every crest URL in one batch, deduping
// identical URLs (the same team can appear in multiple games within a
// single run) so each distinct URL is only fetched once regardless of how
// many games reference it.
async function resolvePlaceholderCrests(urls: (string | undefined)[]): Promise<Set<string>> {
  const unique = [...new Set(urls.filter((u): u is string => Boolean(u)))];
  const results = await Promise.all(unique.map(async (url) => [url, await isPlaceholderCrest(url)] as const));
  return new Set(results.filter(([, isPlaceholder]) => isPlaceholder).map(([url]) => url));
}

interface VolleyballTeam {
  id: number;
  name: string;
  logo?: string;
}

interface VolleyballGame {
  id: number;
  date: string;
  status: { long: string; short: string };
  league: { name: string };
  teams: { home: VolleyballTeam; away: VolleyballTeam };
  scores: { home: number | null; away: number | null };
}

export async function fetchVolleyballData(): Promise<RawMatchItem[]> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return [];

  const [verticalRow] = await db.select().from(vertical).where(eq(vertical.name, "sports")).limit(1);
  const [sourceRow] = verticalRow
    ? await db.select().from(source).where(and(eq(source.verticalId, verticalRow.id), eq(source.name, SOURCE_NAME))).limit(1)
    : [null];

  if (sourceRow?.lastPolledAt && Date.now() - sourceRow.lastPolledAt.getTime() < MIN_POLL_INTERVAL_MS) {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`https://v1.volleyball.api-sports.io/games?date=${today}`, {
    headers: { "x-apisports-key": apiKey },
  }).catch((err) => {
    console.error("API-Volleyball fetch failed:", err);
    return null;
  });

  if (verticalRow) {
    if (sourceRow) {
      await db.update(source).set({ lastPolledAt: new Date() }).where(eq(source.id, sourceRow.id));
    } else {
      await db.insert(source).values({
        id: createId(), verticalId: verticalRow.id, name: SOURCE_NAME, type: "api", config: {}, lastPolledAt: new Date(),
      });
    }
  }

  if (!res || !res.ok) {
    if (res) console.error(`API-Volleyball fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const items: RawMatchItem[] = [];

  for (const game of (data.response ?? []) as VolleyballGame[]) {
    const finished = game.status?.short === "FT";
    const scheduled = game.status?.short === "NS";
    if (!finished && !scheduled) continue;

    const homeTeam = game.teams.home.name;
    const awayTeam = game.teams.away.name;

    let title: string;
    let summary: string;
    let body: string;

    if (finished) {
      const homeScore = game.scores.home ?? 0;
      const awayScore = game.scores.away ?? 0;
      const fullDateLabel = new Date(game.date).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      });

      title = `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`;
      summary = `${homeTeam} played ${awayTeam} in the ${game.league.name}, finishing ${homeScore}-${awayScore}.`;
      const resultSentence =
        homeScore > awayScore ? `${homeTeam} won ${homeScore}-${awayScore}.`
        : awayScore > homeScore ? `${awayTeam} won ${awayScore}-${homeScore}.`
        : `The match finished ${homeScore}-${awayScore}.`;
      body = `${homeTeam} played ${awayTeam} in the ${game.league.name} on ${fullDateLabel}. ${resultSentence}`;
    } else {
      const startTime = new Date(game.date);
      const dateLabel = startTime.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const startLabel = startTime.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });

      title = `Preview: ${homeTeam} vs ${awayTeam} — ${dateLabel}`;
      summary = `${homeTeam} face ${awayTeam} in the ${game.league.name} on ${dateLabel}.`;
      body = `${homeTeam} face ${awayTeam} in the ${game.league.name}. First serve is ${startLabel}.`;
    }

    items.push({
      title,
      summary,
      body,
      sourceUrl: `https://www.volleyball.api-sports.io/games/${game.id}`,
      sourceName: SOURCE_NAME,
      category: "volleyball",
      publishedAt: new Date(game.date),
      homeCrestUrl: game.teams.home.logo,
      awayCrestUrl: game.teams.away.logo,
      homeTeam,
      awayTeam,
      homeScore: finished ? game.scores.home ?? undefined : undefined,
      awayScore: finished ? game.scores.away ?? undefined : undefined,
      matchStatus: finished ? "finished" : "scheduled",
      kickoffAt: new Date(game.date),
      dedupeKey: `api-volleyball-${game.id}`,
      seriesLabel: game.league.name,
    });
  }

  const placeholderCrests = await resolvePlaceholderCrests(items.flatMap((i) => [i.homeCrestUrl, i.awayCrestUrl]));
  for (const item of items) {
    if (item.homeCrestUrl && placeholderCrests.has(item.homeCrestUrl)) item.homeCrestUrl = undefined;
    if (item.awayCrestUrl && placeholderCrests.has(item.awayCrestUrl)) item.awayCrestUrl = undefined;
  }

  return items;
}
