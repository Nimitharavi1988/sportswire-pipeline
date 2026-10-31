/**
 * Automatic Reels for the topic Facebook Pages (facebookDestinations.ts,
 * `reels` setting). Own history (SocialPost.destination "<key>-reel"), own
 * daily limit, daytime hours only. Any story with a real photo qualifies: the
 * photo is shown whole, never cropped. Runs in the ingestion job (plain Node).
 */
import { db } from "@/db";
import { article, socialPost } from "@/db/schema";
import { and, count, desc, eq, gte, inArray, like, ilike, or } from "drizzle-orm";
import { isMatchDataSource } from "../matchDataSources";
import { hasUsableImage } from "../contentQuality";
import { isPromotional } from "../thinContent";
import { isSimilarToAny } from "../titleSimilarity";
import { TOPIC_DESTINATIONS, destinationRunCap, localDayStart, prioritise } from "./facebookDestinations";
import { postReel } from "./postReel";
import { breakingSlotFor, findBreaking } from "./breakingNews";
import { storyPickBoost } from "./drama";
import { isMatchDayStory, matchDayMultiplier } from "./matchDay";
import { loadMatchDayFixtures } from "./matchDayFixtures";
import { editionConditions } from "../i18n/overlay";

const POOL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const SIMILARITY_WINDOW_MS = 24 * 60 * 60 * 1000;
// A story is only tried while the Page has had fewer failed attempts today
// than this — a token/permission problem must not burn a render and AI
// calls every run.
const MAX_FAILED_PER_DAY = 2;
// Photos checked per run, and reels attempted per run.
const MAX_PHOTO_CHECKS = 15;
const MAX_ATTEMPTS = 2;
// A big match-day story (matchDay.ts: its title names both sides of a live or just-finished fixture) goes to every related
// account, past the one-Page-per-story rule and the daily cap by up to this many reels a day (2026-10-17: the India v West
// Indies decider reached Greenfield but not Cricket Live, which skips Greenfield's stories and had used its 10).
const MATCH_DAY_FANOUT_EXTRA = 3;

export async function postTopicReels(now: Date = new Date()): Promise<void> {
  const matchDayFixtures = await loadMatchDayFixtures(now);
  for (const d of TOPIC_DESTINATIONS) {
    if (!d.reels || !process.env[d.tokenEnv]) continue;
    try {
      const key = `${d.key}-reel`;
      const dayStart = localDayStart(now, d.activeHours.timeZone);
      const today = await db.select({ status: socialPost.status }).from(socialPost)
        .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, key), gte(socialPost.createdAt, dayStart)));
      const posted = today.filter((r) => r.status === "posted").length;
      const failed = today.filter((r) => r.status === "failed").length;
      const runCap = destinationRunCap({ ...d.reels, activeHours: d.reels.activeHours ?? d.activeHours, overnight: false }, posted, now);
      // Breaking news can go past the pacing, the reel hours and the daily cap, by up to
      // `breaking.reelAllowance` a day (breakingNews.ts).
      let breakingRoom = d.breaking ? Math.max(0, d.reels.dailyCap + d.breaking.reelAllowance - posted) : 0;
      // Only when a fixture is in the window: otherwise a Page that is done for the day still skips the run up front.
      let fanoutRoom = matchDayFixtures.length > 0 ? Math.max(0, d.reels.dailyCap + MATCH_DAY_FANOUT_EXTRA - posted) : 0;
      if ((runCap === 0 && breakingRoom === 0 && fanoutRoom === 0) || failed >= MAX_FAILED_PER_DAY) {
        console.log(`[reel:${d.key}] posted=${posted} failed=${failed} runCap=${runCap} — skipping`);
        continue;
      }

      const [pool, doneRows, recentTitles] = await Promise.all([
        db.select({
          id: article.id, title: article.title, category: article.category, sourceName: article.sourceName,
          homeTeam: article.homeTeam, awayTeam: article.awayTeam, seriesLabel: article.seriesLabel, leagueLabel: article.leagueLabel,
          venue: article.venue, publishedAt: article.publishedAt, body: article.body, heroImageUrl: article.heroImageUrl, homeCrestUrl: article.homeCrestUrl, trendingScore: article.trendingScore,
        }).from(article)
          .where(and(
            eq(article.status, "published"),
            or(...(d.categories ?? [d.sport]).map((c) => like(article.category, `${c}%`)), ...(d.alsoTitleLike ?? []).map((t) => ilike(article.title, `%${t}%`))),
            // A language edition's Page: only stories with a live translation.
            ...(d.locale ? editionConditions(d.locale) : []),
            gte(article.publishedAt, new Date(now.getTime() - (d.maxAgeHours ? d.maxAgeHours * 3600_000 : POOL_WINDOW_MS))),
          ))
          .orderBy(desc(article.trendingScore), desc(article.publishedAt))
          .limit(300),
        db.select({ articleId: socialPost.articleId }).from(socialPost)
          .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, key))),
        db.select({ title: article.title }).from(socialPost)
          .innerJoin(article, eq(socialPost.articleId, article.id))
          .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, key), eq(socialPost.status, "posted"), gte(socialPost.postedAt, new Date(now.getTime() - SIMILARITY_WINDOW_MS)))),
      ]);
      const ownDone = new Set(doneRows.map((r) => r.articleId));
      const done = new Set(ownDone);
      // Stories the main Page already has a Facebook reel for: skipped up front, not
      // after a wasted attempt (postReel refuses them anyway — reelDuplicates.ts).
      const mainReelRows = await db.select({ articleId: socialPost.articleId }).from(socialPost)
        .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, "reel"), inArray(socialPost.status, ["posted", "queued"])));
      for (const r of mainReelRows) done.add(r.articleId);
      if (d.notAlsoOn) {
        const siblingRows = await db.select({ articleId: socialPost.articleId }).from(socialPost)
          .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, `${d.notAlsoOn}-reel`), inArray(socialPost.status, ["posted", "queued"])));
        for (const r of siblingRows) done.add(r.articleId);
      }
      const titles = recentTitles.map((r) => r.title);

      let checked = 0;
      let attempts = 0;
      let postedNow = 0;
      let normalPosted = 0;
      let breakingPosted = 0;
      let fanoutPosted = 0;
      const breakingIds = d.breaking ? findBreaking(pool, now, d.breaking.minOutlets) : new Set<string>();
      // Drama first within each freshness tier (prioritise keeps the incoming order): social/drama.ts.
      // Stories about a match starting soon or just played come first (social/matchDay.ts).
      const rankScore = (a: { title: string; trendingScore: number | null }) => ((a.trendingScore ?? 0) + storyPickBoost(a.title)) * matchDayMultiplier(a.title, matchDayFixtures, now);
      const ranked = [...pool].sort((a, b) => rankScore(b) - rankScore(a));
      // Match-day stories go first whatever their age (the age rule makes an exception for them).
      const byAge = prioritise(ranked, now, d.focus);
      const queue = [...byAge.filter((x) => isMatchDayStory(x.title, matchDayFixtures, now)), ...byAge.filter((x) => !isMatchDayStory(x.title, matchDayFixtures, now))];
      for (const a of queue) {
        const normalDone = normalPosted >= runCap;
        const breakingDone = breakingRoom <= 0 || breakingPosted >= 1;
        const fanout = isMatchDayStory(a.title, matchDayFixtures, now);
        const fanoutDone = !fanout || fanoutRoom <= 0 || fanoutPosted >= 1;
        if ((normalDone && breakingDone && !(fanout && !fanoutDone)) || attempts >= MAX_ATTEMPTS || checked >= MAX_PHOTO_CHECKS) break;
        // Each Page takes its own half of the breaking stories; once the normal pacing is
        // used up (or outside the reel hours) only breaking stories are tried.
        const isBreaking = breakingIds.has(a.id);
        if (isBreaking && (!d.breaking || breakingSlotFor(a.id) !== d.breaking.slot)) continue;
        if (normalDone && !isBreaking && fanoutDone) continue;
        if ((fanout ? ownDone : done).has(a.id) || !a.body || !hasUsableImage(a) || !d.matches(a)) continue;
        // Never an advertisement (thinContent.ts).
        if (isPromotional(a.title)) continue;
        // Match rows are scorecards, not stories to narrate.
        if (isMatchDataSource(a.sourceName)) continue;
        if (isSimilarToAny(a.title, titles)) continue;
        // A new story's score is still low in its first hour, so breaking news skips the floor.
        if (!isBreaking && !fanout && d.reels.minTrending && (a.trendingScore ?? 0) < d.reels.minTrending) continue;
        checked++;
        if (!a.heroImageUrl) continue;
        attempts++;
        try {
          // Instagram too only where the Page opts in (reels.instagram) and has an account.
          const r = await postReel(a.id, { instagram: Boolean(d.reels.instagram && d.instagramId), facebook: true, youtube: Boolean(d.reels.youtube), topicPage: d, fanOut: fanout });
          console.log(`[reel:${d.key}] ${r.facebookPosted ? "posted" : "not posted"} ${a.id} ("${a.title.slice(0, 60)}")`);
          if (r.facebookPosted) {
            postedNow++;
            if (normalPosted < runCap) normalPosted++;
            else if (fanout && !isBreaking) {
              fanoutPosted++;
              fanoutRoom--;
              console.log(`[reel:${d.key}] match-day reel past the pacing: ${a.id}`);
            } else {
              breakingPosted++;
              breakingRoom--;
              console.log(`[reel:${d.key}] breaking reel: ${a.id}`);
            }
            titles.push(a.title);
          }
        } catch (err) {
          console.error(`[reel:${d.key}] failed for ${a.id}:`, err);
        }
      }
      console.log(`[reel:${d.key}] posted=${posted}+${postedNow} runCap=${runCap} photosChecked=${checked} attempts=${attempts}`);
    } catch (err) {
      console.error(`[reel:${d.key}] failed:`, err);
    }
  }
}
