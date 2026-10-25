import Parser from "rss-parser";
import { TRACKED_PLAYERS } from "../players";
import type { RawMatchItem } from "./footballData";
import { decodeHtmlEntities } from "../htmlEntities";

// Google News' public, no-key RSS search endpoint — returns real headlines
// from hundreds of publishers matching a query, not just our fixed feed
// list. Same copyright-safe usage as every other RSS source on the site:
// headline + short snippet (grounding input only, never displayed/stored
// as-is) + link-out, never full article text. Built specifically to close
// the gap where a tracked player's name simply never appears in whichever
// handful of stories our 8 fixed feeds happen to be carrying right now
// (confirmed directly for Sanju Samson: zero mentions across all 4 cricket
// feeds at the time this was built).
const parser = new Parser({
  customFields: {
    item: [["source", "sourceTag"]],
  },
});

export function googleNewsSearchUrl(name: string): string {
  // when:3d matches the site's existing MAX_RSS_ITEM_AGE_MS staleness
  // window (runIngest.ts) — avoids fetching/parsing old matches we'd just
  // discard anyway.
  const query = `"${name}" when:3d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

// Google News titles are suffixed with " - {Publisher}" and the <source>
// tag already carries that same publisher name structurally — stripped so
// the displayed title matches every other source's plain-headline style
// instead of showing the publisher's name twice.
export function stripPublisherSuffix(title: string, publisher: string | undefined): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

export function extractPublisher(entry: any): string | undefined {
  const tag = entry.sourceTag;
  const name = typeof tag === "string" ? tag : tag?._;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

// A player-name search (unlike our fixed headline-based RSS feeds) also
// surfaces static encyclopedia/stat-tracker profile pages alongside real
// news — confirmed directly via 2 real examples: Britannica's "Shane
// Warne" (the bare name, no headline at all) and "Suryakumar Yadav |
// Profile, Stats, Ranking, Videos, Career Info, Age, Latest News, &
// Highlights" (a templated stats-aggregator title, not organic news
// phrasing). Neither is a "report" in any sense — the auto-generated
// "Read the original report..." summary would be actively misleading for
// them. Sourced from Britannica specifically both times (it's an
// encyclopedia, not a news publisher, by its own nature) — excluded as a
// source outright in addition to the title-shape check, since neither
// signal alone is as reliable as both together.
export function looksLikeReferencePage(title: string, publisher: string | undefined, playerName: string): boolean {
  if (publisher?.toLowerCase() === "britannica") return true;
  if (title.trim().toLowerCase() === playerName.trim().toLowerCase()) return true;
  if (/\bprofile\b.*\b(stats|ranking|career)\b/i.test(title)) return true;
  return false;
}

// A player who's also a mainstream celebrity (confirmed directly via a live
// test of a newly-tracked NFL player: Travis Kelce, whose Google News
// search returned mostly Taylor Swift relationship coverage from People,
// E! News, and Complex) gets real entertainment-gossip headlines that
// genuinely name him in the title — titleMentionsPlayer alone can't catch
// these, since the name really is there. Unlike looksLikeReferencePage,
// this isn't about the story being fake or templated; it's a real story,
// just not sports news. A denylist of unambiguous entertainment/gossip-only
// outlets (never legitimate sports sources, unlike a general tabloid that
// also covers real sports) closes this without touching titleMentionsPlayer.
const ENTERTAINMENT_PUBLISHERS = new Set([
  "people.com", "people", "e! news", "eonline.com", "complex", "tmz", "tmz.com",
  "us weekly", "usmagazine.com", "page six", "pagesix.com", "hollywood life",
  "hollywoodlife.com", "entertainment tonight", "etonline.com", "ok! magazine",
  "in touch weekly", "life & style", "sheknows",
]);

export function isEntertainmentPublisher(publisher: string | undefined): boolean {
  return publisher !== undefined && ENTERTAINMENT_PUBLISHERS.has(publisher.trim().toLowerCase());
}

// A real example caught live: Hindustan Times' "Neem Karoli Baba devotees
// Anushka Sharma, Virat Kohli, Julia Roberts to feature in Hanuman Ansh
// sequel? Producer reveals | Bollywood" — a real Bollywood casting story,
// not sports, from a legitimate general-news publisher (unlike the
// Kelce/Swift case above, Hindustan Times is NOT an entertainment-only
// outlet, so isEntertainmentPublisher can't catch this one). Cricketers who
// are also mainstream celebrities (Kohli is married to a Bollywood actress)
// draw this kind of coverage under their own name.
//
// Indian general-news publishers' Google News titles reliably carry a
// trailing "| {Section}" tag identifying the actual vertical — confirmed
// directly: the same outlets tag real cricket stories "| Cricket". A
// denylist of confirmed-non-sports section tags is much more reliable than
// guessing from title keywords, and — same false-positive discipline as
// looksLikeReferencePage/isEntertainmentPublisher above — only flags
// sections actually observed, rather than guessing at a broader pattern.
const NON_SPORTS_SECTION_TAGS = new Set(["bollywood", "entertainment", "movies", "lifestyle", "astrology"]);

export function hasNonSportsSectionTag(title: string): boolean {
  const match = title.match(/\|\s*([A-Za-z][A-Za-z\s&]{1,30})$/);
  if (!match) return false;
  return NON_SPORTS_SECTION_TAGS.has(match[1].trim().toLowerCase());
}

// Google's quoted-phrase search matches anywhere in a page's full crawled
// content, not just the headline — confirmed via a real example caught in
// production: today.com's "Theo James on Returning to 'The Gentlemen'
// Season 2" (a TV/entertainment piece, nothing to do with sports) got
// ingested tagged as football, because some tracked player's exact name
// apparently appeared somewhere in that page's full text (an ad, a related-
// content sidebar, anything) even though the actual story never mentions
// them. A genuinely relevant story about a player will almost always name
// them in the headline itself — requiring that directly rules out this
// class of full-page-text-only false match.
export function titleMentionsPlayer(title: string, searchTerms: string[]): boolean {
  const lower = title.toLowerCase();
  return searchTerms.some((term) => lower.includes(term.toLowerCase()));
}

// A popular player can return up to ~100 matches, with the same real-world
// event (e.g. a big transfer) independently covered by five-plus outlets at
// once (confirmed directly: Messi's Eldense purchase alone had ESPN, NYT,
// Yahoo, MLSsoccer.com and Al Jazeera all in the first 5 results). Capping
// per player keeps this closing the real gap it was built for — a player
// with zero coverage getting some — without flooding the review queue with
// near-duplicate coverage of the same single event for every popular name.
const MAX_ITEMS_PER_PLAYER = 5;

export async function fetchPlayerNews(): Promise<RawMatchItem[]> {
  const items: RawMatchItem[] = [];

  // Only the players picked for it (players.ts newsSearch) — most names are
  // tracked for tagging and pages alone.
  for (const player of TRACKED_PLAYERS.filter((p) => p.newsSearch !== false)) {
    try {
      const feed = await parser.parseURL(googleNewsSearchUrl(player.name));

      for (const entry of (feed.items ?? []).slice(0, MAX_ITEMS_PER_PLAYER)) {
        if (!entry.title || !entry.link) continue;

        const publisher = extractPublisher(entry);
        const sourceName = publisher ?? "Google News";
        const strippedTitle = stripPublisherSuffix(decodeHtmlEntities(entry.title), publisher);

        if (looksLikeReferencePage(strippedTitle, publisher, player.name)) continue;
        if (isEntertainmentPublisher(publisher)) continue;
        if (hasNonSportsSectionTag(strippedTitle)) continue;
        if (!titleMentionsPlayer(strippedTitle, player.searchTerms)) continue;

        items.push({
          title: strippedTitle,
          // Same "headline + attribution, no reproduced text" pattern as
          // every other RSS source (rssFeeds.ts) — see its comment for why.
          summary: `Full coverage from ${sourceName}. Read the original report at the source link below.`,
          sourceSnippet: entry.contentSnippet?.slice(0, 1200),
          sourceUrl: entry.link,
          sourceName,
          category: player.sport,
          publishedAt: entry.isoDate ? new Date(entry.isoDate) : new Date(),
          // We already know exactly who this story is about (it came from
          // their own name search) — runIngest.ts uses this to fetch a real
          // photo directly, without needing Gemini's commentary call to
          // succeed first. See RawMatchItem.knownPersonName.
          knownPersonName: player.name,
        });
      }
    } catch (err) {
      console.error(`Google News search failed for "${player.name}":`, err);
    }
  }

  return items;
}
