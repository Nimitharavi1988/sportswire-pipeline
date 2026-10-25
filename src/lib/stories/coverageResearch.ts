/**
 * Research for enrichment from coverage the site already holds (2026-10-05),
 * instead of a paid web search: find other outlets' stories on the same event
 * (stored in the last two days, including those skipped as repeats), read each
 * page the way the ingest job does (robots.txt respected, text kept in memory
 * only, never stored), and have a free model list the facts they state. The
 * write-up and fact-check steps then work from those facts exactly as before.
 *
 * Returns null when the AI is unavailable (the story is tried again later),
 * and fewer facts than the bar when the coverage is too thin (the story is
 * left as it is).
 */
import { db } from "@/db";
import { article } from "@/db/schema";
import { and, desc, gte, like, ne, notInArray } from "drizzle-orm";
import { callGemini } from "../ingestion/commentary";
import { extractArticleContent } from "../ingestion/articleTextExtractor";
import { MATCH_DATA_SOURCE_NAMES } from "../matchDataSources";
import { ORIGINAL_SOURCE } from "../stories";
import { COVERAGE_WINDOW_MS } from "../ingestion/coverageIndex";
import {
  MIN_EXCERPT_CHARS, MIN_TOTAL_CHARS, buildFactsPrompt, isReadableUrl, keepGroundedFacts, outletsOf, pickRelated,
  type CoverageRow, type Excerpt,
} from "./coverageRules";
import type { Research } from "./research";

const FACTS_SCHEMA = { type: "OBJECT", properties: { facts: { type: "ARRAY", items: { type: "STRING" } } }, required: ["facts"] };

// The excerpt for one outlet's story: its page when readable, else its feed
// summary. (A story's own stored body is an earlier AI write-up, so it is
// never used as a source.)
async function excerptFor(row: CoverageRow): Promise<Excerpt | null> {
  let text = "";
  if (isReadableUrl(row.sourceUrl)) {
    const page = await extractArticleContent(row.sourceUrl).catch(() => null);
    text = page?.text ?? "";
  }
  if (text.length < MIN_EXCERPT_CHARS) text = row.summary.trim();
  return text.length >= MIN_EXCERPT_CHARS ? { outlet: row.sourceName, text } : null;
}

export async function researchFromCoverage(story: CoverageRow & { category: string }, now: Date = new Date()): Promise<Research | null> {
  const sport = story.category.split("/")[0];
  const candidates = await db
    .select({ id: article.id, title: article.title, summary: article.summary, sourceName: article.sourceName, sourceUrl: article.sourceUrl })
    .from(article)
    .where(and(
      like(article.category, `${sport}%`),
      gte(article.createdAt, new Date(now.getTime() - COVERAGE_WINDOW_MS)),
      notInArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      ne(article.sourceName, ORIGINAL_SOURCE),
    ))
    .orderBy(desc(article.trendingScore))
    .limit(800);

  const related = pickRelated(story, candidates);
  const excerpts = (await Promise.all(related.map(excerptFor))).filter((e): e is Excerpt => e !== null);
  const total = excerpts.reduce((n, e) => n + e.text.length, 0);
  if (excerpts.length < 2 || total < MIN_TOTAL_CHARS) return { facts: [], sources: outletsOf(excerpts) };

  const out = (await callGemini(buildFactsPrompt(story.title, excerpts), {
    responseSchema: FACTS_SCHEMA, temperature: 0, maxOutputTokens: 2048,
  })) as { facts?: unknown } | null;
  if (!out) return null;
  const { facts, dropped } = keepGroundedFacts(out.facts, excerpts);
  if (dropped > 0) console.log(`[enrich] ${dropped} extracted fact(s) dropped for figures not in the coverage ("${story.title.slice(0, 50)}")`);
  return { facts, sources: outletsOf(excerpts) };
}
