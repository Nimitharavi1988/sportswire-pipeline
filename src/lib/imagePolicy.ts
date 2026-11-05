// Which pictures this site may show. Added 2026-11-04 after a Reuters photo (hotlinked from a news publisher's og:image) drew a
// licensing demand. A publisher's og:image / RSS image is a social-share preview, not a licence to reuse the picture, and many of them
// are Reuters / Getty / AP / AFP photos the publisher itself only licenses for its own site. Nothing the pipeline can see tells us
// reliably which ones, so the rule is an allowlist: only sources whose terms allow reuse (with the credit we already store), plus our
// own files. Everything else is dropped and the story falls back to the usual stock / person-photo / card path.

const ALLOWED_HOSTS = new Set([
  "images.pexels.com", // Pexels licence: free to use
  "upload.wikimedia.org", // Wikimedia Commons: free licences, credit kept (wikimediaImages.ts)
  "thumb.wikimedia.org",
  "commons.wikimedia.org",
  "sportswirelive.com", // our own files (fallback cards, generated posters)
  "www.sportswirelive.com",
]);

export function isLicensedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true; // our own relative path
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// The url when it may be shown, otherwise undefined.
export function licensedImageOrUndefined(url: string | null | undefined): string | undefined {
  return isLicensedImageUrl(url) ? (url as string) : undefined;
}
