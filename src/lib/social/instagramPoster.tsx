import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PosterContent } from "@/lib/ingestion/commentary";
import { categoryChipStyle } from "@/lib/categoryDisplay";
import { ScoreBand } from "./scoreBand";
import type { ReelScore } from "./reelScore";

const WIKIMEDIA_USER_AGENT = "TheSportsWireLiveBot/1.0 (sports news aggregator)";

// Prefers the URL's own file extension over the server's Content-Type
// header — confirmed live that a real image response can carry a
// malformed, multi-value header ("application/octet-stream, image/webp"),
// silently breaking the image entirely when used in a data URI. Falls
// back to a clean single-value header, then a safe default.
function guessImageContentType(url: string, headerValue: string | null): string {
  const cleanPath = url.split("?")[0].toLowerCase();
  if (cleanPath.endsWith(".png")) return "image/png";
  if (cleanPath.endsWith(".webp")) return "image/webp";
  if (cleanPath.endsWith(".gif")) return "image/gif";
  if (cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg")) return "image/jpeg";

  const firstValue = headerValue?.split(",")[0]?.trim();
  if (firstValue && /^image\/[a-z0-9.+-]+$/i.test(firstValue)) return firstValue;

  return "image/jpeg";
}

// Article heroImageUrl is a 300px Wikimedia thumbnail (sized for a
// 32-120px avatar circle elsewhere on the site — see wikimediaImages.ts),
// visibly soft when stretched to fill a 1080px-wide poster background.
// Confirmed live: a pre-baked thumb.wikimedia.org URL only serves the
// exact width it was originally generated at — substituting a different
// width in the URL path returns a 400. Re-requesting the SAME file at a
// larger width live via Commons' own imageinfo API (as opposed to editing
// the already-generated URL) does work and returns a real, sharp
// thumbnail. Only applies to genuine Wikimedia thumbnail URLs; every other
// image source (Pexels, RSS-embedded photos, team crests) is used as-is.
async function resolveHighResUrl(url: string): Promise<string> {
  // Pexels photos are stored at a small h=/w= size; their CDN resizes on
  // request, so ask for one tall enough for a 1920px reel frame.
  if (url.startsWith("https://images.pexels.com/")) {
    const u = new URL(url);
    u.searchParams.delete("w");
    u.searchParams.set("h", "1920");
    return u.toString();
  }
  // Yahoo Sports wraps the publisher's photo in a resizer URL that serves it
  // shrunk (1200x675 WebP); the original sits percent-encoded at the end of the
  // path (1600x1067 in the case checked). Use it when it answers, so the reel
  // can qualify for the big-photo layout.
  const yahoo = url.match(/^https:\/\/s\.yimg\.com\/lo\/mysterio\/api\/[^/]+\/[^/]+\/[^/]+\/(https?%3A[^?]+)$/i);
  if (yahoo) {
    try {
      const original = decodeURIComponent(yahoo[1]);
      const head = await fetch(original, { method: "HEAD" });
      return head.ok ? original : url;
    } catch {
      return url;
    }
  }
  const match = url.match(/\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\/\d+px-/);
  if (!match) return url;
  const fileName = decodeURIComponent(match[1]);
  try {
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        "File:" + fileName
      )}&prop=imageinfo&iiprop=url&iiurlwidth=1080&format=json`,
      { headers: { "User-Agent": WIKIMEDIA_USER_AGENT } }
    );
    if (!res.ok) return url;
    const data = await res.json();
    const page: any = data?.query?.pages ? Object.values(data.query.pages)[0] : null;
    const thumburl: string | undefined = page?.imageinfo?.[0]?.thumburl;
    return thumburl ?? url;
  } catch {
    return url;
  }
}

// Fetches the story photo (at a higher resolution where possible) as a data
// URI for Satori. Shared with the reel renderer (reel.tsx).
export async function loadHeroImageDataUri(heroImageUrl: string): Promise<string> {
  const backgroundUrl = await resolveHighResUrl(heroImageUrl);

  // Inlined as a data URI — satori's own image loader can't reliably
  // resolve a remote URL directly (confirmed live: "Unsupported image
  // type" against a Wikimedia thumbnail URL it fetched itself).
  const bgImageRes = await fetch(backgroundUrl, {
    headers: { "User-Agent": "TheSportsWireLiveBot/1.0 (sports news aggregator)" },
  });
  const bgImageBuf = Buffer.from(await bgImageRes.arrayBuffer());
  // Confirmed live: a real photo's response returned a malformed,
  // multi-value Content-Type header ("application/octet-stream,
  // image/webp"), which broke Satori's image parser entirely (rendered
  // with no size/blank). The URL's own file extension is a much more
  // reliable signal than trusting an arbitrary server's header.
  const contentType = guessImageContentType(backgroundUrl, bgImageRes.headers.get("content-type"));
  return `data:${contentType};base64,${bgImageBuf.toString("base64")}`;
}

// Brand green (theme primary, brightened for a dark background) and the
// dark panel the photo fades into.
export const BRAND_GREEN = "#12a35e";
export const PANEL = "#0b1712";

// Headline size by length: short hooks read big, long ones still fit.
function hookSize(hook: string): number {
  if (hook.length <= 38) return 76;
  if (hook.length <= 60) return 66;
  return 56;
}

// Renders the Instagram poster (1080x1350) to a PNG: the story's photo in
// full colour over the top ~60%, fading into a dark panel with the sport
// tag and kicker, the hook headline, the key facts as stat cards, and a
// footer with the site address. Redesigned 2026-09-28 — the first version
// darkened and greyed the whole photo under an all-caps headline and a
// plain text table, which read as dull. Only ever run
// from a plain Node context (the GitHub Actions poster-post job) — next/og's
// ImageResponse (Satori + WASM) is a confirmed bad fit for Cloudflare
// Workers, so this must never be imported from anything the deployed app
// (a route/page) actually renders. See postInstagramPosterJob.ts.
export async function renderInstagramPoster(params: {
  content: PosterContent;
  heroImageUrl: string;
  // Sport category ("cricket", "football/world-cup") for the sport tag.
  category?: string;
  // Photo credit, shown small on the photo as on the site.
  credit?: string | null;
  // The score of the match the story is about (reelScore.ts), drawn over the photo; absent = no panel.
  score?: ReelScore | null;
}): Promise<Buffer> {
  const fontsDir = join(process.cwd(), "src/assets/fonts");
  const [bold, semibold] = await Promise.all([
    readFile(join(fontsDir, "Poppins-Bold.ttf")),
    readFile(join(fontsDir, "Poppins-SemiBold.ttf")),
  ]);

  const bgImage = await loadHeroImageDataUri(params.heroImageUrl);

  const { eyebrow, hook, rows } = params.content;
  const sport = params.category ? categoryChipStyle(params.category.split("/")[0]) : null;
  const stats = rows.slice(0, 3);
  const PHOTO_H = 820;

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", fontFamily: "Poppins", background: PANEL }}>
        {/* Photo, full colour, fading into the panel below. */}
        <img src={bgImage} width={1080} height={PHOTO_H} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover", objectPosition: "top" }} />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1080,
            height: PHOTO_H,
            display: "flex",
            background: `linear-gradient(180deg, rgba(11,23,18,0.5) 0%, rgba(11,23,18,0) 20%, rgba(11,23,18,0) 50%, rgba(11,23,18,0.85) 84%, ${PANEL} 100%)`,
          }}
        />

        {/* Top bar: wordmark and photo credit. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "44px 52px 0 52px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 32, fontWeight: 700, color: "white", padding: "10px 20px 10px 14px", borderRadius: 10, background: "rgba(11,23,18,0.78)" }}>
            <div style={{ display: "flex", width: 8, height: 36, background: BRAND_GREEN, borderRadius: 3, marginRight: 14 }} />
            <div style={{ display: "flex" }}>Sports Wire</div>
            <div style={{ display: "flex", color: BRAND_GREEN, marginLeft: 10 }}>Live</div>
          </div>
          {params.credit && (
            <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.8)", maxWidth: 440, marginTop: 10 }}>{params.credit}</div>
          )}
        </div>

        {params.score && (
          <div style={{ position: "absolute", top: 126, left: 52, display: "flex" }}>
            <ScoreBand score={params.score} width={600} />
          </div>
        )}

        <div style={{ display: "flex", flex: 1 }} />

        {/* Sport tag + kicker, then the headline. */}
        <div style={{ display: "flex", flexDirection: "column", padding: "0 52px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
            {sport && (
              <div style={{ display: "flex", padding: "6px 16px", borderRadius: 6, background: BRAND_GREEN, color: "white", fontSize: 24, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginRight: 16 }}>
                {sport.label}
              </div>
            )}
            <div style={{ display: "flex", color: "rgba(255,255,255,0.88)", fontSize: 26, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{eyebrow}</div>
          </div>
          <div style={{ display: "flex", color: "white", fontSize: hookSize(hook), fontWeight: 700, lineHeight: 1.12, letterSpacing: -0.5 }}>{hook}</div>
          <div style={{ display: "flex", width: 120, height: 8, borderRadius: 4, background: BRAND_GREEN, marginTop: 26 }} />
        </div>

        {/* Key facts as stat cards. */}
        {stats.length > 0 && (
          <div style={{ display: "flex", padding: "34px 52px 0 52px", position: "relative" }}>
            {stats.map((row, i) => (
              <div
                key={row.label + i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "18px 22px 20px 22px",
                  marginLeft: i === 0 ? 0 : 16,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.07)",
                  borderTop: `4px solid ${BRAND_GREEN}`,
                }}
              >
                <div style={{ display: "flex", color: "rgba(255,255,255,0.6)", fontSize: 20, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>{row.label}</div>
                <div style={{ display: "flex", color: "white", fontSize: stats.length === 3 ? 30 : 36, fontWeight: 700, lineHeight: 1.2 }}>{row.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer: where to read the full story. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "34px 52px 44px 52px", paddingTop: 22, borderTop: "1px solid rgba(255,255,255,0.14)", position: "relative" }}>
          <div style={{ display: "flex", color: "rgba(255,255,255,0.8)", fontSize: 26, fontWeight: 600 }}>Full story: link in bio</div>
          <div style={{ display: "flex", color: BRAND_GREEN, fontSize: 28, fontWeight: 700 }}>sportswirelive.com</div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [
        { name: "Poppins", data: bold, weight: 700, style: "normal" },
        { name: "Poppins", data: semibold, weight: 600, style: "normal" },
      ],
    }
  );

  return Buffer.from(await image.arrayBuffer());
}
