import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { categoryChipStyle } from "@/lib/categoryDisplay";

// A designed picture for an article, drawn entirely by us (no third-party photo): landscape 1200x630 for the site and link
// previews, or vertical 1080x1920 for reels / Shorts when a story has no usable photo. Six background styles (gradient and
// stripes, sport field markings, diagonal split with a big sport word, spotlight, halftone, bold block) picked per article from
// its id, so a run of stories never looks the same. The field markings are drawn per sport (pitch, cricket oval, gridiron,
// court, diamond, rink, tennis court). Optionally: an approved portrait (landscape only) with its credit, or an approved
// landscape photo full-bleed under a dark gradient. Same Poppins look as the Instagram poster (instagramPoster.tsx).
// Like that file it must only run from plain Node (the pipeline job): next/og is a bad fit for Cloudflare Workers.

export type HeroFormat = "landscape" | "vertical";
const SIZES: Record<HeroFormat, { w: number; h: number }> = { landscape: { w: 1200, h: 630 }, vertical: { w: 1080, h: 1920 } };
const PANEL = "#0b1712";
const GREEN = "#12a35e";
export const HERO_STYLE_COUNT = 6;

function hash(s: string): number {
  let h = 17;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function mix(hex: string, to: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(to);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Line art for each sport, drawn big and faint, centred at (cx, cy) with scale s (1 = about 900px wide).
function fieldArt(sport: string, cx: number, cy: number, s: number, op: number): string {
  const st = `fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${Math.max(3, Math.round(6 * s))}" stroke-linecap="round"`;
  const g = (inner: string) => `<g transform="translate(${cx} ${cy}) scale(${s})">${inner}</g>`;
  switch (sport) {
    case "football":
      return g(`<rect x="-450" y="-290" width="900" height="580" rx="6" ${st}/><line x1="0" y1="-290" x2="0" y2="290" ${st}/><circle cx="0" cy="0" r="82" ${st}/><rect x="-450" y="-150" width="130" height="300" ${st}/><rect x="320" y="-150" width="130" height="300" ${st}/><path d="M-320 -60 A70 70 0 0 1 -320 60" ${st}/><path d="M320 -60 A70 70 0 0 0 320 60" ${st}/>`);
    case "cricket":
      return g(`<ellipse cx="0" cy="0" rx="440" ry="300" ${st}/><ellipse cx="0" cy="0" rx="250" ry="170" ${st} stroke-dasharray="14 18"/><rect x="-26" y="-130" width="52" height="260" ${st}/><line x1="-60" y1="-120" x2="60" y2="-120" ${st}/><line x1="-60" y1="120" x2="60" y2="120" ${st}/>`);
    case "american-football":
    case "college-football":
      return g(`<rect x="-450" y="-250" width="900" height="500" ${st}/>${[-360, -270, -180, -90, 0, 90, 180, 270, 360].map((x) => `<line x1="${x}" y1="-250" x2="${x}" y2="250" ${st}/>`).join("")}${[-360, -180, 0, 180, 360].map((x) => `<line x1="${x}" y1="-30" x2="${x}" y2="30" ${st}/>`).join("")}`);
    case "basketball":
    case "wnba":
      return g(`<rect x="-450" y="-250" width="900" height="500" rx="6" ${st}/><line x1="0" y1="-250" x2="0" y2="250" ${st}/><circle cx="0" cy="0" r="70" ${st}/><rect x="-450" y="-90" width="190" height="180" ${st}/><rect x="260" y="-90" width="190" height="180" ${st}/><path d="M-260 -160 A180 180 0 0 1 -260 160" ${st}/><path d="M260 -160 A180 180 0 0 0 260 160" ${st}/>`);
    case "baseball":
      return g(`<path d="M0 -300 L300 0 L0 300 L-300 0 Z" ${st}/><path d="M-330 -330 A470 470 0 0 1 330 -330" ${st}/><circle cx="0" cy="0" r="24" ${st}/><rect x="-18" y="262" width="36" height="36" ${st}/><rect x="262" y="-18" width="36" height="36" ${st}/><rect x="-298" y="-18" width="36" height="36" ${st}/>`);
    case "hockey":
      return g(`<rect x="-450" y="-230" width="900" height="460" rx="110" ${st}/><line x1="0" y1="-230" x2="0" y2="230" ${st}/><circle cx="0" cy="0" r="60" ${st}/><line x1="-170" y1="-230" x2="-170" y2="230" ${st}/><line x1="170" y1="-230" x2="170" y2="230" ${st}/><circle cx="-260" cy="-90" r="46" ${st}/><circle cx="260" cy="90" r="46" ${st}/>`);
    case "tennis":
      return g(`<rect x="-400" y="-210" width="800" height="420" ${st}/><line x1="0" y1="-210" x2="0" y2="210" ${st}/><rect x="-400" y="-150" width="800" height="300" ${st}/><line x1="-200" y1="-150" x2="-200" y2="150" ${st}/><line x1="200" y1="-150" x2="200" y2="150" ${st}/><line x1="-200" y1="0" x2="200" y2="0" ${st}/>`);
    case "golf":
      return g(`<circle cx="0" cy="0" r="300" ${st}/><circle cx="0" cy="0" r="190" ${st}/><circle cx="0" cy="0" r="80" ${st}/><line x1="0" y1="0" x2="0" y2="-300" ${st}/><path d="M0 -300 L110 -260 L0 -220" ${st}/>`);
    case "formula-1":
    case "motogp":
      return g(`<path d="M-420 120 C-420 -40 -250 -200 -60 -200 C130 -200 150 -60 260 -60 C380 -60 430 -150 430 -90 C430 40 300 210 80 210 C-120 210 -170 120 -300 160 C-380 185 -420 190 -420 120 Z" ${st}/><line x1="-60" y1="-230" x2="-60" y2="-170" ${st}/>`);
    case "athletics":
    case "cycling":
      return g(`${[0, 1, 2, 3, 4].map((i) => `<rect x="${-440 + i * 24}" y="${-250 + i * 24}" width="${880 - i * 48}" height="${500 - i * 48}" rx="${250 - i * 24}" ${st}/>`).join("")}`);
    case "rugby":
      return g(`<rect x="-450" y="-250" width="900" height="500" ${st}/>${[-300, -150, 0, 150, 300].map((x) => `<line x1="${x}" y1="-250" x2="${x}" y2="250" ${st}/>`).join("")}<line x1="-450" y1="0" x2="450" y2="0" ${st} stroke-dasharray="10 16"/>`);
    default:
      return g(`<circle cx="0" cy="0" r="330" ${st}/><circle cx="0" cy="0" r="210" ${st}/><circle cx="0" cy="0" r="90" ${st}/>`);
  }
}

async function backgroundDataUri(color: string, seed: string, sport: string, label: string, w: number, h: number, styleOverride?: number): Promise<string> {
  const hv = hash(seed);
  const rnd = (n: number) => ((hv >>> (n * 3)) % 1000) / 1000;
  const style = styleOverride ?? hv % HERO_STYLE_COUNT;
  const c1 = mix(color, PANEL, 0.3), c2 = mix(color, PANEL, 0.9), cLight = mix(color, "#ffffff", 0.18);
  const minSide = Math.min(w, h);
  const scale = (Math.max(w, h) * (w > h ? 0.95 : 1.0)) / 900;
  const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><radialGradient id="r" cx="0.7" cy="0.3" r="0.8"><stop offset="0" stop-color="${cLight}"/><stop offset="0.45" stop-color="${c1}"/><stop offset="1" stop-color="${PANEL}"/></radialGradient></defs>`;
  const angle = 15 + Math.round(rnd(1) * 45);
  let body = "";
  if (style === 0) {
    const stripeW = 70 + Math.round(rnd(11) * 60);
    body += `<rect width="${w}" height="${h}" fill="url(#g)"/>` + Array.from({ length: 40 }, (_, i) => `<rect x="${i * stripeW * 2 - 600}" y="-600" width="${stripeW}" height="${h + 1200}" fill="#fff" fill-opacity="0.035" transform="rotate(${angle} ${w / 2} ${h / 2})"/>`).join("");
    for (let i = 0; i < 3; i++) body += `<circle cx="${Math.round(w * (0.5 + rnd(i + 2) * 0.6))}" cy="${Math.round(h * (-0.05 + rnd(i + 5) * 0.8))}" r="${Math.round(minSide * (0.22 + rnd(i + 8) * 0.35))}" fill="none" stroke="#fff" stroke-opacity="${0.05 + i * 0.015}" stroke-width="${16 + i * 8}"/>`;
  } else if (style === 1) {
    body += `<rect width="${w}" height="${h}" fill="url(#g)"/>` + fieldArt(sport, Math.round(w * (0.6 + rnd(2) * 0.15)), Math.round(h * (0.38 + rnd(3) * 0.2)), scale * (1.1 + rnd(4) * 0.4), 0.22);
  } else if (style === 2) {
    body += `<rect width="${w}" height="${h}" fill="${c2}"/><polygon points="${w * 0.35},0 ${w},0 ${w},${h} ${w * 0.05},${h}" fill="${c1}"/><polygon points="${w * 0.6},0 ${w},0 ${w},${h} ${w * 0.3},${h}" fill="${cLight}" fill-opacity="0.35"/>` +
      `<text x="${w * 0.98}" y="${h * 0.66}" text-anchor="end" font-family="Poppins, Arial, sans-serif" font-weight="800" font-size="${Math.round(minSide * (w > h ? 0.62 : 0.34))}" fill="#fff" fill-opacity="0.07">${label}</text>`;
  } else if (style === 3) {
    body += `<rect width="${w}" height="${h}" fill="url(#r)"/>` + fieldArt(sport, Math.round(w * 0.5), Math.round(h * 0.5), scale * 1.5, 0.12);
  } else if (style === 4) {
    const step = Math.round(minSide / 26);
    let dots = "";
    for (let x = step; x < w; x += step) for (let y = step; y < h; y += step) { const d = Math.max(0, 1 - Math.hypot(x - w * 0.85, y - h * 0.15) / (Math.max(w, h) * 0.9)); if (d > 0.08) dots += `<circle cx="${x}" cy="${y}" r="${(step * 0.42 * d).toFixed(1)}" fill="#fff" fill-opacity="0.16"/>`; }
    body += `<rect width="${w}" height="${h}" fill="url(#g)"/>${dots}`;
  } else {
    body += `<rect width="${w}" height="${h}" fill="url(#g)"/><rect x="0" y="0" width="${w > h ? 26 : 34}" height="${h}" fill="${cLight}"/>` + fieldArt(sport, Math.round(w * 0.74), Math.round(h * 0.45), scale * 1.0, 0.16) + `<rect x="0" y="${h - Math.round(h * 0.012)}" width="${w}" height="${Math.round(h * 0.012)}" fill="${cLight}" fill-opacity="0.7"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${defs}${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "data:image/png;base64," + png.toString("base64");
}

// Background art only (no text): used behind the reel and poster text when a story has no usable photo.
// colorOverride: a base colour instead of the sport's own, and styleOverride: one of the six styles instead of the seed's (the art cards for link
// posts and sport pages are tinted by story kind and use chosen styles, scripts/makeArtCards.ts).
export async function heroBackgroundJpeg(seed: string, category: string, w: number, h: number, colorOverride?: string, styleOverride?: number): Promise<Buffer> {
  const sport = category.split("/")[0];
  const chip = categoryChipStyle(sport);
  const uri = await backgroundDataUri(colorOverride ?? chip.color, seed, sport, chip.label.toUpperCase(), w, h, styleOverride);
  return sharp(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64")).jpeg({ quality: 90 }).toBuffer();
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/[\s,;:.-]+\S*$/, "") + "…";
}

function headlineSize(t: string, mode: "landscape" | "landscapePortrait" | "vertical"): number {
  const n = t.length;
  if (mode === "vertical") return n <= 45 ? 104 : n <= 80 ? 88 : n <= 110 ? 76 : 66;
  if (mode === "landscapePortrait") return n <= 45 ? 56 : n <= 80 ? 48 : 42;
  return n <= 45 ? 68 : n <= 80 ? 58 : n <= 110 ? 50 : 44;
}

export async function renderHeroGraphic(params: {
  id: string; // article id: seeds the background style
  title: string;
  summary?: string | null;
  category: string; // "cricket", "american-football", ...
  format?: HeroFormat;
  portraitDataUri?: string | null; // approved portrait (landscape only), already loaded
  backgroundPhotoDataUri?: string | null; // approved landscape photo, used full-bleed under a dark gradient
  credit?: string | null;
  style?: number; // force one of the six styles (tests / previews)
}): Promise<Buffer> {
  const format: HeroFormat = params.format ?? "landscape";
  const { w: W, h: H } = SIZES[format];
  const vertical = format === "vertical";
  const fontsDir = join(process.cwd(), "src/assets/fonts");
  const [bold, semibold] = await Promise.all([readFile(join(fontsDir, "Poppins-Bold.ttf")), readFile(join(fontsDir, "Poppins-SemiBold.ttf"))]);
  const sport = params.category.split("/")[0];
  const chip = categoryChipStyle(sport);
  const seed = params.style !== undefined ? params.id + "#" + params.style : params.id;
  let bg: string;
  if (params.style !== undefined) {
    // find a seed suffix that lands on the requested style
    let n = 0; let s2 = params.id;
    while (hash(s2) % HERO_STYLE_COUNT !== params.style && n < 500) { n++; s2 = params.id + "~" + n; }
    bg = await backgroundDataUri(chip.color, s2, sport, chip.label.toUpperCase(), W, H);
  } else {
    bg = await backgroundDataUri(chip.color, seed, sport, chip.label.toUpperCase(), W, H);
  }
  const hasPortrait = Boolean(params.portraitDataUri) && !vertical;
  const hasPhoto = Boolean(params.backgroundPhotoDataUri);
  const mode = vertical ? "vertical" : hasPortrait ? "landscapePortrait" : "landscape";
  const title = clip(params.title, vertical ? 120 : 140);
  const summary = params.summary ? clip(params.summary, vertical ? 150 : hasPortrait ? 110 : 150) : "";
  const pad = vertical ? 80 : 55;
  const textW = vertical ? W - pad * 2 : hasPortrait ? 700 : 1090;

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Poppins", background: PANEL }}>
        <img src={bg} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
        {hasPhoto && <img src={params.backgroundPhotoDataUri as string} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} />}
        {hasPhoto && <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", background: "linear-gradient(180deg, rgba(11,23,18,0.35) 0%, rgba(11,23,18,0.25) 30%, rgba(11,23,18,0.88) 78%, rgba(11,23,18,0.96) 100%)" }} />}
        {hasPortrait && (
          <div style={{ position: "absolute", top: 0, right: 0, width: 420, height: H, display: "flex" }}>
            <img src={params.portraitDataUri as string} width={420} height={H} style={{ objectFit: "cover", objectPosition: "top" }} />
            <div style={{ position: "absolute", top: 0, left: 0, width: 420, height: H, display: "flex", background: `linear-gradient(90deg, ${PANEL} 0%, rgba(11,23,18,0) 38%, rgba(11,23,18,0) 82%, rgba(11,23,18,0.7) 100%)` }} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: vertical ? W : textW + 55, height: H, padding: vertical ? `110px ${pad}px 120px ${pad}px` : "44px 0 40px 55px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: vertical ? 40 : 26, fontWeight: 700, color: "white", padding: vertical ? "12px 26px 12px 18px" : "8px 18px 8px 12px", borderRadius: 12, background: "rgba(11,23,18,0.62)" }}>
              <div style={{ display: "flex", width: vertical ? 10 : 7, height: vertical ? 46 : 30, background: GREEN, borderRadius: 3, marginRight: vertical ? 16 : 12 }} />
              <div style={{ display: "flex" }}>Sports Wire</div>
              <div style={{ display: "flex", color: GREEN, marginLeft: 8 }}>Live</div>
            </div>
            <div style={{ display: "flex", marginLeft: 16, padding: vertical ? "10px 24px" : "7px 16px", borderRadius: 8, background: chip.color, color: "white", fontSize: vertical ? 34 : 22, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{chip.label}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: vertical ? W - pad * 2 : textW }}>
            <div style={{ display: "flex", color: "white", fontSize: headlineSize(title, mode), fontWeight: 700, lineHeight: 1.12, letterSpacing: -0.5 }}>{title}</div>
            <div style={{ display: "flex", width: vertical ? 170 : 110, height: vertical ? 10 : 7, borderRadius: 5, background: GREEN, marginTop: vertical ? 40 : 24 }} />
            {summary && <div style={{ display: "flex", color: "rgba(255,255,255,0.84)", fontSize: vertical ? 40 : 26, fontWeight: 600, lineHeight: 1.3, marginTop: vertical ? 34 : 20 }}>{summary}</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: vertical ? W - pad * 2 : textW }}>
            <div style={{ display: "flex", color: GREEN, fontSize: vertical ? 40 : 26, fontWeight: 700 }}>sportswirelive.com</div>
            {params.credit && <div style={{ display: "flex", color: "rgba(255,255,255,0.65)", fontSize: vertical ? 22 : 15, fontWeight: 600, maxWidth: vertical ? 520 : 380, textAlign: "right" }}>{clip(params.credit, 70)}</div>}
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Poppins", data: bold, weight: 700, style: "normal" },
        { name: "Poppins", data: semibold, weight: 600, style: "normal" },
      ],
    }
  );
  return Buffer.from(await image.arrayBuffer());
}
