/**
 * Real photos of named athletes/officials, sourced from Wikimedia Commons —
 * used as a fallback tier ahead of the generic category stock photo, for RSS
 * stories that are centrally about one identifiable person (transfers,
 * retirements, etc.). Wikipedia's own non-free-content policy requires any
 * image on a living person's page to be freely licensed, which is what makes
 * this a legally safe source of real (not generic stock) photography.
 *
 * We still verify the license ourselves rather than trusting that policy
 * blindly — only Public Domain, CC0, CC-BY, CC-BY-SA, and GODL-India are
 * accepted; anything else is skipped. CC-BY/CC-BY-SA/GODL-India require
 * attribution, which is always shown (same pattern as the Pexels credit
 * line elsewhere). GODL-India (Government Open Data License – India) is
 * the license on official Indian government photos (e.g. PIB/PMO event
 * photos) hosted on Commons — confirmed directly (2026-09-12) via a real
 * Sanju Samson photo blocked by this list: attribution-only, free
 * commercial reuse, no share-alike restriction — the same shape as CC-BY,
 * just a different name.
 *
 * Docs: https://www.mediawiki.org/wiki/API:Main_page
 */

export interface StockImage {
  url: string;
  credit: string;
  creditUrl: string;
}

// Wikimedia's API etiquette policy asks for a descriptive User-Agent
// identifying the app, not a personal contact — see
// https://www.mediawiki.org/wiki/API:Etiquette
const USER_AGENT = "TheSportsWireLiveBot/1.0 (sports news aggregator)";

const FREE_LICENSE_PATTERN = /cc0|public domain|^pd$|cc[\s-]?by|godl-india/i;

export function isFreeLicense(licenseShortName: string): boolean {
  return FREE_LICENSE_PATTERN.test(licenseShortName);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function normalizeTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (é -> e, ñ -> n, etc.) before the ASCII-only filter below, rather than silently dropping the whole letter — confirmed live: "Hernández" was becoming "Hernndez", which then never matched the real Wikipedia title.
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2); // drop short particles ("de", "du", "of"...)
}

// Wikipedia's full-text search can return an unrelated page whose *content*
// merely mentions the query (e.g. a citation to an article the person wrote)
// rather than a page *about* them — especially for names with no dedicated
// article, like a journalist quoted as a source rather than the story's
// actual subject. Guard against silently attaching a stranger's photo by
// requiring the resolved title to actually contain the name we searched for.
export function titleMatchesName(title: string, name: string): boolean {
  const nameTokens = normalizeTokens(name);
  if (nameTokens.length === 0) return false;
  const titleTokens = new Set(normalizeTokens(title));
  return nameTokens.every((t) => titleTokens.has(t));
}

// One retry after a short pause — confirmed directly that plain transient
// network blips (not a real API error) were making fetchPersonPhoto return
// null intermittently even for a perfectly valid, existing page.
//
// A 429 is the exception: Wikimedia is telling us to back off, and retrying
// (previously 3x per call) multiplies the load that triggered it — the
// 2026-10-16 traffic spike produced ~970K Wikipedia calls in 10 hours. On 429
// we give up at once and pause all Wikimedia calls from this isolate for the
// Retry-After period (default 60s, capped at 5 min).
let wikiBackoffUntil = 0;

async function wikiFetch(url: string): Promise<any | null> {
  if (Date.now() < wikiBackoffUntil) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) : 60;
        wikiBackoffUntil = Date.now() + seconds * 1000;
        return null;
      }
      // A transient 5xx is retried rather than treated as a genuine
      // "not found" on the last attempt.
    } catch {
      // fall through to retry
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

function buildCredit(meta: any, fileName: string, kind: "Photo" | "Image"): { credit: string; creditUrl: string } | null {
  const licenseShortName: string = meta.LicenseShortName?.value ?? meta.License?.value ?? "";
  if (!isFreeLicense(licenseShortName)) return null;

  const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : "Unknown author";
  const isPublicDomain = /cc0|public domain|^pd$/i.test(licenseShortName);
  const credit = isPublicDomain
    ? `${artist} (Public domain), via Wikimedia Commons`
    : `${kind} by ${artist} (${licenseShortName}), via Wikimedia Commons`;
  const creditUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`;

  return { credit, creditUrl };
}

// Wikipedia's plain-name search returns whichever "Steve Smith" (etc.) is
// most globally notable, not the one this article is actually about — a real
// mismatch confirmed directly: a cricket story about the Australian batter
// Steve Smith was illustrated with the NFL wide receiver's photo, because his
// page outranks "Steve Smith (cricketer)" for the bare query. Appending the
// sport as a disambiguating term steers the search toward the right article
// (Wikipedia bios open with "is an Australian cricketer who...", so the term
// appears in the indexed text even when it's not literally in the title) —
// titleMatchesName still only requires the person's own name tokens, so the
// hint can only narrow the result, never cause a false accept on its own.
export function sportSearchHint(sport: "football" | "cricket" | "american-football" | "basketball" | "baseball" | string): string {
  if (sport.startsWith("cricket")) return "cricketer";
  if (sport.startsWith("american-football")) return "American football player";
  if (sport.startsWith("football")) return "footballer";
  // Missing entirely until now — basketball/baseball player-news items
  // (players.ts) were falling back to a bare-name Wikipedia search with no
  // disambiguating hint, and confirmed live: every single pending NBA
  // player-news item (Durant, Embiid, Tatum, etc.) got the generic Pexels
  // stock photo instead of a real Wikipedia photo, which blocks
  // auto-approval regardless of having a real body (see autoApprove.ts's
  // hasRealImage bar).
  if (sport.startsWith("basketball") || sport.startsWith("wnba")) return "basketball player";
  if (sport.startsWith("college-football")) return "American football player";
  if (sport.startsWith("baseball")) return "baseball player";
  if (sport.startsWith("hockey")) return "ice hockey player";
  if (sport.startsWith("formula-1")) return "racing driver";
  if (sport.startsWith("rugby")) return "rugby union player";
  if (sport.startsWith("athletics")) return "athlete";
  return "";
}

async function searchWikipediaTitle(query: string): Promise<string | undefined> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=1`;
  const searchData = await wikiFetch(searchUrl);
  return searchData?.query?.search?.[0]?.title;
}

// The sport-hint-boosted query (see sportSearchHint's own comment for why
// it exists — disambiguating names like "Steve Smith") can backfire for a
// sufficiently famous single-sport player: confirmed directly that
// "Lionel Messi footballer" ranks Wikipedia's "Messi–Ronaldo rivalry"
// article above Messi's own bio page, consistently, while the bare "Lionel
// Messi" query correctly returns his bio every time. Falling back to the
// hint-less query when the hinted one doesn't resolve to the person's own
// page (rather than giving up) recovers exactly this case without
// weakening the original disambiguation the hint was added for.
async function resolvePersonTitle(personName: string, sportHint?: string): Promise<string | null> {
  const hintedQuery = sportHint ? `${personName} ${sportHint}` : personName;
  const hintedTitle = await searchWikipediaTitle(hintedQuery);
  if (hintedTitle && titleMatchesName(hintedTitle, personName)) return hintedTitle;

  if (sportHint) {
    const plainTitle = await searchWikipediaTitle(personName);
    if (plainTitle && titleMatchesName(plainTitle, personName)) return plainTitle;
  }
  return null;
}

// Files that turn up in an article's `prop=images` list but aren't a real
// photo of the person — club crests, national flags, UI icons, locator
// maps, signatures — filtered out by filename before spending a license
// check on them.
const NON_PHOTO_FILENAME_PATTERN = /logo|icon|flag|crest|badge|shield|locator|_map|sportsbox|commons-logo|edit-|ambox|padlock|question_book|symbol|wiki-|signature/i;

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

// Every article about the same person used to get the exact same lead photo
// (the Wikipedia infobox image, from the pageimages call below) — confirmed
// live: repeated Haaland stories in "More headlines" all showing one
// identical picture. Pulls every real photo referenced anywhere on the
// person's Wikipedia page instead of just the lead image, so different
// articles about the same person can get different (but still real, still
// licensed) photos. Capped at 8 filename candidates and a single batched
// Commons imageinfo call, so this stays cheap despite checking several
// files instead of one.
async function fetchPersonPhotoVariants(title: string): Promise<StockImage[]> {
  const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title
  )}&prop=images&imlimit=50&format=json`;
  const imagesData = await wikiFetch(imagesUrl);
  const page: any = imagesData?.query?.pages ? Object.values(imagesData.query.pages)[0] : null;
  const fileTitles: string[] = (page?.images ?? [])
    .map((i: any) => i.title as string)
    .filter((t: string) => /\.(jpe?g|png)$/i.test(t) && !NON_PHOTO_FILENAME_PATTERN.test(t))
    .slice(0, 8);
  if (fileTitles.length === 0) return [];

  // One batched call for url + license + size on every candidate, instead
  // of one call per file.
  const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    fileTitles.join("|")
  )}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=300&format=json`;
  const infoData = await wikiFetch(infoUrl);
  const pages: any[] = infoData?.query?.pages ? Object.values(infoData.query.pages) : [];

  const variants: StockImage[] = [];
  for (const p of pages) {
    const info = p?.imageinfo?.[0];
    const meta = info?.extmetadata;
    // Skip anything too small to be a genuinely good hero-quality photo
    // (raised from 200 — confirmed live that a 200px-floor candidate from
    // this less-curated pool can still be an awkward crop, e.g. a wide
    // action shot with a second, unrelated person's face cut off at the
    // frame edge; a higher floor filters out more of the smaller,
    // more-likely-cropped-from-something-wider candidates, though it can't
    // catch every bad crop on resolution alone).
    if (!info || !meta || (info.width && info.width < 400)) continue;
    const fileName: string = String(p.title ?? "").replace(/^File:/, "");
    const licensed = buildCredit(meta, fileName, "Photo");
    if (!licensed) continue;
    variants.push({ url: info.thumburl ?? info.url, ...licensed });
  }
  return variants;
}

async function fetchCanonicalPersonPhoto(title: string): Promise<StockImage | null> {
  return fetchWikipediaPageImage(title, 300);
}

// A Wikipedia page's lead image at `width`, only when its Commons licence
// is free (with the credit to show). Used for player photos (300px, above)
// and venue pages (lib/venueDetails.ts).
export async function fetchWikipediaPageImage(title: string, width: number): Promise<StockImage | null> {
  // Wikipedia's own "page image" — a properly-sized thumbnail, not the
  // full original. Confirmed directly this was the site's single biggest
  // performance problem: original source files for these photos run 1-22MB
  // each, downloaded in full just to render a 32-120px avatar circle.
  // MediaWiki's own thumbnailing service (same CDN, properly compressed)
  // serves an appropriately-sized version instead — 300px covers every
  // current use on the site (up to 120px) with headroom for retina
  // displays.
  const imageUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title
  )}&prop=pageimages&piprop=thumbnail&pithumbsize=${width}&format=json`;
  const imageData = await wikiFetch(imageUrl);
  const page: any = imageData?.query?.pages ? Object.values(imageData.query.pages)[0] : null;
  const thumbnailUrl: string | undefined = page?.thumbnail?.source;
  if (!thumbnailUrl) return null;

  // Thumbnail URLs are shaped .../thumb/x/xx/FileName.ext/300px-FileName.ext
  // — the trailing segment is "{width}px-{realFileName}", not the actual
  // Commons file title, which the license lookup below needs.
  const thumbFileName = decodeURIComponent(thumbnailUrl.split("?")[0].split("/").pop() ?? "");
  const fileName = thumbFileName.replace(/^\d+px-/, "");
  if (!fileName) return null;

  // Verify the specific file's license on Commons — don't trust the page
  // image blindly.
  const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    "File:" + fileName
  )}&prop=imageinfo&iiprop=extmetadata&format=json`;
  const infoData = await wikiFetch(infoUrl);
  const infoPage: any = infoData?.query?.pages ? Object.values(infoData.query.pages)[0] : null;
  const meta = infoPage?.imageinfo?.[0]?.extmetadata;
  if (!meta) return null;

  const licensed = buildCredit(meta, fileName, "Photo");
  if (!licensed) return null;

  return { url: thumbnailUrl, ...licensed };
}

// `seed` (e.g. the article's own slug/title) picks a different real photo
// per article for the same person — without a seed (player profile pages,
// OG images), the single canonical lead photo is returned unchanged, same
// as before variants existed.
//
// The candidate pool for a seeded pick is the canonical lead photo PLUS
// fetchPersonPhotoVariants' broader "any image on the page" pool, not the
// broader pool alone — confirmed live that excluding the canonical photo
// entirely from rotation meant every seeded pick came from a less-curated
// source, including at least one genuinely bad crop (another person's face
// in frame). Wikipedia's own curated lead photo is generally the most
// reliably well-composed option available, so it deserves a real chance in
// the rotation, not just the "no seed" fallback case.
async function fetchPersonPhotoUncached(personName: string, sportHint?: string, seed?: string): Promise<StockImage | null> {
  try {
    // 1. Resolve the name to the best-matching Wikipedia article.
    const title = await resolvePersonTitle(personName, sportHint);
    if (!title) return null;

    if (seed) {
      const [canonical, variants] = await Promise.all([
        fetchCanonicalPersonPhoto(title),
        fetchPersonPhotoVariants(title),
      ]);
      const pool = canonical ? [canonical, ...variants] : variants;
      if (pool.length > 0) return pool[simpleHash(seed) % pool.length];
    }

    // 2. No seed, or the seeded pool came back empty — fall back to
    // Wikipedia's own curated lead photo.
    return await fetchCanonicalPersonPhoto(title);
  } catch (err) {
    console.error(`Wikimedia photo lookup failed for "${personName}":`, err);
    return null;
  }
}

// Fetches a SPECIFIC, already-known Commons file by exact title — unlike
// fetchPersonPhoto, there's no article search/resolution step, since flag
// filenames on Commons are curated by hand (see cricketCountries.ts) rather
// than looked up by name. Still verifies the license before use — flag
// *artwork* on Commons is virtually always public domain (national flags are
// official government symbols), but we don't assume that, same policy as
// every other image on this site.
export async function fetchCommonsFile(fileTitle: string): Promise<StockImage | null> {
  try {
    const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      "File:" + fileTitle
    )}&prop=imageinfo&iiprop=url|extmetadata&format=json`;
    const infoData = await wikiFetch(infoUrl);
    const infoPage: any = infoData?.query?.pages ? Object.values(infoData.query.pages)[0] : null;
    if (!infoPage || "missing" in infoPage) return null;

    const info = infoPage?.imageinfo?.[0];
    const url: string | undefined = info?.url;
    const meta = info?.extmetadata;
    if (!url || !meta) return null;

    const licensed = buildCredit(meta, fileTitle, "Image");
    if (!licensed) return null;

    return { url, ...licensed };
  } catch (err) {
    console.error(`Wikimedia file lookup failed for "${fileTitle}":`, err);
    return null;
  }
}

// Player photos barely change, but every page/OG-image render used to redo the
// 3-5 Wikimedia calls from scratch. Results (including "no photo") are kept in
// the Cloudflare edge cache (caches.default) plus a short per-isolate map; both
// are absent outside the Worker (ingest scripts, tests), where this is a plain
// pass-through. A null is cached only briefly since it can also mean a
// transient failure or a 429 backoff.
const PHOTO_TTL_S = 7 * 24 * 3600;
const PHOTO_MISS_TTL_S = 30 * 60;
const PHOTO_MEMO_TTL_S = 3600;
const photoMemo = new Map<string, { value: StockImage | null; expires: number }>();

export async function fetchPersonPhoto(personName: string, sportHint?: string, seed?: string): Promise<StockImage | null> {
  const key = `${personName}|${sportHint ?? ""}|${seed ?? ""}`;
  const memo = photoMemo.get(key);
  if (memo && memo.expires > Date.now()) return memo.value;

  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheReq = new Request(`https://photo-cache.internal/person?k=${encodeURIComponent(key)}`);
  try {
    const hit = await edge?.match(cacheReq);
    if (hit) {
      const value = (await hit.json()) as StockImage | null;
      photoMemo.set(key, { value, expires: Date.now() + PHOTO_MEMO_TTL_S * 1000 });
      return value;
    }
  } catch {
    // cache unavailable — fall through to a live lookup
  }

  const value = await fetchPersonPhotoUncached(personName, sportHint, seed);
  const ttl = value ? PHOTO_TTL_S : PHOTO_MISS_TTL_S;
  photoMemo.set(key, { value, expires: Date.now() + Math.min(ttl, PHOTO_MEMO_TTL_S) * 1000 });
  try {
    await edge?.put(
      cacheReq,
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` } })
    );
  } catch {
    // best effort
  }
  return value;
}
