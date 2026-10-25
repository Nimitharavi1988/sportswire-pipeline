import { isMatchDataSource } from "./matchDataSources";

// Images that must never publish: publisher placeholders that look like a
// real photo but aren't one for the story. Exact URLs go in BLOCKED_IMAGE_URLS
// (query string and fragment ignored); a placeholder family that comes in many
// sizes/dates goes in BLOCKED_IMAGE_PATTERNS.
export const BLOCKED_IMAGE_URLS = new Set<string>();
export const BLOCKED_IMAGE_PATTERNS: RegExp[] = [
  // Hindustan Times' generic "SPORTS NEWS" placeholder (a stock cricket team
  // photo with the HT logo), sent for stories it has no picture for, e.g. the
  // 2026 Asian Games badminton report. Found 2026-09-28.
  /hindustantimes\.com\/.*\/logo\/ht-generic_/i,
];

// The Hockey News' stories syndicated through Yahoo Sports, recognisable by
// the image host path. Held out of Instagram (autoApprove.ts) from 2026-09-28:
// some arrive with the magazine's own "Pick a free issue, subscribe today"
// ad banner as the photo, which went out as Reels.
export function isHockeyNewsSyndicated(imageUrl: string | null): boolean {
  return Boolean(imageUrl && /the_hockey_news/i.test(imageUrl));
}

export function isImageUrlBlocked(imageUrl: string | null): boolean {
  if (!imageUrl) return false;
  return BLOCKED_IMAGE_URLS.has(imageUrl.split(/[?#]/)[0]) || BLOCKED_IMAGE_PATTERNS.some((p) => p.test(imageUrl));
}

// The single shared answer to "is this article good enough to publish" --
// relocated here 2026-09-20 from ingestion/autoApprove.ts (an odd home for
// something admin/actions.ts also needs to import) after a real incident:
// the admin bulk-approve actions had no quality check at all and published
// 310 articles in one shot, many well under the bar enforced everywhere
// else. Every path that can make an article live -- the automated
// auto-approve cron, admin bulk-approve, admin approve-all, and (as a
// visible warning, not a hard block) the single-article admin approve --
// should answer this question the same way, from one place, instead of
// each maintaining its own copy that can silently drift.

// Raised from 150 -- confirmed live that a couple of thin sentences was
// clearing the old bar even for genuinely low-value articles (compounded
// by Gemini's now-fixed tendency to pad thin source material with
// content-free filler instead of writing less -- see commentary.ts). 300
// gives real room for actual substance without being so strict that a
// genuinely short-but-real story (a brief injury update, a single
// confirmed transfer) gets unfairly rejected.
export const MIN_BODY_LENGTH = 300;
// Match-data preview/result templates ("Team A face Team B in MLB. First
// pitch is...") are inherently terse, factual, and already fully vetted (no
// extraction/scrape risk the way an arbitrary RSS body has) -- the same
// 150-char bar meant to catch a thin/garbled scrape was instead blocking
// genuinely complete MLB previews sitting at 135-149 chars. Confirmed live:
// every one of 16 pending MLB items was stuck on this alone.
export const MIN_MATCH_DATA_BODY_LENGTH = 80;

export function hasRealImage(article: { heroImageUrl: string | null; homeCrestUrl: string | null }): boolean {
  // A team crest pair is real by construction (never a stock photo).
  if (article.homeCrestUrl) return true;
  // A real photo — from the publisher's own RSS feed, a real player photo,
  // or a real match photo — as opposed to the generic category stock-photo
  // fallback (always served from Pexels; see stockImages.ts).
  if (article.heroImageUrl && !article.heroImageUrl.includes("pexels.com")) {
    // Confirmed live 2026-09-20: ESPN Cricinfo's RSS feed occasionally
    // supplies a media:content url that's just the bare domain
    // ("https://p.imgci.com", no path) for a handful of items -- the
    // upstream feed's own bug, faithfully carried through by
    // extractRssImage (rssFeeds.ts), which only checks the field is
    // non-empty. A bare domain isn't a real image (loading it 404s/shows
    // no photo on the article page and posted with no image to Facebook),
    // so it shouldn't count as one. A cheap synchronous pathname check
    // catches this without a network fetch.
    try {
      if (new URL(article.heroImageUrl).pathname.length <= 1) return false;
    } catch {
      return false;
    }
    return true;
  }
  return false;
}

export function isAutoApprovable(article: {
  body: string | null;
  heroImageUrl: string | null;
  homeCrestUrl: string | null;
  playerNewsSourced: boolean;
  sourceName: string;
}): boolean {
  // Reject articles with flagged image URLs that don't match content or are
  // from problematic sources. Checked before any other criteria so a known-bad
  // image blocks approval immediately, regardless of body quality.
  if (isImageUrlBlocked(article.heroImageUrl)) return false;

  // Match rows are structured scores, not stories: they don't need a photo
  // to be worth showing (a missing or broken team logo falls back to the
  // team's initials — components/TeamCrest.tsx). Requiring one held back
  // real fixtures whose provider has no logo for a team (e.g. ESPN's
  // Markhor v Sui Northern, 2026-09-26). Social posts still need a real
  // image — see autoApprove.ts.
  if (!isMatchDataSource(article.sourceName) && !hasRealImage(article)) return false;
  // Player-news items (playerNewsFeeds.ts) used to be judged on image alone,
  // since a body was structurally impossible for them — Google News' own
  // RSS snippet for these is just the headline repeated. That's no longer
  // true: runIngest.ts now grounds their commentary call in the real
  // article page's text instead (articleTextExtractor.ts), so they're held
  // to the same real-body bar as everything else. An item where extraction
  // was blocked (robots.txt) or failed simply stays in pending_review for a
  // human to look at, same as any other budget/extraction miss.
  const minLength = isMatchDataSource(article.sourceName) ? MIN_MATCH_DATA_BODY_LENGTH : MIN_BODY_LENGTH;
  return Boolean(article.body && article.body.trim().length >= minLength);
}
