/**
 * Which videos the Videos strip shows (pure, unit-tested). Same freshness
 * rule as the news sections — nothing older than a few days — and at most
 * a few per channel, so one busy channel (Sky Sports posts dozens a day)
 * can't fill the whole strip. Highlights go first: they're what a reader
 * came for after a game.
 */
export const VIDEO_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
// The /videos page is the library: a couple of weeks, so a reader can
// still find last weekend's highlights.
export const VIDEO_PAGE_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

export function splitLibrary<T extends { isHighlights: boolean }>(videos: T[]): { featured: T | null; highlights: T[]; latest: T[] } {
  const featured = videos.find((v) => v.isHighlights) ?? videos[0] ?? null;
  const rest = videos.filter((v) => v !== featured);
  return { featured, highlights: rest.filter((v) => v.isHighlights), latest: rest.filter((v) => !v.isHighlights) };
}

// A /videos search box entry -> the words to match (pure, unit-tested):
// lower-cased, up to 6, with LIKE wildcards stripped so "%" or "_" can't
// match everything. "vs"/"v" are dropped — titles write "IND vs WI",
// "#INDvWI" and "India v West Indies" alike, so names shorten to the codes
// fixture tags use ("ind" still matches "India").
export function videoSearchWords(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .replace(/[%_\\]/g, " ")
      .replace(/\bwest indies\b|\bwindies\b/g, "wi")
      .replace(/\bindia\b/g, "ind")
      .split(/[\s,]+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((w) => w.length > 0 && w !== "vs" && w !== "v")
  )].slice(0, 6);
}

export const MAX_PER_CHANNEL = 3;

// Channels re-upload old matches as new videos ("SASSUOLO-MILAN 2-0 | CLASSIC
// HIGHLIGHTS SERIE A 2025/26" appeared as a latest video on 2026-10-02): not
// news, and last season's scoreline reads as a current result.
const THROWBACK_TITLE = /\b(classic|throwback|rewind|archive|full match replay|on this day)\b/i;
export function isThrowbackTitle(title: string): boolean {
  return THROWBACK_TITLE.test(title);
}

export function pickVideoStrip<T extends { channelTitle: string; publishedAt: Date; isHighlights: boolean; title?: string }>(rows: T[], limit: number): T[] {
  const sorted = rows.filter((r) => !(r.title && isThrowbackTitle(r.title))).sort(
    (a, b) => Number(b.isHighlights) - Number(a.isHighlights) || b.publishedAt.getTime() - a.publishedAt.getTime()
  );
  const perChannel = new Map<string, number>();
  const picked: T[] = [];
  for (const row of sorted) {
    const count = perChannel.get(row.channelTitle) ?? 0;
    if (count >= MAX_PER_CHANNEL) continue;
    perChannel.set(row.channelTitle, count + 1);
    picked.push(row);
    if (picked.length === limit) break;
  }
  return picked;
}
