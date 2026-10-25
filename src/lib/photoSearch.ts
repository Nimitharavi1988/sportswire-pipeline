/**
 * Free, properly licensed photos for stories written in admin (the story
 * editor's "Find a photo"). Two free sources, no API key, plus Pexels (stock
 * photos, needs PEXELS_API_KEY in the environment; skipped without it):
 *
 * - Openverse (openverse.org, run by WordPress): searches Wikimedia Commons,
 *   Flickr and other open collections at once. Asked for commercially
 *   usable licences only.
 * - Wikimedia Commons directly: newer uploads Openverse hasn't indexed yet
 *   (checked 2026-09-27: "Greenfield stadium" found three recent CC BY-SA
 *   4.0 photos of the ground there).
 *
 * - Pexels (2026-10-06): generic stock sport photography (a cricket match, a
 *   stadium) for stories not about a named person. Titles start "Stock photo:"
 *   so nobody mistakes one for a photo of the event. The automatic draft
 *   picker never uses it (it takes Wikimedia Commons only).
 *
 * Only licences that allow commercial use and changes (resizing/cropping)
 * are offered: CC BY, CC BY-SA, CC0, public domain. Never non-commercial
 * (NC) or no-derivatives (ND). Every photo carries the credit its licence
 * requires — photographer, licence, source link — stored with the story
 * and shown under the photo.
 */
import { decodeHtmlEntities } from "./htmlEntities";

export type PhotoSourceId = "openverse" | "commons" | "pexels";

export interface PhotoResult {
  id: string;
  source: PhotoSourceId;
  title: string;
  creator: string;
  // "CC BY-SA 4.0", "CC0", "Public domain"
  license: string;
  // The photo's own page (shows the licence and the author).
  landingUrl: string;
  // The site it came from, as shown in the credit ("Wikimedia Commons", "Flickr").
  sourceName: string;
  thumbUrl: string;
  // A web-sized copy to import (not the multi-megabyte original).
  importUrl: string;
  width: number;
  height: number;
  credit: string;
}

const USER_AGENT = "SportsWireLive/1.0 (https://sportswirelive.com; contact@hyperianai.com)";
// Openverse allows at most 20 per page without an account.
const PER_SOURCE = 20;
// Narrower than this looks soft as a story's main photo (shown ~700px wide).
export const MIN_PHOTO_WIDTH = 640;
// Width of the copy imported. Wikimedia only renders standard thumbnail
// widths (960, 1280, 1920 work; 1600 answers 400 — checked 2026-09-27).
export const IMPORT_WIDTH = 1280;

// Openverse licence codes we accept -> label. Anything else (nc, nd,
// sampling) is left out.
const OPENVERSE_LICENSES: Record<string, (version: string) => string> = {
  by: (v) => `CC BY ${v}`.trim(),
  "by-sa": (v) => `CC BY-SA ${v}`.trim(),
  cc0: () => "CC0",
  pdm: () => "Public domain",
};

const SOURCE_NAMES: Record<string, string> = {
  wikimedia: "Wikimedia Commons",
  flickr: "Flickr",
  geographorguk: "Geograph",
  wordpress: "WordPress Photo Directory",
  nappy: "Nappy",
  rawpixel: "rawpixel",
};

export function isPublicDomain(license: string): boolean {
  return /^(cc0|public domain)$/i.test(license);
}

// The credit shown under the photo: author, licence, source.
export function photoCredit(creator: string, license: string, sourceName: string): string {
  const who = creator.trim() || "Unknown author";
  return isPublicDomain(license) ? `${who} (${license}), via ${sourceName}` : `Photo by ${who} (${license}), via ${sourceName}`;
}

// Commons licence names we accept (Commons itself only hosts free
// licences, but NC/ND/"fair use" files are excluded to be safe).
export function isCommercialFreeLicense(name: string): boolean {
  if (/\b(nc|nd)\b|non-?commercial|no-?deriv|fair use/i.test(name)) return false;
  return /^(cc[\s-]?by(-sa)?\b|cc0|public domain|pd\b)/i.test(name.trim());
}

// Tags out, then entities decoded: Commons' Artist field is HTML, so a name
// like "Maize & Blue Nation" arrives as "Maize &amp; Blue Nation" and was
// stored in the credit that way (found 2026-10-04).
function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// A Wikimedia thumbnail URL at another width (".../400px-File.jpg" ->
// ".../1600px-File.jpg"); unchanged if it isn't one.
export function commonsThumbAt(url: string, width: number): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`);
}

interface OpenverseImage {
  id: string;
  title?: string;
  creator?: string;
  license: string;
  license_version?: string;
  foreign_landing_url?: string;
  url: string;
  thumbnail?: string;
  source?: string;
  width?: number;
  height?: number;
  mature?: boolean;
}

// One Openverse result -> PhotoResult, or null when its licence isn't one
// we accept (pure, unit-tested).
export function fromOpenverse(r: OpenverseImage): PhotoResult | null {
  const label = OPENVERSE_LICENSES[r.license];
  if (!label || r.mature || !r.foreign_landing_url || !r.width || !r.height) return null;
  const license = label(r.license_version ?? "");
  const sourceName = SOURCE_NAMES[r.source ?? ""] ?? r.source ?? "Openverse";
  // Openverse passes on what the source site had, entities included.
  const creator = decodeHtmlEntities(r.creator ?? "").trim() || "Unknown author";
  // Wikimedia originals can be 20+ MB; import a web-sized rendition.
  const wikimediaThumb = r.url.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(\w)\/(\w\w)\/([^/?#]+)$/);
  const importUrl = wikimediaThumb
    ? `https://upload.wikimedia.org/wikipedia/commons/thumb/${wikimediaThumb[1]}/${wikimediaThumb[2]}/${wikimediaThumb[3]}/${IMPORT_WIDTH}px-${wikimediaThumb[3]}`
    : r.url;
  return {
    id: `openverse:${r.id}`,
    source: "openverse",
    title: decodeHtmlEntities(r.title ?? "").trim() || "Untitled",
    creator,
    license,
    landingUrl: r.foreign_landing_url,
    sourceName,
    thumbUrl: r.thumbnail ?? r.url,
    importUrl: wikimediaThumb && r.width <= IMPORT_WIDTH ? r.url : importUrl,
    width: r.width,
    height: r.height,
    credit: photoCredit(creator, license, sourceName),
  };
}

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: {
    width: number;
    height: number;
    mime: string;
    thumburl?: string;
    url: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

// One Commons search result -> PhotoResult, or null (pure, unit-tested).
export function fromCommons(p: CommonsPage): PhotoResult | null {
  const info = p.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime) || !info.thumburl) return null;
  const meta = info.extmetadata ?? {};
  const license = (meta.LicenseShortName?.value ?? "").trim();
  if (!isCommercialFreeLicense(license)) return null;
  const creator = stripHtml(meta.Artist?.value ?? "") || "Unknown author";
  const label = /^pd\b|public domain/i.test(license) ? "Public domain" : license;
  const sourceName = "Wikimedia Commons";
  return {
    id: `commons:${p.pageid}`,
    source: "commons",
    title: stripHtml(meta.ObjectName?.value ?? "") || p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
    creator,
    license: label,
    landingUrl: info.descriptionurl,
    sourceName,
    thumbUrl: info.thumburl,
    importUrl: info.width > IMPORT_WIDTH ? commonsThumbAt(info.thumburl, IMPORT_WIDTH) : info.url.split("?")[0],
    width: info.width,
    height: info.height,
    credit: photoCredit(creator, label, sourceName),
  };
}

// Whether a photo address really serves an image. A search index can list a
// file that has since been deleted from the source (the Openverse entry for
// "Tetairoa McMillan.jpeg" outlived the Commons file, 2026-10-06), and a story
// published with it shows a broken image. HEAD first, then a one-byte GET for
// servers that refuse HEAD.
export async function photoReachable(url: string): Promise<boolean> {
  const headers = { "User-Agent": USER_AGENT };
  const isImage = (res: Response) => res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
  try {
    const head = await fetch(url, { method: "HEAD", headers, redirect: "follow" });
    if (isImage(head)) return true;
    if (head.status !== 405 && head.status !== 403) return false;
    return isImage(await fetch(url, { headers: { ...headers, Range: "bytes=0-0" }, redirect: "follow" }));
  } catch {
    return false;
  }
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer?: string;
  alt?: string;
  src: { original?: string; large2x?: string; large?: string; medium?: string };
}

// One Pexels result -> PhotoResult (pure, unit-tested). The Pexels licence
// allows free commercial use and changes; it names the photographer as a courtesy.
export function fromPexels(p: PexelsPhoto): PhotoResult | null {
  const importUrl = p.src.large2x ?? p.src.large ?? p.src.original;
  if (!importUrl || !p.url || !p.width || !p.height) return null;
  const creator = (p.photographer ?? "").trim() || "Unknown author";
  const alt = (p.alt ?? "").replace(/\s+/g, " ").trim();
  return {
    id: `pexels:${p.id}`,
    source: "pexels",
    title: `Stock photo: ${alt || "Pexels photo"}`,
    creator,
    license: "Pexels License",
    landingUrl: p.url,
    sourceName: "Pexels",
    thumbUrl: p.src.medium ?? p.src.large ?? importUrl,
    importUrl,
    width: p.width,
    height: p.height,
    credit: photoCredit(creator, "Pexels License", "Pexels"),
  };
}

// Generic stock photos. Without PEXELS_API_KEY this source is simply absent.
export async function searchPexels(query: string): Promise<PhotoResult[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ query, per_page: String(PER_SOURCE), orientation: "landscape" });
  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, { headers: { Authorization: key, "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`api.pexels.com answered ${res.status}`);
  const data = (await res.json()) as { photos?: PexelsPhoto[] };
  return (data.photos ?? []).flatMap((p) => fromPexels(p) ?? []);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

export async function searchOpenverse(query: string): Promise<PhotoResult[]> {
  const params = new URLSearchParams({ q: query, license_type: "commercial", page_size: String(PER_SOURCE), mature: "false" });
  const data = (await getJson(`https://api.openverse.org/v1/images/?${params}`)) as { results?: OpenverseImage[] };
  return (data.results ?? []).flatMap((r) => fromOpenverse(r) ?? []);
}

export async function searchCommons(query: string): Promise<PhotoResult[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(PER_SOURCE),
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "400",
    iiextmetadatafilter: "LicenseShortName|Artist|ObjectName",
    origin: "*",
  });
  const data = (await getJson(`https://commons.wikimedia.org/w/api.php?${params}`)) as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((p) => fromCommons(p) ?? []);
}

// Identity for de-duplicating across sources: a Wikimedia file by its file
// name (Openverse and Commons link to different pages for the same file),
// anything else by its page (pure, unit-tested).
export function photoKey(r: Pick<PhotoResult, "importUrl" | "landingUrl">): string {
  if (/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(r.importUrl)) {
    const name = decodeURIComponent(r.importUrl.split(/[?#]/)[0].split("/").pop() ?? "").replace(/^\d+px-/, "");
    return `commons:${name.replace(/ /g, "_").toLowerCase()}`;
  }
  return r.landingUrl.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").toLowerCase();
}

// All sources, Commons first (most specific), Pexels stock last, duplicates (the same
// Commons file found by both) dropped; landscape photos — the shape a story
// photo is shown in — before portrait ones. A failing source is reported,
// not fatal.
export async function searchPhotos(query: string): Promise<{ results: PhotoResult[]; failed: string[] }> {
  const [commons, openverse, pexels] = await Promise.allSettled([searchCommons(query), searchOpenverse(query), searchPexels(query)]);
  const failed: string[] = [];
  const lists: PhotoResult[][] = [];
  for (const [name, r] of [["Wikimedia Commons", commons], ["Openverse", openverse], ["Pexels", pexels]] as const) {
    if (r.status === "fulfilled") lists.push(r.value);
    else {
      failed.push(name);
      console.error(`Photo search: ${name} failed:`, r.reason);
    }
  }
  const seen = new Set<string>();
  const results: PhotoResult[] = [];
  for (const r of lists.flat()) {
    if (r.width < MIN_PHOTO_WIDTH) continue;
    const key = photoKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }
  const landscape = (r: PhotoResult) => (r.width >= r.height ? 0 : 1);
  return { results: results.map((r, i) => ({ r, i })).sort((a, b) => landscape(a.r) - landscape(b.r) || a.i - b.i).map((x) => x.r), failed };
}
