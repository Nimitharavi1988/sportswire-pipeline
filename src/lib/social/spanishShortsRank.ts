// How a Spanish Short candidate is ranked (pure, unit-tested; kept apart from the database code).
import { storyPickBoost } from "./drama";
import { matchDayMultiplier, isMatchDayStory, MATCH_DAY_REEL_MAX_AGE_HOURS, type Fixture } from "./matchDay";
import { freshnessMultiplier, isStarStory, reelIsFresh } from "./freshness";

const US_SPORTS = ["american-football", "college-football", "basketball", "wnba", "baseball", "hockey"];
export const US_SPORTS_BOOST = 1.3;

// 8:00 to midnight on the US east coast (pure, unit-tested).
export function isUsWakingHours(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8;
}

// Whether a story is fresh enough for a Short: the same rule postReel applies to every reel (a Messi or Ronaldo story at any age,
// otherwise within the Page's age limit, or up to a day old when it is about a match starting soon or just played). The picker
// used to apply only the first two, so a day-old match story that reels were allowed never reached a Short (pure, unit-tested).
export function shortFreshEnough(a: { title: string; publishedAt: Date | null; createdAt: Date | null }, fixtures: Fixture[], now: Date, maxAgeHours: number): boolean {
  if (isStarStory(a.title) || reelIsFresh(a.publishedAt, a.createdAt, now, maxAgeHours)) return true;
  return reelIsFresh(a.publishedAt, a.createdAt, now, MATCH_DAY_REEL_MAX_AGE_HOURS) && isMatchDayStory(a.title, fixtures, now);
}

// How strongly a story ranks for a Spanish Short (pure, unit-tested).
export function spanishShortScore(
  a: { title: string; category: string; trendingScore: number | null; publishedAt: Date | null },
  fixtures: Fixture[],
  now: Date
): number {
  const base = ((a.trendingScore ?? 0) + storyPickBoost(a.title)) * freshnessMultiplier(a.publishedAt, now, a.title) * matchDayMultiplier(a.title, fixtures, now);
  const us = isUsWakingHours(now) && US_SPORTS.some((c) => a.category === c || a.category.startsWith(c + "/")) ? US_SPORTS_BOOST : 1;
  // Messi and Ronaldo first, whatever the score.
  return base * us + (isStarStory(a.title) ? 1000 : 0);
}
