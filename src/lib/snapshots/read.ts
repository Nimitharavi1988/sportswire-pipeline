import { db } from "@/db";
import { dataSnapshot } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchStandingsTable, type StandingsTable } from "../ingestion/standings";

export const SNAPSHOT_KEYS = {
  nflStandings: "standings:nfl",
  nbaStandings: "standings:nba",
  mlbStandings: "standings:mlb",
  nhlStandings: "standings:nhl",
  cricketStandings: (espnLeagueId: string) => `cricket-standings:${espnLeagueId}`,
  venue: (slug: string) => `venue:${slug}`,
  footballStandings: (code: string) => `football-standings:${code}`,
};

// Third-party data the site shows but doesn't fetch while rendering pages
// (standings tables): the ingestion job fetches it (snapshots/sync.ts) and
// pages read the last stored copy. Fetching ESPN from the Cloudflare
// Worker was unreliable (refused requests), and a stored copy also makes
// pages faster and independent of a third party being up.
export async function readSnapshot<T>(key: string): Promise<T | null> {
  try {
    const [row] = await db.select({ data: dataSnapshot.data }).from(dataSnapshot).where(eq(dataSnapshot.key, key)).limit(1);
    return (row?.data as T | undefined) ?? null;
  } catch {
    return null;
  }
}

// A football league table (football-data.org) for page renders: the stored
// copy the ingestion job keeps fresh, so a page never waits on the provider.
// Falls back to a live fetch only while no copy is stored yet.
export async function readFootballStandings(code = "PL"): Promise<StandingsTable | null> {
  const stored = await readSnapshot<StandingsTable>(SNAPSHOT_KEYS.footballStandings(code));
  if (stored && stored.rows?.length > 0) return stored;
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  return apiKey ? fetchStandingsTable(apiKey, code) : null;
}
