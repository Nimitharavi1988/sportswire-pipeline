/**
 * Pulls new videos from the official channels' public RSS feeds
 * (youtubeChannels.ts) into the Video table, then links recent highlights
 * videos to their match story. Runs after each ingestion run
 * (.github/workflows/ingest-cron.yml): each feed only lists a channel's
 * latest 15 uploads, most of them Shorts, so a highlights video can scroll
 * off within hours — polling every ~15 minutes catches it.
 *
 * Free and keyless: RSS feeds plus YouTube's embed page, checked once per
 * new video — only videos that really play in an embedded player on this
 * site are stored (the site only ever shows a video through YouTube's own
 * player). A rejected video is re-checked on later runs while it's still in
 * the feed, since it isn't stored.
 */
import { db } from "@/db";
import { article, video } from "@/db/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { MATCH_DATA_SOURCE_NAMES } from "../matchDataSources";
import { YOUTUBE_CHANNELS } from "./youtubeChannels";
import { HIGHLIGHTS_MAX_DELAY_MS, isHighlightsTitle, isPlayableInEmbed, parseYouTubeFeed, pickMatchForVideo } from "./youtubeFeed";
import { isThrowbackTitle } from "./videoStrip";

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const DAY_MS = 24 * 60 * 60 * 1000;

// Asks YouTube's embed page as our site would (Referer = the site), since
// rights holders can block embedding per site — see isPlayableInEmbed.
async function isEmbeddable(youtubeId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/embed/${youtubeId}`, {
      headers: { Referer: `${process.env.SITE_URL ?? "https://sportswirelive.com"}/`, "User-Agent": "Mozilla/5.0" },
    });
    return res.ok && isPlayableInEmbed(await res.text());
  } catch {
    return false;
  }
}

export interface YouTubeSyncResult {
  channels: number;
  added: number;
  skippedNotEmbeddable: number;
  linked: number;
}

export async function syncYouTubeVideos(now: Date = new Date()): Promise<YouTubeSyncResult> {
  const result: YouTubeSyncResult = { channels: 0, added: 0, skippedNotEmbeddable: 0, linked: 0 };

  for (const channel of YOUTUBE_CHANNELS) {
    let xml: string;
    try {
      const res = await fetch(FEED_URL + channel.id);
      if (!res.ok) {
        console.error(`YouTube feed ${channel.title}: HTTP ${res.status}`);
        continue;
      }
      xml = await res.text();
    } catch (err) {
      console.error(`YouTube feed ${channel.title} failed:`, err);
      continue;
    }
    result.channels++;

    const entries = parseYouTubeFeed(xml).filter((e) => !e.isShort && !isThrowbackTitle(e.title) && (!channel.include || channel.include.test(e.title)));
    if (entries.length === 0) continue;
    const known = new Set(
      (await db.select({ youtubeId: video.youtubeId }).from(video).where(inArray(video.youtubeId, entries.map((e) => e.youtubeId)))).map(
        (r) => r.youtubeId
      )
    );

    for (const entry of entries.filter((e) => !known.has(e.youtubeId))) {
      if (!(await isEmbeddable(entry.youtubeId))) {
        result.skippedNotEmbeddable++;
        continue;
      }
      await db
        .insert(video)
        .values({
          id: createId(),
          youtubeId: entry.youtubeId,
          channelId: channel.id,
          channelTitle: channel.title,
          title: entry.title,
          publishedAt: entry.publishedAt,
          thumbnailUrl: entry.thumbnailUrl,
          category: channel.category,
          isHighlights: isHighlightsTitle(entry.title),
        })
        .onConflictDoNothing();
      result.added++;
    }
  }

  result.linked = await linkHighlights(now);
  return result;
}

// Recent unlinked highlights -> the match story they're about (see
// pickMatchForVideo: same sport, both teams in the title, kicked off
// shortly before the upload; never a guess).
async function linkHighlights(now: Date): Promise<number> {
  const pending = await db
    .select({ id: video.id, title: video.title, publishedAt: video.publishedAt, category: video.category })
    .from(video)
    .where(and(eq(video.isHighlights, true), isNull(video.matchArticleId), gte(video.publishedAt, new Date(now.getTime() - HIGHLIGHTS_MAX_DELAY_MS))));
  if (pending.length === 0) return 0;

  const rows = await db
    .select({ id: article.id, category: article.category, homeTeam: article.homeTeam, awayTeam: article.awayTeam, kickoffAt: article.kickoffAt })
    .from(article)
    .where(and(
      eq(article.status, "published"),
      inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      isNotNull(article.homeTeam),
      isNotNull(article.awayTeam),
      gte(article.kickoffAt, new Date(now.getTime() - HIGHLIGHTS_MAX_DELAY_MS - 3 * DAY_MS)),
      lte(article.kickoffAt, now)
    ));
  const candidates = rows.flatMap((r) =>
    r.homeTeam && r.awayTeam && r.kickoffAt ? [{ id: r.id, category: r.category, homeTeam: r.homeTeam, awayTeam: r.awayTeam, kickoffAt: r.kickoffAt }] : []
  );

  let linked = 0;
  for (const v of pending) {
    const matchId = pickMatchForVideo(v, candidates);
    if (!matchId) continue;
    await db.update(video).set({ matchArticleId: matchId }).where(eq(video.id, v.id));
    linked++;
  }
  return linked;
}

if (require.main === module) {
  const started = Date.now();
  syncYouTubeVideos()
    .then((r) => {
      console.log(
        `YouTube sync: ${r.channels} channels read, ${r.added} new videos, ${r.skippedNotEmbeddable} not embeddable (skipped), ${r.linked} highlights linked to matches, in ${Date.now() - started}ms.`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("YouTube sync failed:", err);
      process.exit(1);
    });
}
