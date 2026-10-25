/**
 * International cricket matches fetched directly by CricketData match id,
 * because the free plan's currentMatches feed (the general cricket source)
 * doesn't include them — confirmed: 0 internationals in the 45 matches it
 * delivered over 60 days, while CricketData's own series data lists these.
 *
 * Budget (free plan: 100 calls/day). The general feed normally takes ~96 of
 * them, so on a day with a tracked match:
 * - the general feed (mostly county/franchise games) polls every 2 hours,
 * - a tracked match in play is refreshed every ~7 minutes (full ingestion
 *   every 15 min + the live-refresh job in between),
 * - and every call stops once CricketData's own hitsToday reaches 95.
 *
 * Living config: add a series' matches (ids from CricketData's series_info)
 * when it's confirmed; remove old ones any time. Start times are CricketData's
 * dateTimeGMT strings exactly as returned (GMT, no zone marker).
 */

export interface TrackedCricketMatch {
  id: string;
  name: string;
  startGmt: string;
}

// West Indies tour of India, 2026 (CricketData series
// 702ce6cb-a551-4aab-961e-0ed1548a3c74). CricketData tags all eight "odi";
// the format is read from the name instead (see matchDurationMs).
export const TRACKED_CRICKET_MATCHES: TrackedCricketMatch[] = [
  { id: "90ae280c-cb10-4d58-9bcc-ec95294819e6", name: "India vs West Indies, 1st ODI, West Indies tour of India, 2026", startGmt: "2026-09-27T08:30:00" },
  { id: "56d07759-19dd-4a8c-a3d5-58bfd6a142a1", name: "India vs West Indies, 2nd ODI, West Indies tour of India, 2026", startGmt: "2026-09-30T08:30:00" },
  { id: "da91f633-acac-4449-86f8-9bff6244053f", name: "India vs West Indies, 3rd ODI, West Indies tour of India, 2026", startGmt: "2026-10-03T08:30:00" },
  { id: "0643db2e-fd71-41d6-bad1-df3513607f3f", name: "India vs West Indies, 1st T20I, West Indies tour of India, 2026", startGmt: "2026-10-06T13:30:00" },
  { id: "ff0a0eb6-4abf-474b-9aa6-99fac469b2f2", name: "India vs West Indies, 2nd T20I, West Indies tour of India, 2026", startGmt: "2026-10-09T13:30:00" },
  { id: "8775724e-9bb6-4494-91ca-7822c201aec5", name: "India vs West Indies, 3rd T20I, West Indies tour of India, 2026", startGmt: "2026-10-11T13:30:00" },
  { id: "3c451481-9fa8-400b-a7b6-27cffc21e1a8", name: "India vs West Indies, 4th T20I, West Indies tour of India, 2026", startGmt: "2026-10-14T13:30:00" },
  { id: "f6ac293e-72ae-434e-aabc-dec0bdcc2114", name: "India vs West Indies, 5th T20I, West Indies tour of India, 2026", startGmt: "2026-10-17T13:30:00" },
];

const HOUR = 60 * 60 * 1000;
// Start polling a little before the toss so the match flips to live promptly.
export const TRACKED_LEAD_MS = 30 * 60 * 1000;
// Live-refresh cadence for a tracked match in play (see budget above).
export const TRACKED_REFRESH_MS = 7 * 60 * 1000;
// General feed cadence on a day a tracked match is played (normally 15 min).
export const BUSY_DAY_GENERAL_POLL_MS = 2 * HOUR;
// Stop calling CricketData once its own hitsToday reaches this.
export const HITS_SAFETY_LIMIT = 95;

// Generous upper bounds; a finished match stops being polled earlier (its
// row is marked finished), so these only cap a match that never reports a
// result (abandoned, no-result).
export function matchDurationMs(name: string): number {
  if (/\bTest\b/i.test(name)) return 5 * 24 * HOUR;
  if (/\bT20I?\b/i.test(name)) return 4.5 * HOUR;
  return 9 * HOUR; // ODI and anything else one-day
}

export function trackedStart(match: TrackedCricketMatch): Date {
  return new Date(`${match.startGmt}Z`);
}

// Tracked matches being played now (or about to start).
export function trackedInPlay(now: Date, matches: TrackedCricketMatch[] = TRACKED_CRICKET_MATCHES): TrackedCricketMatch[] {
  return matches.filter((m) => {
    const start = trackedStart(m).getTime();
    return now.getTime() >= start - TRACKED_LEAD_MS && now.getTime() <= start + matchDurationMs(m.name);
  });
}

// True from 2 hours before a tracked match until it can have ended — the
// window in which the general feed slows down to save calls for it.
export function isTrackedMatchDay(now: Date, matches: TrackedCricketMatch[] = TRACKED_CRICKET_MATCHES): boolean {
  return matches.some((m) => {
    const start = trackedStart(m).getTime();
    return now.getTime() >= start - 2 * HOUR && now.getTime() <= start + matchDurationMs(m.name);
  });
}

// Call budget, persisted in the CricketData Source row's `config` JSON as
// { hitsToday, hitsDate } from CricketData's own response `info` — so every
// process (ingestion, live refresh) sees the same count.
export interface HitsRecord {
  hitsToday?: number;
  hitsDate?: string;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export function budgetAllows(config: unknown, now: Date): boolean {
  const record = (config ?? {}) as HitsRecord;
  if (record.hitsDate !== utcDay(now)) return true; // new day (or never recorded)
  return (record.hitsToday ?? 0) < HITS_SAFETY_LIMIT;
}

export function withHits(config: unknown, info: { hitsToday?: number } | undefined, now: Date): Record<string, unknown> {
  const base = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  if (typeof info?.hitsToday !== "number") return base;
  return { ...base, hitsToday: info.hitsToday, hitsDate: utcDay(now) };
}
