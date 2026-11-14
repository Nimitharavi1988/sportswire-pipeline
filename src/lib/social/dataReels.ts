// Data reels (pilot, 2026-11-13): after a finished match of a cricket series, a chart of the series so far goes out as a reel on the main account
// and on Greenfield and Cricket Live (the English YouTube channel once, from the main run). Built from stored ESPN Cricket rows by seriesTracker.ts
// with accuracy checks; a series that does not check out is skipped. DATA_REELS: "off" (default, nothing happens), "dry" (renders nothing, logs what
// would go out) or "on". Data reels are extra to the Pages' daily reel caps (about one chart per match per Page).
import { db } from "@/db";
import { article, socialPost } from "@/db/schema";
import { and, count, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { renderChartReel } from "./chartReel";
import { buildSeriesChart, groupBySeries, type SeriesChart, type SeriesRow } from "./seriesTracker";
import { postDataReel } from "./postReel";
import { postStatsReels } from "./statsReels";
import { wantedSports } from "./matchStats";
import { CRICKETLIVE_PAGE, INDIA_CRICKET_PAGE, instagramPaused, type FacebookDestination } from "./facebookDestinations";
import { MAIN_REEL_DESTINATION } from "./reelDuplicates";

import { dataReelMode, dataReelRoom } from "./dataReelMode";

const MAX_AGE_HOURS = 24;
const MAX_CHARTS_PER_RUN = 2;
const WINDOW_DAYS = 60;

async function loadRows(now: Date): Promise<SeriesRow[]> {
  const r = await db.select({
    id: article.id, sourceUrl: article.sourceUrl, homeTeam: article.homeTeam, awayTeam: article.awayTeam, homeScoreText: article.homeScoreText,
    awayScoreText: article.awayScoreText, matchStatus: article.matchStatus, matchNote: article.matchNote, kickoffAt: article.kickoffAt, leagueLabel: article.leagueLabel,
  }).from(article)
    .where(and(eq(article.category, "cricket"), eq(article.sourceName, "ESPN Cricket"), gte(article.kickoffAt, new Date(now.getTime() - WINDOW_DAYS * 86_400_000))));
  return r.filter((x) => x.sourceUrl.includes("/cricket/series/"));
}

export async function postDataReels(now: Date = new Date()): Promise<void> {
  const mode = dataReelMode();
  if (mode === "off") return;
  // One shared daily cap for stats and chart reels (dataReelMode.ts DATA_REELS_DAILY_CAP), counted as today's main-Page Facebook posts of
  // match-data stories (stats reels and chart reels are both posted against a match row; a match row's ordinary reel counts too, which
  // only errs on the side of fewer).
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const [{ n: usedToday }] = await db.select({ n: count() }).from(socialPost).innerJoin(article, eq(socialPost.articleId, article.id))
    .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, MAIN_REEL_DESTINATION), inArray(socialPost.status, ["posted", "queued"]), gte(socialPost.createdAt, dayStart), isNotNull(article.matchKey)));
  let room = dataReelRoom(Number(usedToday));
  if (room === 0) { console.log(`[data reel] daily cap reached (${usedToday} today)`); return; }
  // Match stats reels for the other major sports (statsReels.ts), under the same switch.
  room -= await postStatsReels(now, mode, room).catch((err) => { console.error("[stats reel] failed:", err); return 0; });
  if (room <= 0 || !wantedSports().has("cricket")) return;
  const rows = await loadRows(now);
  const charts: SeriesChart[] = [];
  for (const g of groupBySeries(rows).values()) {
    const v = buildSeriesChart(g.rows, g.format, now, MAX_AGE_HOURS);
    if (v.ok) charts.push(v.chart);
  }
  if (charts.length === 0) return;
  const targets: { dest: FacebookDestination | undefined; key: string }[] = [
    { dest: undefined, key: MAIN_REEL_DESTINATION },
    { dest: INDIA_CRICKET_PAGE, key: `${INDIA_CRICKET_PAGE.key}-reel` },
    { dest: CRICKETLIVE_PAGE, key: `${CRICKETLIVE_PAGE.key}-reel` },
  ];
  for (const chart of charts.slice(0, Math.min(MAX_CHARTS_PER_RUN, room))) {
    const doneRows = await db.select({ destination: socialPost.destination, platform: socialPost.platform }).from(socialPost)
      .where(and(eq(socialPost.articleId, chart.latestArticleId), inArray(socialPost.status, ["posted", "queued"])));
    const pending = targets.filter((t) => !doneRows.some((d) => d.destination === t.key && d.platform === "facebook"));
    if (pending.length === 0) continue;
    console.log(`[data reel] ${chart.key}: ${chart.hook} (${chart.finished} of ${chart.total}) -> ${pending.map((p) => p.key).join(", ")}${mode === "dry" ? " [dry run, nothing posted]" : ""}`);
    if (mode === "dry") continue;
    let mp4: Buffer;
    try {
      mp4 = await renderChartReel(chart.params);
    } catch (err) {
      console.error("[data reel] render failed:", err);
      continue;
    }
    let youtubeDone = doneRows.some((d) => d.platform === "youtube");
    for (const t of pending) {
      if (t.dest && !process.env[t.dest.tokenEnv]) continue;
      const igAllowed = !t.dest ? true : Boolean(t.dest.reels?.instagram && t.dest.instagramId && !instagramPaused(t.dest.key));
      try {
        const r = await postDataReel(chart.latestArticleId, mp4, { facebook: chart.caption, instagram: chart.caption }, chart.hook, {
          instagram: igAllowed, facebook: true, youtube: !t.dest && !youtubeDone, topicPage: t.dest,
        });
        console.log(`[data reel] ${t.key}: instagram=${r.instagramPosted} facebook=${r.facebookPosted} youtube=${r.youtubePosted}`);
        if (r.youtubePosted) youtubeDone = true;
      } catch (err) {
        console.error(`[data reel] ${t.key} failed:`, err);
      }
    }
  }
}
