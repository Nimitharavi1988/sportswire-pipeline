/**
 * Real venue/stadium data for football matches, from API-Sports' Football
 * API (api-football.com) — confirmed live that football-data.org's own
 * free tier simply doesn't return a venue field at all, so this exists
 * purely to fill that one gap. Everything else (scores, standings,
 * competitions) stays on football-data.org, which already works well.
 *
 * Free tier: 100 requests/day, all endpoints/fields included (venue isn't
 * paywalled) — confirmed live. One `/fixtures?date=` call returns every
 * fixture worldwide for that day in one shot, so this only ever needs a
 * single call to get broad coverage, not one per match.
 *
 * Docs: https://www.api-football.com/documentation-v3
 */

import { db } from "@/db";
import { vertical, source } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const BASE_URL = "https://v3.football.api-sports.io";
const SOURCE_NAME = "API-Football (venue)";

// Venue is static once a fixture is scheduled — there's no need to
// re-fetch it every ~15-min ingestion run the way live scores need
// refreshing. Matched to roughly once an hour (24 calls/day), well under
// the 100/day free cap with real headroom for manual dashboard usage on
// the same account. Same lastPolledAt/Source pattern already used by
// cricketData.ts's own self-throttle, for a real persistent check that
// survives each run being a fresh process (an in-memory-only throttle
// would reset every run and do nothing).
const MIN_POLL_INTERVAL_MS = 60 * 60 * 1000;

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|cd|united|utd)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function venueKey(homeTeam: string, awayTeam: string, dateISO: string): string {
  return `${dateISO}|${normalizeTeamName(homeTeam)}|${normalizeTeamName(awayTeam)}`;
}

async function fetchVenuesForDate(apiKey: string, date: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`${BASE_URL}/fixtures?date=${date}`, {
      headers: { "x-apisports-key": apiKey },
    });
    if (!res.ok) {
      console.error(`API-Football venue fetch failed: ${res.status}`);
      return map;
    }
    const data = await res.json();
    for (const fixture of data.response ?? []) {
      const venue = fixture.fixture?.venue;
      const home = fixture.teams?.home?.name;
      const away = fixture.teams?.away?.name;
      if (venue?.name && home && away) {
        const label = venue.city ? `${venue.name}, ${venue.city}` : venue.name;
        map.set(venueKey(home, away, date), label);
      }
    }
  } catch (err) {
    console.error("API-Football venue fetch error:", err);
  }
  return map;
}

// Fills in `.venue` on any of the given items whose homeTeam/awayTeam/
// kickoffAt matches a fixture from today's API-Football pull — mutates in
// place. Best-effort, bounded coverage (today's matches, name-matched
// between two different providers' naming conventions) — a miss just
// leaves venue unset, same as before this existed, not a regression.
export async function attachFootballVenues(
  items: { homeTeam?: string; awayTeam?: string; kickoffAt?: Date; venue?: string }[]
): Promise<void> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return;

  const [verticalRow] = await db.select().from(vertical).where(eq(vertical.name, "sports")).limit(1);
  const [sourceRow] = verticalRow
    ? await db.select().from(source).where(and(eq(source.verticalId, verticalRow.id), eq(source.name, SOURCE_NAME))).limit(1)
    : [null];

  if (sourceRow?.lastPolledAt && Date.now() - sourceRow.lastPolledAt.getTime() < MIN_POLL_INTERVAL_MS) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const venues = await fetchVenuesForDate(apiKey, today);

  if (verticalRow) {
    if (sourceRow) {
      await db.update(source).set({ lastPolledAt: new Date() }).where(eq(source.id, sourceRow.id));
    } else {
      await db.insert(source).values({
        id: createId(), verticalId: verticalRow.id, name: SOURCE_NAME, type: "api", config: {}, lastPolledAt: new Date(),
      });
    }
  }

  if (venues.size === 0) return;

  for (const item of items) {
    if (item.venue || !item.homeTeam || !item.awayTeam || !item.kickoffAt) continue;
    const dateISO = item.kickoffAt.toISOString().slice(0, 10);
    const venue = venues.get(venueKey(item.homeTeam, item.awayTeam, dateISO));
    if (venue) item.venue = venue;
  }
}
