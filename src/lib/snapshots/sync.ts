/**
 * Refreshes stored copies of third-party tables (see snapshots/read.ts) —
 * run with each ingestion (ingest-cron.yml, its own step). A fetch that
 * fails or comes back empty keeps the previous copy, so a provider hiccup
 * never blanks a table on the site.
 */
import { db } from "@/db";
import { dataSnapshot } from "@/db/schema";
import { fetchNflStandingsTable } from "../ingestion/nflData";
import { fetchNbaStandingsTable } from "../ingestion/nbaData";
import { fetchMlbStandingsTable } from "../ingestion/mlbData";
import { fetchNhlStandingsTable } from "../ingestion/nhlData";
import { fetchStandingsTable } from "../ingestion/standings";
import { fetchCricketStandings } from "../events/cricketStandings";
import { EVENT_HUBS } from "../events/eventHubs";
import { VENUES } from "../venues";
import { fetchVenueDetails } from "../venueDetails";
import type { VenueDetails } from "../venues";
import { SNAPSHOT_KEYS } from "./read";

// A table (list of groups) or one record (a venue's details).
// refreshAfterMs: how old the stored copy may get before it's fetched again
// (default: every run) — for data that rarely changes, fetched from a
// provider that rate-limits bursts (Wikimedia).
type SnapshotSource = {
  key: string;
  sourceUrl: string;
  load: () => Promise<unknown[] | object | null>;
  refreshAfterMs?: (stored: unknown) => number;
  // Combine a fresh fetch with the stored copy (keep what the fresh one lacks).
  merge?: (fresh: object, stored: unknown) => object;
};

const HOUR = 60 * 60 * 1000;
// Venue details: daily; sooner while the photo is missing (a rate-limited
// licence lookup comes back without one).
const venueRefreshAfter = (stored: unknown) => ((stored as VenueDetails | null)?.image ? 24 * HOUR : 6 * HOUR);
const venueMerge = (fresh: object, stored: unknown) => {
  const f = fresh as VenueDetails;
  return f.image ? f : { ...f, image: (stored as VenueDetails | null)?.image ?? null };
};

function sources(): SnapshotSource[] {
  const espn = (path: string) => `https://site.api.espn.com/apis/v2/sports/${path}/standings`;
  const list: SnapshotSource[] = [
    { key: SNAPSHOT_KEYS.nflStandings, sourceUrl: espn("football/nfl"), load: fetchNflStandingsTable },
    { key: SNAPSHOT_KEYS.nbaStandings, sourceUrl: espn("basketball/nba"), load: fetchNbaStandingsTable },
    { key: SNAPSHOT_KEYS.mlbStandings, sourceUrl: espn("baseball/mlb"), load: fetchMlbStandingsTable },
    { key: SNAPSHOT_KEYS.nhlStandings, sourceUrl: espn("hockey/nhl"), load: fetchNhlStandingsTable },
    { key: SNAPSHOT_KEYS.footballStandings("PL"), sourceUrl: "https://api.football-data.org/v4/competitions/PL/standings", load: async () => { const apiKey = process.env.FOOTBALL_DATA_API_KEY; return apiKey ? fetchStandingsTable(apiKey, "PL") : null; } },
  ];
  for (const hub of Object.values(EVENT_HUBS)) {
    for (const s of hub.cricketStandings ?? []) {
      list.push({ key: SNAPSHOT_KEYS.cricketStandings(s.espnLeagueId), sourceUrl: espn(`cricket/${s.espnLeagueId}`), load: () => fetchCricketStandings(s.espnLeagueId) });
    }
  }
  for (const venue of VENUES) {
    list.push({ key: SNAPSHOT_KEYS.venue(venue.slug), sourceUrl: `https://en.wikipedia.org/wiki/${venue.wikipedia}`, load: () => fetchVenueDetails(venue), refreshAfterMs: venueRefreshAfter, merge: venueMerge });
  }
  return list;
}

export async function syncSnapshots(): Promise<void> {
  const stored = new Map((await db.select().from(dataSnapshot)).map((r) => [r.key, r]));
  for (const s of sources()) {
    const previous = stored.get(s.key);
    if (s.refreshAfterMs && previous && Date.now() - previous.fetchedAt.getTime() < s.refreshAfterMs(previous.data)) continue;
    try {
      const fetched = await s.load();
      const data = fetched && !Array.isArray(fetched) && s.merge && previous ? s.merge(fetched, previous.data) : fetched;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        console.warn(`[snapshots] ${s.key}: nothing fetched — kept previous copy`);
        continue;
      }
      await db.insert(dataSnapshot)
        .values({ key: s.key, data, sourceUrl: s.sourceUrl, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: dataSnapshot.key, set: { data, sourceUrl: s.sourceUrl, fetchedAt: new Date() } });
      console.log(`[snapshots] ${s.key}: ${Array.isArray(data) ? `${data.length} groups` : "updated"}`);
    } catch (err) {
      console.error(`[snapshots] ${s.key} failed:`, err);
    }
  }
}

if (require.main === module) {
  syncSnapshots().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
