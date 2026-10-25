import { db } from "@/db";
import { article, articleTag, storyIdea } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, like, lte, max, notInArray, or } from "drizzle-orm";
import { MATCH_DATA_SOURCE_NAMES } from "./matchDataSources";
import { ORIGINAL_SOURCE } from "./stories";
import {
  IDEA_SPORTS,
  coversMatch,
  isBigMatch,
  previewIdea,
  reportIdea,
  seriesForMatch,
  trendEntities,
  trendIdeas,
  type MatchRow,
  type StoryIdea,
} from "./storyIdeas";

const HOUR = 60 * 60 * 1000;
// Reports: matches finished in the last 36 hours. Previews: kick-off in
// the next 60 hours. Trends: the last 24 hours of news.
const REPORT_WINDOW = 36 * HOUR;
const PREVIEW_WINDOW = 60 * HOUR;
const TREND_WINDOW = 24 * HOUR;

const sportFilter = or(...IDEA_SPORTS.flatMap((s) => [eq(article.category, s), like(article.category, `${s}/%`)]));

// Series with recent stories, newest first (same source as the editor's menu).
async function recentSeries(now: Date): Promise<{ key: string }[]> {
  const rows = await db
    .select({ key: article.seriesKey })
    .from(article)
    .where(and(isNotNull(article.seriesKey), gte(article.createdAt, new Date(now.getTime() - 30 * 24 * HOUR))))
    .groupBy(article.seriesKey)
    .orderBy(desc(max(article.createdAt)));
  return rows.flatMap((r) => (r.key ? [{ key: r.key }] : []));
}

// Every open idea, newest first within each kind: dismissed/used ones and
// ones an original story already covers are left out.
export async function fetchStoryIdeas(now: Date = new Date()): Promise<StoryIdea[]> {
  const [matches, stories, originals, handled, series] = await Promise.all([
    db
      .select({
        id: article.id, category: article.category, homeTeam: article.homeTeam, awayTeam: article.awayTeam, kickoffAt: article.kickoffAt,
        matchStatus: article.matchStatus, leagueLabel: article.leagueLabel, venue: article.venue, homeScoreText: article.homeScoreText,
        awayScoreText: article.awayScoreText, homeScore: article.homeScore, awayScore: article.awayScore, matchNote: article.matchNote,
        seriesKey: article.seriesKey,
      })
      .from(article)
      .where(and(
        inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
        eq(article.status, "published"),
        sportFilter,
        isNotNull(article.homeTeam),
        isNotNull(article.awayTeam),
        gte(article.kickoffAt, new Date(now.getTime() - REPORT_WINDOW)),
        lte(article.kickoffAt, new Date(now.getTime() + PREVIEW_WINDOW))
      )),
    db
      .select({ title: article.title, slug: article.slug, sourceName: article.sourceName, category: article.category, publishedAt: article.publishedAt })
      .from(article)
      .where(and(
        eq(article.status, "published"),
        sportFilter,
        notInArray(article.sourceName, [...MATCH_DATA_SOURCE_NAMES, ORIGINAL_SOURCE]),
        gte(article.publishedAt, new Date(now.getTime() - TREND_WINDOW))
      )),
    db
      .select({ id: article.id, title: article.title, storyKind: article.storyKind, createdAt: article.createdAt })
      .from(article)
      .where(and(eq(article.sourceName, ORIGINAL_SOURCE), gte(article.createdAt, new Date(now.getTime() - 7 * 24 * HOUR)))),
    db.select({ key: storyIdea.key }).from(storyIdea),
    recentSeries(now),
  ]);

  const done = new Set(handled.map((h) => h.key));
  const matchIdeas = matches.flatMap((m) => {
    if (!m.homeTeam || !m.awayTeam || !m.kickoffAt) return [];
    const row = m as MatchRow;
    if (!isBigMatch(row)) return [];
    const seriesKey = seriesForMatch(row, series);
    if (row.matchStatus === "finished") return [reportIdea(row, seriesKey)];
    if (row.matchStatus === "scheduled" && row.kickoffAt > now) return [previewIdea(row, seriesKey)];
    return [];
  });

  // Players/teams an original story from the last two days is tagged with.
  const recentOriginalIds = originals.filter((o) => o.createdAt.getTime() > now.getTime() - 48 * HOUR).map((o) => o.id);
  const coveredTags = new Set(
    recentOriginalIds.length
      ? (await db.select({ kind: articleTag.kind, slug: articleTag.slug }).from(articleTag).where(inArray(articleTag.articleId, recentOriginalIds))).map((t) => `${t.kind}:${t.slug}`)
      : []
  );

  const trends = trendIdeas(
    stories.flatMap((s) => (s.publishedAt ? [{ ...s, publishedAt: s.publishedAt }] : [])),
    trendEntities()
  ).filter((i) => !coveredTags.has(`${i.tags[0].kind}:${i.tags[0].slug}`));

  const open = [...matchIdeas, ...trends].filter(
    (i) => !done.has(i.key) && (i.kind === "trend" || !originals.some((o) => coversMatch(o, i)))
  );
  // Reports: latest first; previews: soonest first; trends keep their order.
  const byKind = (k: StoryIdea["kind"]) => open.filter((i) => i.kind === k);
  return [
    ...byKind("report").sort((a, b) => b.at.getTime() - a.at.getTime()),
    ...byKind("preview").sort((a, b) => a.at.getTime() - b.at.getTime()),
    ...byKind("trend"),
  ];
}

export async function fetchStoryIdea(key: string, now: Date = new Date()): Promise<StoryIdea | null> {
  return (await fetchStoryIdeas(now)).find((i) => i.key === key) ?? null;
}

export async function markStoryIdea(key: string, status: "dismissed" | "used", articleId: string | null = null) {
  await db
    .insert(storyIdea)
    .values({ key, status, articleId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: storyIdea.key, set: { status, articleId, updatedAt: new Date() } });
}
