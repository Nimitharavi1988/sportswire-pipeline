import { db } from "@/db";
import { article, socialPost } from "@/db/schema";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";

// Delivery watch: has each stream posted recently? Run hourly by .github/workflows/delivery-watch.yml, which FAILS
// (so GitHub emails you) when a stream has been silent longer than its window. It reads the database only and posts nothing.
//   npx tsx --env-file=.env scripts/deliveryWatch.ts
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
  { name: "YouTube Shorts, Spanish", windowMin: 480, count: posted("youtube", ["es-reel"], 480) },
];

async function main() {
  const silent: string[] = [];
  for (const c of CHECKS) {
    const n = await c.count();
    const label = c.windowMin >= 120 ? `${c.windowMin / 60}h` : `${c.windowMin} min`;
    console.log(`${n > 0 ? "ok     " : "SILENT "} ${c.name.padEnd(32)} ${String(n).padStart(3)} in the last ${label}`);
    if (n === 0) silent.push(`${c.name} (nothing in ${label})`);
  }
  if (silent.length) {
    console.error(`\nDELIVERY GAP: ${silent.join("; ")}`);
    process.exit(1);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
