// Branded fallback picture for a story that is real news but has no real photo (2026-10-31, trial on Football). A 3-day count found
// 598 football stories rejected, 302 of them "no real photo after 12h": Google News items arrive with no image and the site cannot open
// Google's redirect links to take the publisher's picture. The user's rule for the worst case: if the news is real, publish it anyway,
// with a plain card. The cards are static files in public/cards (scripts/makeFallbackCards.ts), a few variants per sport so a run of
// them does not look identical. Off unless FALLBACK_CARD_CATEGORIES lists the sport (e.g. "football"). Pure, unit-tested.

export const CARD_DIR = "/cards/";
export const CARD_VARIANTS = 4;
// Wait this long for a real photo (the person-photo lookup, a duplicate refresh) before falling back to a card. 4 h until 2026-11-07, then 1 h, then
// 10 minutes the same day: news is only fresh for hours (reels use 12), and the photo upgrade pass (autoApprove.ts) swaps in a real player photo later.
// A big story (isBigStory) does not wait at all.
export const FALLBACK_CARD_AFTER_MINUTES = 10;
export const FALLBACK_CARD_BIG_AFTER_MINUTES = 0;

// Whether a story is big enough to skip the wait: the highlight rule the homepage and Facebook posting already use (an event keyword or a tracked
// superstar in the headline, passed in as `highlightWorthy`) or a trending score at or above BIG_TRENDING_SCORE (reels start at 25-35).
export const BIG_TRENDING_SCORE = 35;
export const isBigStory = (highlightWorthy: boolean, trendingScore: number | null | undefined): boolean => highlightWorthy || (trendingScore ?? 0) >= BIG_TRENDING_SCORE;

// How long this story waits for a real photo before its card, in minutes.
export const cardWaitMinutes = (big: boolean): number => (big ? FALLBACK_CARD_BIG_AFTER_MINUTES : FALLBACK_CARD_AFTER_MINUTES);

// A story rejected only for having no photo is brought back while it is still news (autoApprove.ts reviveNoPhotoRejects).
export const REVIVE_WINDOW_HOURS = 36;
export const isNoPhotoRejection = (reason: string | null | undefined): boolean => /^no real photo after \d+h$/.test(reason ?? "");

// The upgrade pass (autoApprove.ts upgradeCardPhotos): stories this young with only a card get another try at their player's photo, at most
// MAX_UPGRADES_PER_RUN lookups per run, and a story that found nothing waits UPGRADE_RETRY_HOURS before the next try.
export const UPGRADE_WINDOW_HOURS = 48;
export const UPGRADE_RETRY_HOURS = 3;
export const MAX_UPGRADES_PER_RUN = 8;

const SITE = "https://www.sportswirelive.com";

// Sports (category prefixes) that may use a card, from FALLBACK_CARD_CATEGORIES ("football" or "football,mma"). Empty = off.
export function fallbackCardCategories(env: Record<string, string | undefined> = process.env): string[] {
  return (env.FALLBACK_CARD_CATEGORIES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function cardAllowedFor(category: string, env: Record<string, string | undefined> = process.env): boolean {
  const top = category.toLowerCase();
  return fallbackCardCategories(env).some((c) => top === c || top.startsWith(c + "/"));
}

// What kind of story a card should suit (2026-11-07), read from the headline alone: the kind sets the card's colour and its small symbol
// (scripts/makeCardKinds.ts). null = nothing clear, so the plain green card of the sport.
export const CARD_KINDS = ["result", "preview", "injury", "transfer", "record", "quote"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const KIND_VARIANTS = 2;
const KIND_PATTERNS: [CardKind, RegExp][] = [
  ["injury", /\b(injur\w*|ruled out|fitness|surgery|concussion|sidelined|hamstring|knee|ankle|recover\w*)\b/i],
  ["transfer", /\b(transfer\w*|signs?|signing|contract|extension|loan|joins?|deal|released?|trade[sd]?|free agent)\b/i],
  ["record", /\b(record|history|historic|milestone|century|hundred|ton|hat-?trick|first ever|fastest|highest|youngest|oldest)\b/i],
  ["quote", /\b(says?|said|reveals?|admits?|opens up|claims?|insists?|speaks?|warns?|hits? out|slams?)\b/i],
  ["result", /\b(beat|beats|defeat\w*|win|wins|won|victory|thriller|lose|loses|lost|edge[sd]?|clinch\w*|seal\w*|draw|drew|series)\b|\b\d{1,3}\s?[-–]\s?\d{1,3}\b/i],
  ["preview", /\b(preview|ahead of|to face|take on|prepare|set to|vs\.?|versus|will|could|how to watch|where to watch|squad|team news|lineup|predicted)\b/i],
];
export function cardKindFor(title: string): CardKind | null {
  for (const [kind, re] of KIND_PATTERNS) if (re.test(title)) return kind;
  return null;
}

// Flag-pair cards (2026-11-08): a cricket story that names two of these nations gets a card with both flags side by side
// (public/cards/flags-<a>-vs-<b>-1.png, made by scripts/makeFlagCards.ts, a and b in alphabetical order). The flags are Wikimedia Commons files.
export const FLAG_CARD_NATIONS = ["Australia", "Bangladesh", "England", "India", "Ireland", "Netherlands", "New Zealand", "Pakistan", "Scotland", "South Africa", "Sri Lanka", "Zimbabwe"];
export const nationSlug = (nation: string): string => nation.toLowerCase().split(" ").join("-");

// Whether the title has the word as a whole word (not inside another word, such as India inside Indiana).
function hasWord(title: string, word: string): number {
  let from = 0;
  while (from <= title.length - word.length) {
    const i = title.indexOf(word, from);
    if (i === -1) return -1;
    const before = i === 0 ? "" : title[i - 1];
    const after = title[i + word.length] ?? "";
    if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) return i;
    from = i + 1;
  }
  return -1;
}

// The first two different nations a headline names, in alphabetical order, or null when it names fewer than two.
export function flagPairFor(title: string): [string, string] | null {
  const found = FLAG_CARD_NATIONS.map((n) => ({ n, at: hasWord(title, n) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  if (found.length < 2) return null;
  return [found[0].n, found[1].n].sort((a, b) => nationSlug(a).localeCompare(nationSlug(b))) as [string, string];
}

export function flagCardUrl(pair: [string, string], siteUrl: string = SITE): string {
  return `${siteUrl}${CARD_DIR}flags-${nationSlug(pair[0])}-vs-${nationSlug(pair[1])}-1.png`;
}

// A stable variant per story, so it never changes on a later run. With the headline, a story that reads as a result, preview, injury and so on
// gets that kind's card (colour and symbol); a cricket story naming two nations gets their flag pair first; anything else keeps the sport's plain card.
export function cardUrlFor(category: string, articleId: string, siteUrl: string = SITE, title?: string): string {
  let h = 17;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const sport = category.toLowerCase().split("/")[0].replace(/[^a-z0-9-]/g, "");
  const pair = title && sport === "cricket" ? flagPairFor(title) : null;
  if (pair) return flagCardUrl(pair, siteUrl);
  const kind = title ? cardKindFor(title) : null;
  if (kind) return `${siteUrl}${CARD_DIR}${sport}-${kind}-${(h % KIND_VARIANTS) + 1}.png`;
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
