/**
 * "Who will win?" posts for the topic Facebook Pages. The site already opens a
 * prediction poll on every big upcoming match (predictions.ts); this posts a
 * link to that match's page on the Page a few hours before kickoff, asking
 * fans to pick a side and follow the Page for the result. English-language
 * Pages only; the main Page is not touched.
 *
 * History is kept under its own key ("<page>:predict") so these posts neither
 * use up the Page's story cap nor block the same match's story post.
 */
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/db";
import { article, poll, pollOption, pollVote, socialPost } from "@/db/schema";
import { categoryEmoji } from "@/lib/categoryDisplay";
import { leagueWeight } from "../scores/priority";
import { resolvePageAccessToken } from "./facebook";
import { selectFacebookHashtags } from "./hashtagRepertoire";
import { socialArticleUrl } from "./trackedLink";
import { TOPIC_DESTINATIONS, destinationRunCap, localDayStart, type FacebookDestination } from "./facebookDestinations";

// Posted this far ahead of kickoff: early enough to collect picks, late enough to be today's match.
const MIN_LEAD_MS = 45 * 60_000;
const MAX_LEAD_MS = 14 * 3600_000;
// Most prediction posts one Page makes a day.
const DAILY_CAP = 2;

export const predictionKey = (d: FacebookDestination) => `${d.key}:predict`;

export function predictionMessage(a: { category: string; homeTeam: string; awayTeam: string; leagueLabel: string | null; seriesLabel: string | null }, hashtags: string): string {
  const league = a.leagueLabel ?? a.seriesLabel;
  return [
    `${categoryEmoji(a.category)} Who will win? ${a.homeTeam} vs ${a.awayTeam}`,
    league ? `🏆 ${league}` : null,
    "",
    "👇 Tap the link and lock in your pick before kickoff, then see how other fans voted.",
    "🔔 Follow this Page and turn on notifications to get the result first.",
    "",
    hashtags,
  ].filter((l) => l !== null).join("\n");
}

// dryRun: select and report only, nothing is posted.
async function postForDestination(d: FacebookDestination, now: Date, dryRun: boolean): Promise<number> {
  if (d.locale) return 0;
  if (!dryRun && !process.env[d.tokenEnv]) return 0;
  const key = predictionKey(d);
  const [{ postedToday }] = await db.select({ postedToday: count() }).from(socialPost)
    .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, key), inArray(socialPost.status, ["posted", "queued"]), gte(socialPost.createdAt, localDayStart(now, d.activeHours.timeZone))));
  // No overnight posts: same daytime spread as the stories, at most DAILY_CAP a day, one per run.
  if (destinationRunCap({ dailyCap: DAILY_CAP, perRunCap: 1, activeHours: d.activeHours, overnight: false }, postedToday, now) === 0) return 0;

  const categories = d.categories ?? [d.sport];
  const [rows, doneRows] = await Promise.all([
    db.select({
      id: article.id, slug: article.slug, category: article.category, homeTeam: article.homeTeam, awayTeam: article.awayTeam,
      leagueLabel: article.leagueLabel, seriesLabel: article.seriesLabel, title: article.title, venue: article.venue, kickoffAt: article.kickoffAt,
    }).from(poll)
      .innerJoin(article, eq(article.id, poll.articleId))
      .where(and(
        eq(poll.kind, "prediction"), isNull(poll.resolvedAt), eq(article.status, "published"),
        gt(article.kickoffAt, new Date(now.getTime() + MIN_LEAD_MS)), lt(article.kickoffAt, new Date(now.getTime() + MAX_LEAD_MS)),
      ))
      .orderBy(asc(article.kickoffAt)).limit(100),
    db.select({ articleId: socialPost.articleId, destination: socialPost.destination }).from(socialPost)
      .where(and(eq(socialPost.platform, "facebook"), inArray(socialPost.destination, [key, ...(d.notAlsoOn ? [`${d.notAlsoOn}:predict`] : [])]), inArray(socialPost.status, ["posted", "queued"]))),
  ]);
  const done = new Set(doneRows.map((r) => r.articleId));
  const pick = rows
    .filter((r) => r.homeTeam && r.awayTeam && !done.has(r.id) && categories.some((c) => r.category.startsWith(c)) && d.matches({ ...r, homeTeam: r.homeTeam, awayTeam: r.awayTeam }))
    .sort((x, y) => leagueWeight(y.leagueLabel ?? y.seriesLabel ?? "", y.category.split("/")[0]) - leagueWeight(x.leagueLabel ?? x.seriesLabel ?? "", x.category.split("/")[0]))[0];
  if (!pick) return 0;
  console.log(`[predict:${d.key}] ${dryRun ? "would post" : "posting"} ${pick.homeTeam} v ${pick.awayTeam}`);
  if (dryRun) return 1;

  const link = socialArticleUrl(process.env.SITE_URL ?? "http://localhost:3000", pick.slug, "facebook", "predict", d.key);
  const hashtags = (d.hashtags ?? selectFacebookHashtags)(pick.title, pick.category).join(" ");
  const message = predictionMessage({ ...pick, homeTeam: pick.homeTeam!, awayTeam: pick.awayTeam! }, hashtags);
  await publish(d, key, pick.id, message, link);
  return 1;
}

// Records the post, publishes it to the Page's feed, and marks it posted (or failed, then rethrows).
async function publish(d: FacebookDestination, key: string, articleId: string, message: string, link: string): Promise<void> {
  const [row] = await db.insert(socialPost).values({ id: createId(), articleId, platform: "facebook", destination: key, status: "queued" }).returning();
  try {
    const token = await resolvePageAccessToken(d.pageId, process.env[d.tokenEnv]!);
    const res = await fetch(`https://graph.facebook.com/v20.0/${d.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, link, access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Facebook API error (${res.status})`);
    await db.update(socialPost).set({ status: "posted", externalPostId: data.id, postedAt: new Date() }).where(eq(socialPost.id, row.id));
  } catch (err) {
    await db.update(socialPost).set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) }).where(eq(socialPost.id, row.id));
    throw err;
  }
}

// Fan numbers are only quoted once enough picks exist to mean something.
const MIN_VOTES_FOR_STATS = 10;
// A result is posted within this long of the poll being resolved; older ones are stale.
const RESULT_MAX_AGE_MS = 6 * 3600_000;
const RESULT_DAILY_CAP = 2;

export const resultKey = (d: FacebookDestination) => `${d.key}:result`;

export function resultMessage(
  a: { category: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; matchNote: string | null },
  winner: string, correct: number, total: number, hashtags: string,
): string {
  const cricket = a.category.split("/")[0] === "cricket";
  const detail = cricket ? a.matchNote?.trim() : a.homeScore !== null && a.awayScore !== null ? `${a.homeTeam} ${a.homeScore}-${a.awayScore} ${a.awayTeam}` : null;
  return [
    `${categoryEmoji(a.category)} Result: ${winner} won`,
    detail ? `📊 ${detail}` : null,
    total >= MIN_VOTES_FOR_STATS ? `🗳️ ${Math.round((correct / total) * 100)}% of ${total} fans called it right.` : null,
    "",
    "👇 Tap the link to see your pick and the full vote.",
    "🔔 Follow this Page and turn on notifications for the next match prediction.",
    "",
    hashtags,
  ].filter((l) => l !== null).join("\n");
}

async function postResultForDestination(d: FacebookDestination, now: Date, dryRun: boolean): Promise<number> {
  if (d.locale) return 0;
  if (!dryRun && !process.env[d.tokenEnv]) return 0;
  const key = resultKey(d);
  const [{ postedToday }] = await db.select({ postedToday: count() }).from(socialPost)
    .where(and(eq(socialPost.platform, "facebook"), eq(socialPost.destination, key), inArray(socialPost.status, ["posted", "queued"]), gte(socialPost.createdAt, localDayStart(now, d.activeHours.timeZone))));
  if (destinationRunCap({ dailyCap: RESULT_DAILY_CAP, perRunCap: 1, activeHours: d.activeHours, overnight: false }, postedToday, now) === 0) return 0;

  const categories = d.categories ?? [d.sport];
  const [rows, doneRows] = await Promise.all([
    db.select({
      pollId: poll.id, winnerOptionId: poll.resolvedOptionId, winner: pollOption.text,
      id: article.id, slug: article.slug, category: article.category, title: article.title, homeTeam: article.homeTeam, awayTeam: article.awayTeam,
      homeScore: article.homeScore, awayScore: article.awayScore, matchNote: article.matchNote,
      leagueLabel: article.leagueLabel, seriesLabel: article.seriesLabel, venue: article.venue,
    }).from(poll)
      .innerJoin(article, eq(article.id, poll.articleId))
      .innerJoin(pollOption, eq(pollOption.id, poll.resolvedOptionId))
      .where(and(eq(poll.kind, "prediction"), gt(poll.resolvedAt, new Date(now.getTime() - RESULT_MAX_AGE_MS)), eq(article.status, "published")))
      .orderBy(desc(poll.resolvedAt)).limit(100),
    db.select({ articleId: socialPost.articleId }).from(socialPost)
      .where(and(eq(socialPost.platform, "facebook"), inArray(socialPost.destination, [key, ...(d.notAlsoOn ? [`${d.notAlsoOn}:result`] : [])]), inArray(socialPost.status, ["posted", "queued"]))),
  ]);
  const done = new Set(doneRows.map((r) => r.articleId));
  const pick = rows.find((r) => r.homeTeam && r.awayTeam && !done.has(r.id) && categories.some((c) => r.category.startsWith(c)) && d.matches({ ...r, homeTeam: r.homeTeam, awayTeam: r.awayTeam }));
  if (!pick) return 0;
  console.log(`[result:${d.key}] ${dryRun ? "would post" : "posting"} ${pick.homeTeam} v ${pick.awayTeam}`);
  if (dryRun) return 1;

  const votes = await db.select({ optionId: pollVote.optionId, n: count() }).from(pollVote).where(eq(pollVote.pollId, pick.pollId)).groupBy(pollVote.optionId);
  const total = votes.reduce((s, v) => s + v.n, 0);
  const correct = votes.find((v) => v.optionId === pick.winnerOptionId)?.n ?? 0;
  const link = socialArticleUrl(process.env.SITE_URL ?? "http://localhost:3000", pick.slug, "facebook", "result", d.key);
  const hashtags = (d.hashtags ?? selectFacebookHashtags)(pick.title, pick.category).join(" ");
  await publish(d, key, pick.id, resultMessage({ ...pick, homeTeam: pick.homeTeam!, awayTeam: pick.awayTeam! }, pick.winner, correct, total, hashtags), link);
  return 1;
}

// "Who won?" follow-up for matches whose prediction has just been resolved with a winner (void ones are skipped).
export async function postPredictionResults(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<number> {
  let posted = 0;
  for (const d of TOPIC_DESTINATIONS) {
    try {
      posted += await postResultForDestination(d, now, Boolean(opts.dryRun));
    } catch (err) {
      console.error(`[result:${d.key}] failed:`, err);
    }
  }
  return posted;
}

export async function postPredictionPrompts(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<number> {
  let posted = 0;
  for (const d of TOPIC_DESTINATIONS) {
    try {
      posted += await postForDestination(d, now, Boolean(opts.dryRun));
    } catch (err) {
      // One Page's failure never affects the others.
      console.error(`[predict:${d.key}] failed:`, err);
    }
  }
  return posted;
}
