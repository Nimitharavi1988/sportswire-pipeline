// What the reel decision log can say about plays (2026-11-07): reels grouped by one feature at a time (voice, colour, layout, opening,
// photo or graphic, hook style, music, posting hour...) with how many plays each group got. Pure, so it can be tested; the script
// (scripts/reelFeatureReport.ts) supplies the rows. A group with fewer than MIN_GROUP reels is marked as noise.

export interface ReelRow {
  platform: string; // facebook | instagram | youtube
  destination: string; // main, cricketlive, es-reel...
  features: Record<string, unknown> | null;
  plays: number | null;
  watchSeconds: number | null;
}

export const MIN_GROUP = 8;

// The features worth comparing, each as a label and a function that reads its value from a row. A missing feature is "(not recorded)".
export const DIMENSIONS: { label: string; value: (r: ReelRow) => string }[] = [
  { label: "voice", value: (r) => (r.features?.voice ? "voiced" : "silent") },
  { label: "colour", value: (r) => text(r.features?.theme) },
  { label: "hook layout", value: (r) => text(r.features?.layout) },
  { label: "photo or graphic", value: (r) => (typeof r.features?.noPhoto !== "boolean" ? "(not recorded)" : r.features.noPhoto ? "graphic (no photo)" : "photo") },
  { label: "opening", value: (r) => text(r.features?.opening) },
  { label: "hook style", value: (r) => text(r.features?.hookStyle) },
  { label: "music", value: (r) => text(r.features?.music) },
  { label: "story type", value: (r) => text(r.features?.storyType) },
  { label: "posting hour (UTC)", value: (r) => hourBand(r.features?.hourUtc) },
  { label: "hook length", value: (r) => wordsBand(r.features?.hookWords) },
  { label: "platform", value: (r) => r.platform },
  { label: "page", value: (r) => r.destination },
];

function text(v: unknown): string {
  return typeof v === "string" && v !== "" ? v : "(not recorded)";
}
export function hourBand(h: unknown): string {
  if (typeof h !== "number") return "(not recorded)";
  if (h < 6) return "00-05";
  if (h < 12) return "06-11";
  if (h < 18) return "12-17";
  return "18-23";
}
export function wordsBand(n: unknown): string {
  if (typeof n !== "number") return "(not recorded)";
  return n <= 4 ? "1-4 words" : n <= 7 ? "5-7 words" : "8+ words";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Group {
  value: string;
  n: number;
  median: number | null;
  mean: number | null;
  watchSeconds: number | null;
  noisy: boolean;
}

// One dimension: a group per value, biggest first. Reels without a plays figure are left out (their numbers are not in yet).
export function groupBy(rows: ReelRow[], valueOf: (r: ReelRow) => string): Group[] {
  const by = new Map<string, ReelRow[]>();
  for (const r of rows) {
    if (r.plays === null) continue;
    const k = valueOf(r);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([value, g]) => {
      const plays = g.map((r) => r.plays as number);
      const watch = g.map((r) => r.watchSeconds).filter((w): w is number => w !== null);
      return {
        value,
        n: g.length,
        median: median(plays),
        mean: Math.round(plays.reduce((a, b) => a + b, 0) / plays.length),
        watchSeconds: watch.length ? Math.round((watch.reduce((a, b) => a + b, 0) / watch.length) * 10) / 10 : null,
        noisy: g.length < MIN_GROUP,
      };
    })
    .sort((a, b) => b.n - a.n);
}

export function formatReport(rows: ReelRow[]): string {
  const out: string[] = [`${rows.filter((r) => r.plays !== null).length} reels with a plays figure (of ${rows.length}).`, ""];
  for (const d of DIMENSIONS) {
    out.push(`By ${d.label}:`);
    for (const g of groupBy(rows, d.value)) {
      out.push(`  ${g.value.padEnd(22)} n=${String(g.n).padStart(4)}  median ${String(g.median ?? "-").padStart(6)}  mean ${String(g.mean ?? "-").padStart(6)}  watch ${g.watchSeconds ?? "-"}s${g.noisy ? "  (too few to trust)" : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}
