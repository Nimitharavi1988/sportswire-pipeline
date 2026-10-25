/**
 * Fetches ONE specific, already-known article page (its URL always comes
 * from an RSS entry or a Google News search hit we already have — never
 * discovered by crawling) and extracts (a) its main readable text, for use
 * as PRIVATE grounding input to commentary.ts's Gemini rewrite, and (b) the
 * publisher's own og:image, for use as the article's real, story-specific
 * heroImageUrl. Different governance for the two: the TEXT is never stored
 * or rendered anywhere — only Gemini's original rewritten prose becomes an
 * article's `body`, same discipline already applied to RSS `sourceSnippet`
 * everywhere else in this pipeline (see commentary.ts's header comment).
 * The IMAGE, by contrast, is meant to be shown, same as every other
 * publisher-provided image on this site — og:image exists specifically so a
 * publisher controls how their story looks when displayed by someone else
 * (a social share, an aggregator), the exact same category of signal as the
 * media:content/media:thumbnail RSS fields rssFeeds.ts already extracts,
 * just discovered via meta tag instead of RSS for sources whose feed
 * doesn't carry one (confirmed live: Google News' RSS carries zero image
 * data at all — a bare headline link, nothing else).
 *
 * Built specifically for two thin-content cases:
 *  - Player-news items (playerNewsFeeds.ts): Google News' RSS "snippet" for
 *    these is confirmed to be just the headline repeated verbatim — no real
 *    facts to ground a rewrite on, so these previously got no body at all,
 *    and (separately) no way to escape the same one static Wikipedia photo
 *    on every single article about that person.
 *  - Any RSS item whose own feed-provided snippet is too short to write a
 *    real piece from.
 *
 * Deliberately NOT a general crawler: one page per already-identified
 * article, capped by the same commentary budget as everything else,
 * robots.txt-checked first, and never attempting to bypass a paywall — a
 * blocked or unextractable page just means no grounding text/image, which
 * the caller treats the same as if this module didn't exist (fall back to
 * whatever thin snippet/generic photo is otherwise available).
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { decodeHtmlEntities } from "../htmlEntities";

const USER_AGENT = "TheSportsWireLiveBot/1.0 (sports news aggregator; reads one already-linked article for summarization)";

// Enough facts to ground a several-sentence rewrite without pulling in a
// publisher's entire article — this module is a grounding source, not a
// mirror of the page.
const MAX_EXTRACT_CHARS = 3000;

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Minimal robots.txt check: applies the most specific matching Disallow/Allow
// rule (longest path match wins, standard robots.txt semantics) from either
// our own UA's group or the wildcard group. No robots.txt, or a failure to
// fetch/parse one, defaults to allowed — same "absence of a restriction
// means no restriction" reading every well-behaved crawler uses.
export async function robotsAllows(url: string): Promise<boolean> {
  let origin: string;
  let pathname: string;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    pathname = parsed.pathname + parsed.search;
  } catch {
    return false;
  }

  const res = await fetchWithTimeout(`${origin}/robots.txt`, FETCH_TIMEOUT_MS);
  if (!res || !res.ok) return true;

  let text: string;
  try {
    text = await res.text();
  } catch {
    return true;
  }

  const ourUaGroup: { path: string; allow: boolean }[] = [];
  const wildcardGroup: { path: string; allow: boolean }[] = [];
  let currentGroups: { path: string; allow: boolean }[][] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [rawField, ...rest] = line.split(":");
    const field = rawField.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      if (value === "*") currentGroups = [wildcardGroup];
      else if (value.toLowerCase().includes("sportswirelive") || value.toLowerCase().includes("thesportswirelivebot")) {
        currentGroups = [ourUaGroup];
      } else {
        currentGroups = [];
      }
    } else if (field === "disallow" && value) {
      for (const group of currentGroups) group.push({ path: value, allow: false });
    } else if (field === "allow" && value) {
      for (const group of currentGroups) group.push({ path: value, allow: true });
    }
  }

  const rules = ourUaGroup.length > 0 ? ourUaGroup : wildcardGroup;
  let bestMatch: { path: string; allow: boolean } | null = null;
  for (const rule of rules) {
    if (pathname.startsWith(rule.path) && (!bestMatch || rule.path.length > bestMatch.path.length)) {
      bestMatch = rule;
    }
  }
  return bestMatch ? bestMatch.allow : true;
}

export interface ArticleExtraction {
  text: string;
  imageUrl?: string;
}

// og:image first — the standard, deliberate "this is how my page should
// look when shared" signal. twitter:image as a fallback for the rare page
// that sets one but not the other. Absolute URLs only — a relative path
// would need the page's own origin resolved in, and a malformed or
// data:-URI value here isn't worth the extra code to handle when simply
// skipping it (falls back to the generic photo, no different from a page
// with no image meta tags at all) is just as safe.
function extractOgImage(doc: Document): string | undefined {
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og && /^https?:\/\//.test(og)) return og;
  const twitter = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
  if (twitter && /^https?:\/\//.test(twitter)) return twitter;
  return undefined;
}

// Whether a URL actually serves an image (following redirects). A page's
// og:image isn't always one: FIVB's points at a WordPress attachment *page*
// (".../103432-jpeg/", text/html) — stored as the story's photo, it could
// never display (checked 2026-09-27). HEAD first; some servers refuse HEAD,
// so then a GET, dropped as soon as the headers arrive.
export async function isImageUrl(url: string): Promise<boolean> {
  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await fetch(url, { method, headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: controller.signal });
      const type = res.headers.get("content-type") ?? "";
      if (method === "GET") controller.abort();
      if (res.ok && type.startsWith("image/")) return true;
      if (res.ok && type) return false;
    } catch {
      // Try the next method.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

// Images on the page described by the story's own headline (alt text equal
// to the og:title or <h1>) — a page's lead photo, even outside the article
// text (FIVB's cover image sits in the page header). Read before Readability
// runs, which rewrites the document.
function headlineImages(doc: Document): string[] {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const titles = new Set([norm(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")), norm(doc.querySelector("h1")?.textContent)].filter(Boolean));
  return [...doc.querySelectorAll("img[src]")]
    .filter((img) => titles.has(norm(img.getAttribute("alt"))))
    .map((img) => (img as HTMLImageElement).src)
    .filter((src) => /^https?:\/\//.test(src))
    .slice(0, 2);
}

// The story's photo from its page: og:image / twitter:image when it really
// is an image, else the photo captioned with the headline, else the first
// real photo in the article body.
async function pickPageImage(doc: Document, articleHtml: string, titled: string[]): Promise<string | undefined> {
  const candidates: string[] = [];
  const meta = extractOgImage(doc);
  if (meta) candidates.push(decodeHtmlEntities(meta));
  candidates.push(...titled);
  for (const m of articleHtml.matchAll(/<img\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi)) {
    const src = decodeHtmlEntities(m[1]);
    if (!/gravatar|emoji|pixel|1x1|\.gif(\?|$)|\.svg(\?|$)|logo|avatar/i.test(src)) candidates.push(src);
    if (candidates.length >= 4) break;
  }
  for (const url of candidates) {
    if (await isImageUrl(url)) return url;
  }
  return undefined;
}

export async function extractArticleContent(url: string): Promise<ArticleExtraction | null> {
  const result = await extractArticleContentDetailed(url);
  return "failure" in result ? null : result;
}

// Same, but says why it failed ("http 403", "timeout or network error",
// "robots.txt disallows", ...) — stored as an article's rejectionReason,
// so a blocked source shows up as blocked instead of a silent rejection.
export async function extractArticleContentDetailed(url: string): Promise<ArticleExtraction | { failure: string }> {
  try {
    if (!(await robotsAllows(url))) return { failure: "robots.txt disallows" };

    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res) return { failure: "timeout or network error" };
    if (!res.ok) return { failure: `http ${res.status}` };

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return { failure: `not html (${contentType || "no content-type"})` };

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    const titled = headlineImages(document);
    const article = new Readability(document).parse();
    const text = article?.textContent?.trim();
    if (!text || text.length < 100) return { failure: "no article text found on page" };

    return { text: text.slice(0, MAX_EXTRACT_CHARS), imageUrl: await pickPageImage(document, article?.content ?? "", titled) };
  } catch (err) {
    console.error(`Article content extraction failed for "${url}":`, err);
    return { failure: `extraction error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}` };
  }
}
