/**
 * IndexNow — a push protocol Bing, Yandex, Naver, Seznam, and Yep all watch
 * via one shared endpoint: instead of waiting for their crawlers to notice
 * a new article on their own schedule, we tell them the moment it's
 * actually live. Google doesn't participate in IndexNow (as of the time
 * this was built) — Search Console indexing is unaffected either way.
 *
 * Docs: https://www.indexnow.org/documentation
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// Best-effort only — same precedent as postArticleToFacebook (admin/actions.ts):
// a failed ping here should never block or fail the publish itself, since
// this is a nice-to-have distribution channel, not core functionality.
// siteUrl: the host the URLs belong to (default: the main site). The Spanish
// subdomain passes its own; the same key file is served on every host.
export async function submitToIndexNow(urls: string[], siteUrlOverride?: string): Promise<void> {
  const key = process.env.INDEXNOW_KEY;
  if (!key || urls.length === 0) return;

  const siteUrl = siteUrlOverride ?? process.env.SITE_URL ?? "http://localhost:3000";
  const host = new URL(siteUrl).host;

  try {
    await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl}/${key}.txt`,
        urlList: urls,
      }),
    });
  } catch (err) {
    console.error("IndexNow submission failed:", err);
  }
}

export function articleUrl(slug: string): string {
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/article/${slug}`;
}
