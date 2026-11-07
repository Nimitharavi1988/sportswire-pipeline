import { neon } from "@neondatabase/serverless";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { postDecision } from "@/db/schema";
import { formatReport, type ReelRow } from "@/lib/social/featureReport";

// What worked: reels grouped by voice, colour, hook layout, photo or graphic, opening, hook style, music, hour... with their plays.
// Reads only. Decisions come from this site's database (PostDecision); Facebook and Instagram plays come from the engagement bot's database
// (post_metric, ENGAGEMENT_DATABASE_URL), YouTube views from each Short's public watch page.
//   npx tsx --env-file=.env scripts/reelFeatureReport.ts          (DAYS=14 by default, MIN_AGE_HOURS=24: younger reels have not had their views yet)
const DAYS = Number(process.env.DAYS ?? 14);
const MIN_AGE_HOURS = Number(process.env.MIN_AGE_HOURS ?? 24);

async function youtubeViews(id: string): Promise<number | null> {
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const v = html.match(/"viewCount":"(\d+)"/)?.[1];
    return v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const olderThan = new Date(Date.now() - MIN_AGE_HOURS * 3_600_000);
  const decisions = (await db.select().from(postDecision)
    .where(and(inArray(postDecision.kind, ["reel", "short"]), eq(postDecision.outcome, "posted"), gte(postDecision.createdAt, since))))
    .filter((d) => d.externalPostId && d.createdAt <= olderThan);
  console.log(`${decisions.length} posted reels/Shorts from the last ${DAYS} days, at least ${MIN_AGE_HOURS} h old.`);

  // Facebook / Instagram: the latest snapshot per post (the reel id is the Facebook video id or the Instagram media id).
  const plays = new Map<string, { plays: number | null; watch: number | null }>();
  if (process.env.ENGAGEMENT_DATABASE_URL) {
    const sql = neon(process.env.ENGAGEMENT_DATABASE_URL);
    const rows = (await sql.query(
      `select distinct on (coalesce(video_id, post_id)) coalesce(video_id, post_id) as id, post_id, coalesce(plays, views, reach) as plays, avg_watch_ms
         from post_metric order by coalesce(video_id, post_id), taken_at desc`)) as { id: string; post_id: string; plays: number | null; avg_watch_ms: number | null }[];
    for (const r of rows) {
      const v = { plays: r.plays, watch: r.avg_watch_ms === null ? null : r.avg_watch_ms / 1000 };
      plays.set(r.id, v);
      plays.set(r.post_id, v);
    }
  } else {
    console.log("ENGAGEMENT_DATABASE_URL is not set: Facebook and Instagram reels have no plays figure and are left out.");
  }

  const rows: ReelRow[] = [];
  for (const d of decisions) {
    let p: { plays: number | null; watch: number | null } | undefined;
    if (d.platform === "youtube") p = { plays: await youtubeViews(d.externalPostId!), watch: null };
    else p = plays.get(d.externalPostId!);
    rows.push({ platform: d.platform, destination: d.destination, features: (d.features as Record<string, unknown> | null) ?? null, plays: p?.plays ?? null, watchSeconds: p?.watch ?? null });
  }
  console.log("\n" + formatReport(rows));
  console.log("Medians matter more than means (one big reel skews a mean). Reels recorded before 2026-11-07 have no hook layout or photo/graphic value.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
