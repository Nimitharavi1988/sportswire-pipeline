/**
 * Real coverage gap, found while investigating why /series/asian-games-2026
 * only ever had cricket (95) and football/teqball (5) articles despite the
 * Games spanning ~40 disciplines: every existing source is single-sport
 * (rssFeeds.ts's FEEDS list assigns one fixed category per feed URL), so a
 * Games story in any OTHER sport — weightlifting, shooting, badminton,
 * wushu, gymnastics, rowing, cycling, athletics, soft tennis — had no
 * matching source at all. The one entry that WAS meant to cover exactly
 * this (ESPN's Olympic-sports feed, rssFeeds.ts, added 2026-09-20) turned
 * out to have silently produced zero articles for 3 straight days in
 * production despite passing every check when tested directly — see that
 * feed's own comment and the per-feed logging added to fetchRssNews the
 * same day this file was added. Not re-relying on it alone here.
 *
 * Times of India's and Hindustan Times' GENERAL sports feeds (not their
 * cricket-only ones already in rssFeeds.ts) were confirmed live to carry
 * exactly this real cross-discipline coverage (Mirabai Chanu/weightlifting,
 * Manu Bhaker/shooting, badminton, wushu, soft tennis, rowing, cycling) —
 * but they're genuinely mixed feeds (also carry cricket, NFL/MLB/WNBA
 * gossip unrelated to the Games entirely), so unlike every other entry in
 * rssFeeds.ts's FEEDS list, a single fixed category can't be assigned to
 * the whole feed without mislabeling most of it.
 *
 * This fetcher instead filters EACH feed down to only the items that are
 * actually about the Games (title match, same \bAsian Games\b pattern
 * eventTagging.ts already uses to group them into the /series hub) and
 * discards everything else from these feeds outright — the cricket and
 * off-topic items they also carry are already covered by rssFeeds.ts's own
 * dedicated feeds, so there's no benefit to ingesting them a second time
 * from here, only mislabeling risk.
 *
 * Every matched item is filed under "athletics" — not literally accurate
 * for e.g. badminton or rowing, but it's the same precedent already set by
 * rssFeeds.ts's ESPN Olympic feed comment ("broader than pure track and
 * field... but 'athletics' is the closest existing category"): this
 * project's fixed category list has no real slot for most Olympic-program
 * sports, and inventing a new category for a 2-week regional Games isn't
 * worth the site-wide navigation/schema change it would require.
 */
import Parser from "rss-parser";
import type { RawMatchItem } from "./footballData";
import { extractRssImage } from "./rssFeeds";
import { decodeHtmlEntities } from "../htmlEntities";

const parser = new Parser({
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail"],
      ["media:content", "mediaContent", { keepArray: true }],
      ["coverImages", "coverImages"],
    ],
  },
});

// Same pattern eventTagging.ts uses to group these into /series/asian-games-2026
// — kept in sync deliberately (word-boundary, not a bare substring) so a
// filter mismatch here can't ever admit something the series page would
// then refuse to group, or vice versa.
const ASIAN_GAMES_TITLE_PATTERN = /\bAsian Games\b/i;

const FEEDS: { url: string; sourceName: string }[] = [
  // General (not cricket-only) feed — confirmed live 2026-09-23: real,
  // current, cross-discipline Games coverage (weightlifting, shooting,
  // gymnastics, soft tennis, rowing) mixed in with unrelated cricket/NFL/
  // MLB/WNBA items that the title filter below discards.
  { url: "https://timesofindia.indiatimes.com/rssfeeds/4719148.cms", sourceName: "The Times of India" },
  { url: "https://www.hindustantimes.com/feeds/rss/sports/rssfeed.xml", sourceName: "Hindustan Times" },
];

export async function fetchAsianGamesNews(): Promise<RawMatchItem[]> {
  const items: RawMatchItem[] = [];

  for (const feed of FEEDS) {
    const startCount = items.length;
    try {
      const parsed = await parser.parseURL(feed.url);

      for (const entry of parsed.items ?? []) {
        if (!entry.title || !entry.link) continue;
        if (!ASIAN_GAMES_TITLE_PATTERN.test(entry.title)) continue;

        const image = extractRssImage(entry);

        items.push({
          title: decodeHtmlEntities(entry.title),
          summary: `Full coverage from ${feed.sourceName}. Read the original report at the source link below.`,
          sourceSnippet: entry.contentSnippet?.slice(0, 1200),
          sourceUrl: entry.link,
          sourceName: feed.sourceName,
          category: "athletics",
          publishedAt: entry.isoDate ? new Date(entry.isoDate) : new Date(),
          heroImageUrl: image?.url,
          heroImageCredit: image?.credit,
          // Same reasoning as rssFeeds.ts's dedupeKey — a live-updating
          // Games results blog would otherwise re-ingest as "new" every
          // time its headline changes.
          dedupeKey: entry.link,
        });
      }
      console.log(`[asianGamesFeeds] ${feed.sourceName}: ${items.length - startCount} Asian Games items (filtered from ${parsed.items?.length ?? 0} total)`);
    } catch (err) {
      console.error(`Asian Games RSS fetch failed for ${feed.url}:`, err);
    }
  }

  return items;
}
