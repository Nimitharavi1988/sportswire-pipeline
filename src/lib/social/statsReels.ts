// Match stats reels (pilot, 2026-11-13): after a big finished match, the match in numbers (matchStats.ts) goes out as a reel on the main account
// and on the sport's own Page: the Football Page for football, the US Sports Page for the NFL, basketball and hockey. Box scores are the stored
// copies (scores/matchDetail.ts), never a live ESPN call. Few per day by design (STATS_DAILY_CAP), so a Page's reel volume is not swamped. Run by
// dataReels.ts under the same DATA_REELS switch. College football and the WNBA are not covered yet (too many games a day to be selective).
import { db } from "@/db";
import { article, dataSnapshot, socialPost } from "@/db/schema";
import { and, eq, gte, inArray, like, sql } from "drizzle-orm";
import type { BoxScore } from "../scores/espnBoxScore";
import { BIG_FOOTBALL, STATS_DAILY_CAP, buildMatchStats, wantedSports, type StatsReel, type StatsSport } from "./matchStats";
import { renderStatsReel } from "./statsReel";
import { postDataReel } from "./postReel";
import { FOOTBALL_PAGE, US_SPORTS_PAGE, instagramPaused, type FacebookDestination } from "./facebookDestinations";
import { MAIN_REEL_DESTINATION } from "./reelDuplicates";

const PAGE_FOR: Partial<Record<StatsSport, FacebookDestination>> = { football: FOOTBALL_PAGE, "american-football": US_SPORTS_PAGE, basketball: US_SPORTS_PAGE, hockey: US_SPORTS_PAGE };
const MAX_PER_RUN = 2;

export async function loadStatsReels(now: Date): Promise<StatsReel[]> {
  const sports = [...wantedSports()].filter((s) => s in STATS_DAILY_CAP);
  if (sports.length === 0) return [];
  const rows = await db.select({
    id: article.id, category: article.category, home: article.homeTeam, away: article.awayTeam, hs: article.homeScore, as: article.awayScore,
    leagueLabel: article.leagueLabel, matchStatus: article.matchStatus, kickoffAt: article.kickoffAt, data: dataSnapshot.data,
  }).from(article)
    .innerJoin(dataSnapshot, eq(dataSnapshot.key, sql`'match-detail:' || ${article.id}`))
    .where(and(eq(article.matchStatus, "finished"), gte(article.kickoffAt, new Date(now.getTime() - 24 * 3_600_000)), inArray(article.category, sports)));
  const out: StatsReel[] = [];
  for (const r of rows) {
    const d = r.data as { kind?: string; final?: boolean; box?: BoxScore };
    if (d.kind !== "box" || !d.box || !r.home || !r.away) continue;
    if (r.category === "football" && !BIG_FOOTBALL.test(r.leagueLabel ?? "")) continue;
    const v = buildMatchStats({ category: r.category, home: r.home, away: r.away, homeScore: r.hs, awayScore: r.as, leagueLabel: r.leagueLabel, matchStatus: r.matchStatus, kickoffAt: r.kickoffAt, articleId: r.id, box: d.box, boxFinal: Boolean(d.final) }, now);
    if (v.ok) out.push(v.reel);
  }
  return out;
}

// Posts at most `room` reels (the shared daily cap, dataReelMode.ts) and returns how many it started.
export async function postStatsReels(now: Date, mode: "dry" | "on", room: number): Promise<number> {
  if (room <= 0) return 0;
  const reels = await loadStatsReels(now);
  if (reels.length === 0) return 0;
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayRows = await db.select({ category: article.category, articleId: socialPost.articleId, destination: socialPost.destination }).from(socialPost)
    .innerJoin(article, eq(socialPost.articleId, article.id))
    .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, MAIN_REEL_DESTINATION), inArray(socialPost.status, ["posted", "queued"]), gte(socialPost.createdAt, dayStart), like(article.matchKey, "%")));
  const postedBySport = new Map<string, number>();
  for (const t of todayRows) postedBySport.set(t.category, (postedBySport.get(t.category) ?? 0) + 1);
  let handled = 0;
  for (const r of reels) {
    if (handled >= Math.min(MAX_PER_RUN, room)) break;
    if ((postedBySport.get(r.sport) ?? 0) >= (STATS_DAILY_CAP[r.sport] ?? 0)) continue;
    const doneRows = await db.select({ destination: socialPost.destination, platform: socialPost.platform }).from(socialPost)
      .where(and(eq(socialPost.articleId, r.articleId), inArray(socialPost.status, ["posted", "queued"])));
    const page = PAGE_FOR[r.sport];
    const targets: { dest: FacebookDestination | undefined; key: string }[] = [{ dest: undefined, key: MAIN_REEL_DESTINATION }, ...(page ? [{ dest: page, key: `${page.key}-reel` }] : [])];
    const pending = targets.filter((t) => !doneRows.some((d) => d.destination === t.key && d.platform === "facebook"));
    if (pending.length === 0) continue;
    handled++;
    console.log(`[stats reel] ${r.sport}: ${r.hook} -> ${pending.map((p) => p.key).join(", ")}${mode === "dry" ? " [dry run, nothing posted]" : ""}`);
    if (mode === "dry") continue;
    let mp4: Buffer;
    try {
      mp4 = await renderStatsReel(r);
    } catch (err) {
      console.error("[stats reel] render failed:", err);
      continue;
    }
    let youtubeDone = doneRows.some((d) => d.platform === "youtube");
    for (const t of pending) {
      if (t.dest && !process.env[t.dest.tokenEnv]) continue;
      const igAllowed = !t.dest ? true : Boolean(t.dest.reels?.instagram && t.dest.instagramId && !instagramPaused(t.dest.key));
      try {
        const res = await postDataReel(r.articleId, mp4, { facebook: r.caption, instagram: r.caption }, r.hook, { instagram: igAllowed, facebook: true, youtube: !t.dest && !youtubeDone, topicPage: t.dest });
        console.log(`[stats reel] ${t.key}: instagram=${res.instagramPosted} facebook=${res.facebookPosted} youtube=${res.youtubePosted}`);
        if (res.youtubePosted) youtubeDone = true;
      } catch (err) {
        console.error(`[stats reel] ${t.key} failed:`, err);
      }
    }
  }
  return handled;
}
