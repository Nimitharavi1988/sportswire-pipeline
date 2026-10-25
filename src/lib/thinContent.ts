/**
 * Which ingested stories are offered to search engines (2026-10-04).
 *
 * An ingested story is a short write-up of another outlet's report. A
 * database count that day: 19,876 published, 19,872 of them under 300 words
 * (the longest 347). At that volume, pages like these can count against how
 * the whole site is judged: they were the likely reason AdSense turned the
 * site down. So they stay up for readers and social posts, but are noindex
 * and left out of the sitemaps, the same treatment match score cards already
 * get. Fan threads, live streams and "how to watch" items are left out
 * whatever their length.
 *
 * Original stories (written in admin) are always indexed. One that becomes a
 * substantial piece (300+ words) is indexed again automatically.
 *
 * isThinRewrite (pages) and indexableArticleSql (sitemaps) must agree, so
 * both count words the same way: the body (or the summary when there is no
 * body), trimmed, split on runs of whitespace.
 */
import { sql, type SQL } from "drizzle-orm";
import { article } from "@/db/schema";
import { ORIGINAL_SOURCE, isOriginalStory } from "./stories";

export const MIN_INDEXED_WORDS = 300;

// Titles that are never a news story of their own: fan-site threads, stream
// listings, TV guides and live blogs.
// Advertising only (2026-10-06, after Prime Day deal lists and sportsbook promo
// codes went out on the Facebook Page): promo and bonus codes, shopping deals
// and ticket-sale pitches. Betting ANALYSIS (odds, picks, props), "how to
// watch" pages and live blogs are real content and are not in this list. Plain
// phrases, no word boundaries, so this one string works as both a JavaScript
// and a Postgres regular expression (indexableArticleSql below).
const PROMO = "promo code|promo codes|bonus code|bonus bets|free bets|sportsbook promo|prime day|prime big deal|big deal days|black friday|cyber monday|deals on|best deals|deals live|% off|discount|gift guide|giveaway|half price|half-price|price drop|where to buy|how to buy|buying guide|we rate the|best headphones|best gear|shop the|on sale now|limited time|tickets today|get tickets|get playoff tickets|buy tickets";
const NOT_A_STORY = `open thread|open chat|game thread|live stream|how to watch|where to watch|live updates|live blog|${PROMO}`;
const NOT_A_STORY_RE = new RegExp(NOT_A_STORY, "i");

// An advertisement: kept off the Facebook and Instagram Pages and out of search.
const PROMO_RE = new RegExp(PROMO, "i");
export function isPromotional(title: string): boolean {
  return PROMO_RE.test(title);
}

export function isNotAStory(title: string): boolean {
  return NOT_A_STORY_RE.test(title);
}

export function articleWords(a: { body: string | null; summary: string | null }): number {
  const text = (a.body?.trim() ? a.body : a.summary ?? "").trim();
  return text ? text.split(/\s+/).length : 0;
}

// Pure, unit-tested.
export function isThinRewrite(a: { sourceName: string; title: string; body: string | null; summary: string | null }): boolean {
  if (isOriginalStory(a)) return false;
  return NOT_A_STORY_RE.test(a.title) || articleWords(a) < MIN_INDEXED_WORDS;
}

// The same rule as a query condition: true for the stories that ARE indexed.
export function indexableArticleSql(): SQL {
  const trim = (col: typeof article.body | typeof article.summary) => sql`regexp_replace(coalesce(${col}, ''), '^\\s+|\\s+$', '', 'g')`;
  const text = sql`coalesce(nullif(${trim(article.body)}, ''), ${trim(article.summary)})`;
  const words = sql`case when ${text} = '' then 0 else array_length(regexp_split_to_array(${text}, '\\s+'), 1) end`;
  return sql`(${article.sourceName} = ${ORIGINAL_SOURCE} or (${words} >= ${MIN_INDEXED_WORDS} and ${article.title} !~* ${NOT_A_STORY}))`;
}
