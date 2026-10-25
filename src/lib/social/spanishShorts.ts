/**
 * Spanish YouTube Shorts, picked on their own (not only when the Spanish Facebook Page happens to post a
 * reel). Each run takes the strongest Spanish-translated story that has a real photo and no Short on the
 * Spanish channel yet, and renders and uploads just the Short (postReel.ts, YouTube only). Runs in the
 * ingestion job (plain Node, like the other reels).
 *
 * Strongest = trending score plus drama, times freshness and the match-day boost (social/matchDay.ts),
 * and in US waking hours a further boost for the US sports, since the Spanish audience is largely in the
 * US. Messi and Ronaldo stories rank first and may be older (freshness.ts).
 */
import { db } from "@/db";
import { article, socialPost } from "@/db/schema";
import { and, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { isMatchDataSource } from "../matchDataSources";
import { hasRealImage } from "../contentQuality";
import { isPromotional } from "../thinContent";
import { isSimilarToAny } from "../titleSimilarity";
import { editionConditions } from "../i18n/overlay";
import { SPANISH_PAGE, spanishPageEnabled } from "./facebookDestinations";
import { postReel } from "./postReel";
import { logDecision } from "./decisionLog";
import { spanishShortScore, shortFreshEnough } from "./spanishShortsRank";
import { loadMatchDayFixtures } from "./matchDayFixtures";
import { isStarStory, reelIsFresh, reelMaxAgeHours } from "./freshness";
import { youtubeConfigured, youtubeSlotOpen, maxShortsPerDay, minGapMinutes } from "./youtube";

const DESTINATION = `${SPANISH_PAGE.key}-reel`;
// Stories this old are only looked at for Messi/Ronaldo (the age limit exempts them); everyone else is bound by the Page's reel age limit.
const POOL_WINDOW_MS = 48 * 3600_000;
const SIMILARITY_WINDOW_MS = 24 * 3600_000;
const MAX_PHOTO_CHECKS = 15;
const MAX_ATTEMPTS = 2;

export async function postSpanishShorts(now: Date = new Date()): Promise<void> {
  if (!spanishPageEnabled() || !youtubeConfigured("es")) return;
  try {
    // Pacing: the same cap and gap as the other Shorts, counted on the Spanish channel only.
    const recent = await db.select({ at: socialPost.postedAt }).from(socialPost)
      .where(and(eq(socialPost.platform, "youtube"), eq(socialPost.destination, DESTINATION), eq(socialPost.status, "posted"), gte(socialPost.postedAt, new Date(now.getTime() - 24 * 3600_000))))
      .orderBy(desc(socialPost.postedAt));
    if (!youtubeSlotOpen(recent.length, recent[0]?.at ?? null, now, maxShortsPerDay(), minGapMinutes())) {
      console.log(`[spanish-shorts] skipped: ${recent.length} in 24h, last ${recent[0]?.at?.toISOString() ?? "never"}`);
      await logDecision({ platform: "youtube", destination: DESTINATION, kind: "short", outcome: "skipped", reason: `pacing: ${recent.length} Shorts in 24h, last ${recent[0]?.at?.toISOString() ?? "never"}` });
      return;
    }

    const fixtures = await loadMatchDayFixtures(now);
    const maxAge = reelMaxAgeHours(process.env, SPANISH_PAGE.key);
    const [pool, triedRows, recentTitles] = await Promise.all([
      db.select({
        id: article.id, title: article.title, category: article.category, sourceName: article.sourceName,
        homeTeam: article.homeTeam, awayTeam: article.awayTeam, seriesLabel: article.seriesLabel, leagueLabel: article.leagueLabel,
        venue: article.venue, publishedAt: article.publishedAt, createdAt: article.createdAt, body: article.body,
        heroImageUrl: article.heroImageUrl, homeCrestUrl: article.homeCrestUrl, trendingScore: article.trendingScore,
      }).from(article)
        .where(and(
          eq(article.status, "published"),
          or(...(SPANISH_PAGE.categories ?? [SPANISH_PAGE.sport]).map((c) => like(article.category, `${c}%`))),
          ...editionConditions("es"),
          gte(article.publishedAt, new Date(now.getTime() - POOL_WINDOW_MS)),
          // Match previews carry the kickoff as their date, which can be weeks ahead: not news yet.
          lte(article.publishedAt, now),
        ))
        .orderBy(desc(article.trendingScore), desc(article.publishedAt))
        .limit(300),
      // Any earlier attempt on the Spanish channel (a Short, or a failure) keeps a story out: a failing story is not retried every run.
      db.select({ articleId: socialPost.articleId }).from(socialPost)
        .where(and(eq(socialPost.platform, "youtube"), eq(socialPost.destination, DESTINATION), inArray(socialPost.status, ["posted", "queued", "failed"]))),
      db.select({ title: article.title }).from(socialPost)
        .innerJoin(article, eq(socialPost.articleId, article.id))
        .where(and(eq(socialPost.platform, "youtube"), eq(socialPost.destination, DESTINATION), eq(socialPost.status, "posted"), gte(socialPost.postedAt, new Date(now.getTime() - SIMILARITY_WINDOW_MS)))),
    ]);
    const tried = new Set(triedRows.map((r) => r.articleId));
    const titles = recentTitles.map((r) => r.title);
    const ranked = [...pool].sort((a, b) => spanishShortScore(b, fixtures, now) - spanishShortScore(a, fixtures, now));

    let checked = 0;
    let attempts = 0;
    for (const a of ranked) {
      if (attempts >= MAX_ATTEMPTS || checked >= MAX_PHOTO_CHECKS) break;
      if (tried.has(a.id) || !a.body || !hasRealImage(a) || !SPANISH_PAGE.matches(a)) continue;
      if (!shortFreshEnough(a, fixtures, now, maxAge)) continue;
      if (isPromotional(a.title) || isMatchDataSource(a.sourceName) || isSimilarToAny(a.title, titles)) continue;
      checked++;
      if (!a.heroImageUrl) continue;
      attempts++;
      try {
        const r = await postReel(a.id, { instagram: false, facebook: false, youtube: true, topicPage: SPANISH_PAGE });
        console.log(`[spanish-shorts] ${r.youtubePosted ? "posted" : "not posted"} ${a.id} ("${a.title.slice(0, 60)}")`);
        if (r.youtubePosted) break;
      } catch (err) {
        console.error(`[spanish-shorts] failed for ${a.id}:`, err);
      }
    }
    console.log(`[spanish-shorts] photosChecked=${checked} attempts=${attempts}`);
    // A run that found nothing to post says so (a Short that posted is recorded by postReel itself).
    if (attempts === 0) await logDecision({ platform: "youtube", destination: DESTINATION, kind: "short", outcome: "skipped", reason: `no eligible story with a photo (${checked} photos checked, ${ranked.length} candidates)` });
  } catch (err) {
    console.error("[spanish-shorts] failed:", err);
  }
}
