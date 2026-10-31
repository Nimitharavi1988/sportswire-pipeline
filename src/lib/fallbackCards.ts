// Branded fallback picture for a story that is real news but has no real photo (2026-10-31, trial on Football). A 3-day count found
// 598 football stories rejected, 302 of them "no real photo after 12h": Google News items arrive with no image and the site cannot open
// Google's redirect links to take the publisher's picture. The user's rule for the worst case: if the news is real, publish it anyway,
// with a plain card. The cards are static files in public/cards (scripts/makeFallbackCards.ts), a few variants per sport so a run of
// them does not look identical. Off unless FALLBACK_CARD_CATEGORIES lists the sport (e.g. "football"). Pure, unit-tested.

export const CARD_DIR = "/cards/";
export const CARD_VARIANTS = 4;
// Wait this long for a real photo (the person-photo lookup, a duplicate refresh) before falling back to a card.
export const FALLBACK_CARD_AFTER_HOURS = 4;

const SITE = "https://www.sportswirelive.com";

// Sports (category prefixes) that may use a card, from FALLBACK_CARD_CATEGORIES ("football" or "football,mma"). Empty = off.
export function fallbackCardCategories(env: Record<string, string | undefined> = process.env): string[] {
  return (env.FALLBACK_CARD_CATEGORIES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function cardAllowedFor(category: string, env: Record<string, string | undefined> = process.env): boolean {
  const top = category.toLowerCase();
  return fallbackCardCategories(env).some((c) => top === c || top.startsWith(c + "/"));
}

// A stable variant per story, so it never changes on a later run.
export function cardUrlFor(category: string, articleId: string, siteUrl: string = SITE): string {
  let h = 17;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const sport = category.toLowerCase().split("/")[0].replace(/[^a-z0-9-]/g, "");
  return `${siteUrl}${CARD_DIR}${sport}-${(h % CARD_VARIANTS) + 1}.png`;
}

// True for one of our own cards (any site host, so a preview or local URL counts too).
export function isFallbackCard(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const p = new URL(url).pathname;
    return p.startsWith(CARD_DIR) && /^\/cards\/[a-z0-9-]+-\d\.png$/.test(p);
  } catch {
    return false;
  }
}
