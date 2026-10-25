// Breaking news on the topic Pages. A story is "breaking" when it is under an hour
// old and several different outlets are covering the same event within the last
// two hours. Those stories can go out past the pacing and the daily cap (by a small
// allowance, facebookDestinations.ts `breaking`), and reels for them skip the
// minimum score and the reel hours. On 2026-10-06 the Iyer century broke at about
// 22:30 IST, after both cricket Pages had used their day; about 15 outlets covered it
// within the hour.
import { isSimilarTitle } from "../titleSimilarity";
import { isMatchDataSource } from "../matchDataSources";

export interface BreakingCandidate {
  id: string;
  title: string;
  sourceName: string | null;
  publishedAt: Date | null;
}

const FRESH_MINUTES = 60;
const LOOKBACK_MINUTES = 120;
// 3, from replaying 72 hours of cricket stories: 4 flagged one event in 3 days (the Iyer century) and missed
// the squad announcement; 3 flagged about 1.3 a day, all real news; 2 flagged 6 a day, mostly noise.
export const DEFAULT_MIN_OUTLETS = 3;

// Two Pages that share breaking news take one half each, by story id, so they never
// carry the same story (repeated content gets less reach).
export function breakingSlotFor(id: string): 0 | 1 {
  let h = 0;
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 0 : 1;
}

// Ids of the stories published in the last hour that at least `minOutlets` different
// outlets (counting its own) are covering, by headline similarity. Match-data rows
// are scorecards, not outlets.
export function findBreaking(pool: BreakingCandidate[], now: Date, minOutlets = DEFAULT_MIN_OUTLETS): Set<string> {
  const ageMs = (a: BreakingCandidate) => (a.publishedAt ? now.getTime() - a.publishedAt.getTime() : Infinity);
  const recent = pool.filter((a) => ageMs(a) >= 0 && ageMs(a) < LOOKBACK_MINUTES * 60_000 && !isMatchDataSource(a.sourceName ?? ""));
  const breaking = new Set<string>();
  for (const a of recent) {
    if (ageMs(a) >= FRESH_MINUTES * 60_000) continue;
    const outlets = new Set<string>();
    for (const b of recent) {
      if (a === b || isSimilarTitle(a.title, b.title)) outlets.add((b.sourceName ?? b.id).trim().toLowerCase());
    }
    if (outlets.size >= minOutlets) breaking.add(a.id);
  }
  return breaking;
}
