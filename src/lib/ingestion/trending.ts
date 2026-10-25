/**
 * Pulls today's Google Trends daily trending searches and uses them, plus
 * two other signals, to score already-ingested articles for ranking:
 *  - Google Trends search volume (this file) — what people are searching.
 *  - Reddit hot-post engagement (redditEngagement.ts) — what people are
 *    actually discussing right now, a real engagement signal Trends alone
 *    misses.
 *  - Event-type/superstar keyword heuristics (eventKeywords.ts,
 *    players.ts) — catches high-interest story types (transfers, records,
 *    deaths) and superstar-player stories that neither of the above
 *    reliably catches on their own.
 * Higher trendingScore surfaces an article first on the homepage and gets
 * it priority for the limited Gemini commentary budget during ingestion.
 *
 * Uses an unofficial Google Trends client (no official public API exists
 * yet). Treat this as best-effort: if Google changes something and this
 * breaks, ingestion should keep working without it (everything just gets
 * a lower trendingScore, same as before — the other two signals still
 * apply).
 */
import GoogleTrendsApi from "@alkalisummer/google-trends-js";
import { EVENT_KEYWORDS } from "../eventKeywords";
import { SUPERSTAR_SEARCH_TERMS } from "../players";

// BBC/Sky/Guardian — most of this site's RSS sources — are UK outlets, so
// US-only search trends were a real mismatch for a lot of the content.
// India added 2026-09-20 (explicit request) — cricket's real audience
// skews India/Asia (Cricinfo India feed, Hindustan Times, the ongoing
// India promotions push), but this signal previously had zero India
// coverage despite being the single highest-weighted signal in
// computeTrendingScore (+10 per match).
// Ireland and Sweden added same day (explicit request) — this site's
// confirmed real secondary audience, and this signal is shared across every
// article regardless of category (not cricket-specific), so it benefits
// every sport equally. Confirmed live: Sweden's own daily trends already
// include "shl tabell" (Swedish Hockey League standings) — real overlap
// with hockey, one of the categories boosted in computeTrendingScore's
// audience-match bonus. UK is already covered via "GB"; Australia
// deliberately left out — real, live trending data exists for it too, but
// it wasn't part of the confirmed real audience breakdown, so adding it
// would be a guess rather than a data-backed choice.
// All geos are queried and merged independently — one failing never drops
// the others' results.
const TRENDS_GEOS = ["US", "GB", "IN", "IE", "SE"];

export async function fetchTrendingKeywords(): Promise<string[]> {
  const results = await Promise.all(
    TRENDS_GEOS.map(async (geo) => {
      try {
        const result = await GoogleTrendsApi.dailyTrends({ geo, hl: "en" });
        const keywords: string[] = [];
        for (const item of result?.data ?? []) {
          if (item.keyword) keywords.push(String(item.keyword).toLowerCase());
          for (const related of item.relatedKeywords ?? []) {
            keywords.push(String(related).toLowerCase());
          }
        }
        return keywords;
      } catch (err) {
        console.error(`Google Trends fetch failed for geo=${geo} (continuing without it):`, err);
        return [];
      }
    })
  );
  return [...new Set(results.flat())];
}

// Confirmed real audience breakdown (2026-09-20): mostly USA, Sweden and
// Ireland a real secondary segment, India actually low despite this site's
// cricket-heavy coverage. These four categories are where that audience's
// real demand is — american-football/basketball/baseball for the US
// directly, hockey for both the US and Sweden (NHL has heavy Swedish
// representation, real fan crossover). A flat, modest boost (same order as
// the superstar-name boost below) nudges close calls in the ranking toward
// what this audience actually reads, without letting it override a
// genuinely bigger story in another category.
// college-football/wnba added 2026-09-26 with their sections (US audience).
const AUDIENCE_MATCH_CATEGORIES = new Set(["american-football", "college-football", "basketball", "wnba", "baseball", "hockey"]);
const AUDIENCE_MATCH_BOOST = 5;

export function computeTrendingScore(
  title: string,
  trendingKeywords: string[],
  redditEngagement?: Map<string, number>,
  category?: string
): number {
  const lowerTitle = title.toLowerCase();
  let score = 0;

  for (const keyword of trendingKeywords) {
    if (keyword && lowerTitle.includes(keyword)) {
      score += 10;
    }
  }

  // Event-type stories (transfers, records, deaths) and superstar-player
  // stories are reliably high-interest even when they don't happen to
  // match a currently-trending search term.
  if (EVENT_KEYWORDS.some((kw) => lowerTitle.includes(kw))) {
    score += 8;
  }
  if (SUPERSTAR_SEARCH_TERMS.some((term) => lowerTitle.includes(term.toLowerCase()))) {
    score += 5;
  }
  if (category && AUDIENCE_MATCH_CATEGORIES.has(category)) {
    score += AUDIENCE_MATCH_BOOST;
  }

  if (redditEngagement) {
    for (const [term, weight] of redditEngagement) {
      if (lowerTitle.includes(term)) {
        score += weight;
      }
    }
  }

  return score;
}