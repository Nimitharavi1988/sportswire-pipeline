import { db } from "@/db";
import { article, postDecision, socialPost } from "@/db/schema";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

// Delivery watch: has each stream posted recently? Run hourly by .github/workflows/delivery-watch.yml, which FAILS
// (so GitHub emails you) when a stream has been silent longer than its window. It reads the database only and posts nothing.
//   npx tsx --env-file=.env scripts/deliveryWatch.ts
// The Spanish channel posts only 00:00-12:00 UTC (youtube.ts spanishShortsHours), so its window is a full day: 8 hours of silence in the evening is normal.
// Windows are set well beyond a normal quiet spell: main Instagram posted 3 to 4 an hour round the clock over
// 8 to 12 Oct, so 90 minutes of silence there is a real problem. The 6-hour ingest hang of 13 Oct would have been
// flagged after 90 minutes.
const MINUTES = 60_000;
const since = (m: number) => new Date(Date.now() - m * MINUTES);

interface Check { name: string; windowMin: number; count: () => Promise<number> }

const posted = (platform: "facebook" | "instagram" | "youtube", destinations: string[] | "not-es-reel", windowMin: number) => async () => {
  const dest = destinations === "not-es-reel" ? ne(socialPost.destination, "es-reel") : inArray(socialPost.destination, destinations);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(socialPost)
    .where(and(eq(socialPost.platform, platform), eq(socialPost.status, "posted"), dest, gte(socialPost.postedAt, since(windowMin))));
  return r?.n ?? 0;
};

const CHECKS: Check[] = [
  { name: "New stories ingested", windowMin: 90, count: async () => (await db.select({ n: sql<number>`count(*)::int` }).from(article).where(gte(article.createdAt, since(90))))[0]?.n ?? 0 },
  { name: "Main Facebook link posts", windowMin: 60, count: posted("facebook", ["main"], 60) },
  { name: "Main Facebook reels", windowMin: 180, count: posted("facebook", ["reel"], 180) },
  { name: "Main Instagram (posts + reels)", windowMin: 90, count: posted("instagram", ["main", "reel"], 90) },
  { name: "YouTube Shorts, English", windowMin: 480, count: posted("youtube", "not-es-reel", 480) },
  { name: "YouTube Shorts, Spanish", windowMin: 1440, count: posted("youtube", ["es-reel"], 1440) },
];

// Counts, not only silence (2026-11-13): reels in the last 24 hours against the Page's own average over the 7 days before, so a Page that
// posts a trickle instead of its usual flow is flagged too. LOW when the usual flow is at least 4 a day and the last 24 hours reached under half of it.
interface Stream { name: string; platform: "facebook" | "instagram" | "youtube"; destinations: string[] | "not-es-reel" }
const STREAMS: Stream[] = [
  { name: "Main Facebook reels", platform: "facebook", destinations: ["reel"] },
  { name: "Main Instagram reels", platform: "instagram", destinations: ["reel"] },
  { name: "YouTube Shorts, English", platform: "youtube", destinations: "not-es-reel" },
  { name: "Greenfield Facebook reels", platform: "facebook", destinations: ["india-cricket-reel"] },
  { name: "Cricket Live Facebook reels", platform: "facebook", destinations: ["cricketlive-reel"] },
  { name: "Football Page Facebook reels", platform: "facebook", destinations: ["football-reel"] },
  { name: "US Sports Page Facebook reels", platform: "facebook", destinations: ["us-sports-reel"] },
  { name: "Fight Page Facebook reels", platform: "facebook", destinations: ["fight-reel"] },
  { name: "Spanish Facebook reels", platform: "facebook", destinations: ["es-reel"] },
];
const MIN_USUAL_PER_DAY = 4;

async function countIn(st: Stream, from: Date, to: Date): Promise<number> {
  const dest = st.destinations === "not-es-reel" ? ne(socialPost.destination, "es-reel") : inArray(socialPost.destination, st.destinations);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(socialPost)
    .where(and(eq(socialPost.platform, st.platform), eq(socialPost.status, "posted"), dest, gte(socialPost.postedAt, from), lt(socialPost.postedAt, to)));
  return r?.n ?? 0;
}

async function volumeChecks(): Promise<string[]> {
  const low: string[] = [];
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * MINUTES);
  const weekAgo = new Date(now.getTime() - 8 * 24 * 60 * MINUTES);
  console.log("\nReels in the last 24 hours against the 7 days before (a day's average):");
  for (const st of STREAMS) {
    const last = await countIn(st, dayAgo, now);
    const usual = (await countIn(st, weekAgo, dayAgo)) / 7;
    const isLow = usual >= MIN_USUAL_PER_DAY && last < usual * 0.5;
    console.log(`${isLow ? "LOW    " : "ok     "} ${st.name.padEnd(32)} ${String(last).padStart(3)} in 24h   usual ${usual.toFixed(1).padStart(5)} a day`);
    if (isLow) low.push(`${st.name} (${last} in 24h, usually ${usual.toFixed(0)} a day)`);
  }
  return low;
}

// Why reels were not made or posted in the last 3 hours: the decision log's reasons, most common first, so an alert says where to look.
async function recentReasons(): Promise<void> {
  const rows = await db.select({ outcome: postDecision.outcome, reason: postDecision.reason, n: sql<number>`count(*)::int` }).from(postDecision)
    .where(and(inArray(postDecision.outcome, ["skipped", "failed"]), gte(postDecision.createdAt, since(180))))
    .groupBy(postDecision.outcome, postDecision.reason).orderBy(desc(sql`count(*)`)).limit(8);
  if (rows.length === 0) return;
  console.log("\nWhy reels were skipped or failed in the last 3 hours:");
  for (const r of rows) console.log(`  ${String(r.n).padStart(3)}  ${r.outcome}: ${(r.reason ?? "").slice(0, 110)}`);
}

async function main() {
  const silent: string[] = [];
  for (const c of CHECKS) {
    const n = await c.count();
    const label = c.windowMin >= 120 ? `${c.windowMin / 60}h` : `${c.windowMin} min`;
    console.log(`${n > 0 ? "ok     " : "SILENT "} ${c.name.padEnd(32)} ${String(n).padStart(3)} in the last ${label}`);
    if (n === 0) silent.push(`${c.name} (nothing in ${label})`);
  }
  const low = await volumeChecks();
  await recentReasons();
  if (silent.length || low.length) {
    console.error("\nDELIVERY GAP: " + [...silent, ...low.map((l) => "LOW: " + l)].join("; "));
    process.exit(1);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
