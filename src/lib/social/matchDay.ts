/**
 * Match-day preference for social posts and reels (2026-10-11). A story about a match that
 * kicks off in the next hours, or ended in the last hours, is what the audience is looking for
 * right now, so its ranking score is multiplied. It only reorders (like freshness.ts): the stored
 * score and the homepage are untouched, and when nothing is on, nothing changes.
 *
 * "About a match": the story's title names BOTH sides of a fixture from our match rows (stronger
 * boost), or one side of a fixture that is about to start (weaker: it may be any club news).
 */
import { significantWords, sharesWords } from "../titleSimilarity";

export interface Fixture { home: string; away: string; kickoff: Date }

// A fixture counts from this long before kickoff until this long after it (a T20, a football match
// and most of an ODI fit inside the six hours after).
export const MATCH_DAY_BEFORE_MS = 12 * 3_600_000;
export const MATCH_DAY_AFTER_MS = 6 * 3_600_000;
// One side only counts when the fixture is this close to starting, or just started.
export const ONE_SIDE_BEFORE_MS = 4 * 3_600_000;
export const ONE_SIDE_AFTER_MS = 3 * 3_600_000;

export const BOTH_SIDES_MULTIPLIER = 1.8;
// A story about a match in the window keeps its place even when it is older than the usual limits
// (a preview from yesterday for tonight's match is still the story): it is exempt from the reel age
// rule up to this age, and its freshness weight never falls below the floor.
export const MATCH_DAY_REEL_MAX_AGE_HOURS = 24;
export const MATCH_DAY_FRESHNESS_FLOOR = 0.8;
export const ONE_SIDE_MULTIPLIER = 1.25;

// One side alone only counts for a title that reads like match coverage (a dry run on real stories
// boosted "Ryan Reaves retires" and Ranji Trophy items because their club or country plays today).
const MATCH_WORDS = /(?:^|[^a-z])(?:preview|team news|line-?ups?|predicted|predictions?|live|vs.?|v|injur(?:y|ies)|squad|report|reaction|ratings|how to watch|kick-?off|toss)(?![a-z])/i;

// Cricket headlines abbreviate the national sides ("IND vs WI 3rd T20I"): spelled out before matching.
const ABBREVIATIONS: [RegExp, string][] = [
  [/(?:^|[^A-Za-z])IND(?![A-Za-z])/g, " India "], [/(?:^|[^A-Za-z])WI(?![A-Za-z])/g, " West Indies "], [/(?:^|[^A-Za-z])AUS(?![A-Za-z])/g, " Australia "],
  [/(?:^|[^A-Za-z])ENG(?![A-Za-z])/g, " England "], [/(?:^|[^A-Za-z])PAK(?![A-Za-z])/g, " Pakistan "], [/(?:^|[^A-Za-z])NZ(?![A-Za-z])/g, " New Zealand "],
  [/(?:^|[^A-Za-z])SA(?![A-Za-z])/g, " South Africa "], [/(?:^|[^A-Za-z])SL(?![A-Za-z])/g, " Sri Lanka "], [/(?:^|[^A-Za-z])BAN(?![A-Za-z])/g, " Bangladesh "], [/(?:^|[^A-Za-z])AFG(?![A-Za-z])/g, " Afghanistan "],
];
export function expandAbbreviations(title: string): string {
  return ABBREVIATIONS.reduce((t, [re, full]) => t.replace(re, full), title);
}

export function mentions(titleWords: Set<string>, team: string): boolean {
  const words = significantWords(team);
  return words.size > 0 && sharesWords(words, titleWords, 0.6, 1);
}

// A story that names both sides of a fixture in the window (pure, unit-tested).
export function isMatchDayStory(title: string, fixtures: Fixture[], now: Date): boolean {
  return matchDayMultiplier(title, fixtures, now) >= BOTH_SIDES_MULTIPLIER;
}

// The multiplier for a story title at `now` given the fixtures (pure, unit-tested).
export function matchDayMultiplier(title: string, fixtures: Fixture[], now: Date): number {
  if (fixtures.length === 0) return 1;
  const expanded = expandAbbreviations(title);
  const titleWords = significantWords(expanded);
  let best = 1;
  for (const f of fixtures) {
    const dt = f.kickoff.getTime() - now.getTime(); // positive: kickoff still ahead
    if (dt > MATCH_DAY_BEFORE_MS || dt < -MATCH_DAY_AFTER_MS) continue;
    const home = mentions(titleWords, f.home);
    const away = mentions(titleWords, f.away);
    if (home && away) best = Math.max(best, BOTH_SIDES_MULTIPLIER);
    else if ((home || away) && MATCH_WORDS.test(expanded) && dt <= ONE_SIDE_BEFORE_MS && dt >= -ONE_SIDE_AFTER_MS) best = Math.max(best, ONE_SIDE_MULTIPLIER);
  }
  return best;
}
