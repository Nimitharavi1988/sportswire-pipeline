// Publisher advertising banners that arrive as a story's photo. The Hockey
// News (syndicated on Yahoo Sports) attaches its "Pick a free issue, subscribe
// today" magazine ad to some stories (found 2026-09-28, 16 published, several
// posted to Instagram and Facebook). Each copy has a different file name, so a
// URL block can't catch it; instead the picture is compared with the banner
// using a 64-bit difference hash (real photos scored 21+ of 64 bits away, the
// banner 0-7).
//
// Only fetched for The Hockey News' image path, so ingestion pays for a handful
// of small downloads, not one per story.

// Hashes are 64-character strings of 0/1 (hex below, one entry per banner).
const hexToBits = (hex: string) => hex.split("").map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
const PROMO_BANNER_HASHES = [
  hexToBits("07c958cceece4e23"), // "Pick a free issue when you subscribe today" (thn.com/free)
];
const MAX_DISTANCE = 10;
const cache = new Map<string, boolean>();

export function isPromoCheckedUrl(url: string): boolean {
  return /the_hockey_news/i.test(url);
}

export function hashDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export async function differenceHash(image: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const px = await sharp(image).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return bits;
}

// True when the photo is a known promo banner. Any failure (network, sharp
// missing) answers false: a normal story is never dropped because of a check.
export async function isPromoBannerImage(url: string): Promise<boolean> {
  if (!isPromoCheckedUrl(url)) return false;
  const known = cache.get(url);
  if (known !== undefined) return known;
  let result = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const hash = await differenceHash(Buffer.from(await res.arrayBuffer()));
      result = PROMO_BANNER_HASHES.some((banner) => hashDistance(banner, hash) <= MAX_DISTANCE);
    }
  } catch {
    result = false;
  }
  cache.set(url, result);
  return result;
}
