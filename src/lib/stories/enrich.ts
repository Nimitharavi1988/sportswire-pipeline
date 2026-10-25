/**
 * Enriching top stories (2026-10-04). Most ingested stories are short
 * write-ups of another outlet's report, under 300 words, so they're noindex
 * (thinContent.ts) and the site had almost nothing in search. Each run takes
 * the day's highest-trending of them and turns them into full reports:
 *
 *   1. research the story on the web (research.ts: Gemini + Google Search),
 *   2. write a 350-550 word news report from those facts only,
 *   3. fact-check it against the research (claims it doesn't support go),
 *   4. replace the story's text in place: same address, headline and photo,
 *      the original publisher still credited, plus a line naming the other
 *      outlets the research drew on.
 *
 * Once over 300 words the story is indexed again by the same rule, with no
 * other switch. Too few facts, a failed check or a short result leaves the
 * story as it was. Every attempt is logged (a DataSnapshot row) so a story is
 * tried once. Runs from the ingest workflow; nothing here publishes anything
 * new.
 */
import { db } from "@/db";
import { article, dataSnapshot } from "@/db/schema";
import { and, desc, eq, gte, like, notInArray, ne } from "drizzle-orm";
import { callGemini } from "../ingestion/commentary";
import { RESEARCH_MODEL, factCheckDraft } from "./research";
import { researchFromCoverage } from "./coverageResearch";
import { MATCH_DATA_SOURCE_NAMES } from "../matchDataSources";
import { ORIGINAL_SOURCE } from "../stories";
import { articleWords } from "../thinContent";
import { articleUrl, submitToIndexNow } from "../indexNow";
import {
  MIN_ENRICHED_WORDS, MIN_ENRICH_FACTS, enrichmentPaused,
  acceptShortEnrichment, buildEnrichPrompt, creditLine, enrichLimitsFrom, enrichedToday, enrichedShortToday, isRepetitive, mentionsItsInputs, mergeLogs, sameEventAsEnriched, pickCandidates, pruneLog, unsupportedFigures, type EnrichLogEntry, type EnrichResult,
} from "./enrichRules";

const LOG_KEY = "enrich:log";

async function readLog(): Promise<EnrichLogEntry[]> {
  const [row] = await db.select({ data: dataSnapshot.data }).from(dataSnapshot).where(eq(dataSnapshot.key, LOG_KEY)).limit(1);
  return ((row?.data as { entries?: EnrichLogEntry[] } | undefined)?.entries) ?? [];
}

async function writeLog(entries: EnrichLogEntry[]) {
  await db.insert(dataSnapshot).values({ key: LOG_KEY, data: { entries }, sourceUrl: "internal:enrich", fetchedAt: new Date() })
    .onConflictDoUpdate({ target: dataSnapshot.key, set: { data: { entries }, fetchedAt: new Date() } });
}

const ENRICH_SCHEMA = { type: "OBJECT", properties: { paragraphs: { type: "ARRAY", items: { type: "STRING" } } }, required: ["paragraphs"] };

// dryRun: research, write and check as usual, but print the result instead
// of saving anything (no story change, no log, no IndexNow).
export async function enrichTopStories(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<{ enriched: number; note: string }> {
  // Paused until the job has a real-world fact-check (enrichRules.ts enrichmentPaused): nothing is researched or written.
  if (enrichmentPaused()) {
    console.log("Enrichment is paused (no real-world fact-check yet); set ENRICH_PAUSED=0 to resume.");
    return { enriched: 0, note: "paused" };
  }
  let log = pruneLog(await readLog(), now);
  const limits = enrichLimitsFrom(process.env);
  const room = Math.min(limits.perRun, limits.perDay - enrichedToday(log, now));
  // Short but real results (enrichRules.ts acceptShortEnrichment): their own daily limit.
  const roomShort = Math.min(limits.perRun, limits.perDayShort - enrichedShortToday(log, now));
  if (room <= 0 && roomShort <= 0) return { enriched: 0, note: "daily limit reached" };

  const rows = await db
    .select({
      id: article.id, slug: article.slug, title: article.title, body: article.body, summary: article.summary,
      sourceName: article.sourceName, sourceUrl: article.sourceUrl, category: article.category,
      heroImageUrl: article.heroImageUrl, homeCrestUrl: article.homeCrestUrl,
    })
    .from(article)
    .where(and(
      eq(article.status, "published"),
      ne(article.sourceName, ORIGINAL_SOURCE),
      notInArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      gte(article.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    ))
    .orderBy(desc(article.trendingScore))
    .limit(60);

  // Titles already enriched in the last two days: one report per event.
  const enrichedTitles = (await db.select({ title: article.title }).from(article).where(and(
    eq(article.status, "published"),
    gte(article.updatedAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
    like(article.body, "%This report also draws on coverage%"),
  ))).map((r) => r.title);

  let enriched = 0;
  let shortCount = 0;
  let note = "ok";
  const record = (id: string, result: EnrichResult, detail?: EnrichLogEntry["detail"]) => { log = [...log, { id, at: now.toISOString(), result, ...(detail ? { detail } : {}) }]; };

  for (const story of pickCandidates(rows, log, limits.researchPerRun)) {
    if (enriched >= room && shortCount >= roomShort) break;
    if (sameEventAsEnriched(story.title, enrichedTitles)) {
      if (opts.dryRun) console.log(`[dry-run] same event as an enriched story: "${story.title}"`);
      record(story.id, "failed", { why: "same event as an enriched story" });
      continue;
    }
    const text = (story.body?.trim() ? story.body : story.summary).trim();
    // Researched from other outlets' coverage we already hold, not a paid web
    // search (coverageResearch.ts).
    const research = await researchFromCoverage(story, now);
    // AI unavailable: stop without marking, so the story is tried again.
    if (!research) { note = "research unavailable"; break; }
    if (research.facts.length < MIN_ENRICH_FACTS) {
      if (opts.dryRun) console.log(`[dry-run] few facts (${research.facts.length}; outlets: ${research.sources.join(", ") || "none"}): "${story.title}"`);
      record(story.id, "few-facts", { facts: research.facts.length, outlets: research.sources.length });
      continue;
    }

    const written = (await callGemini(buildEnrichPrompt({ title: story.title, sourceName: story.sourceName, text, facts: research.facts }), {
      responseSchema: ENRICH_SCHEMA, priority: "high", model: RESEARCH_MODEL, temperature: 0.3, maxOutputTokens: 3072,
    })) as { paragraphs?: string[] } | null;
    const draft = (written?.paragraphs ?? []).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
    if (!draft) { note = "writing failed"; break; }

    const checked = await factCheckDraft(research.facts, draft);
    if (!checked) { note = "fact-check unavailable"; break; }
    // The check may return subheadings; a news report is plain paragraphs.
    const body = checked.body.split(/\n\n+/).map((p) => p.replace(/^##\s+/, "")).join("\n\n");
    const words = articleWords({ body, summary: null });
    // Under the indexing bar: published anyway only if it is a real step up and the short limit has room.
    let asShort = false;
    if (words < MIN_ENRICHED_WORDS) {
      asShort = shortCount < roomShort && acceptShortEnrichment(words, articleWords(story));
      if (!asShort) { record(story.id, "too-short", { facts: research.facts.length, outlets: research.sources.length, words }); continue; }
    } else if (enriched >= room) {
      continue; // full length but the main daily limit is used: left for tomorrow, not logged
    }
    if (isRepetitive(body)) {
      if (opts.dryRun) console.log(`[dry-run] repetitive prose: "${story.title}"`);
      record(story.id, "failed", { facts: research.facts.length, words, why: "repetitive prose" });
      continue;
    }
    // The writer talking about its own inputs ("the provided facts..."): never shown.
    const leaked = mentionsItsInputs(body);
    if (leaked) {
      if (opts.dryRun) console.log(`[dry-run] mentions its inputs ("${leaked}"): "${story.title}"`);
      record(story.id, "failed", { facts: research.facts.length, words, why: `mentions its inputs: ${leaked}` });
      continue;
    }
    // A figure the research never gave: the writer invented or mangled it.
    const unsupported = unsupportedFigures(body, research.facts, story.title);
    if (unsupported.length > 0) {
      if (opts.dryRun) console.log(`[dry-run] figures not in the facts (${unsupported.join(", ")}): "${story.title}"`);
      record(story.id, "failed", { facts: research.facts.length, words, why: `figures not in the facts: ${unsupported.join(", ")}` });
      continue;
    }

    const credit = creditLine(research.sources, story.sourceName);
    const finalBody = credit ? `${body}\n\n${credit}` : body;
    if (opts.dryRun) {
      console.log(`\n=== DRY RUN: "${story.title}" (${story.sourceName}), was ${articleWords(story)} words, now ${articleWords({ body: finalBody, summary: null })}; removed by check: ${JSON.stringify(checked.removed)}\n\n${finalBody}\n`);
      if (asShort) shortCount++; else enriched++;
      continue;
    }
    await db.update(article).set({ body: finalBody, updatedAt: new Date() }).where(eq(article.id, story.id));
    enrichedTitles.push(story.title);
    record(story.id, asShort ? "enriched-short" : "enriched", { facts: research.facts.length, outlets: research.sources.length, words, removed: checked.removed.length });
    if (asShort) shortCount++; else enriched++;
    console.log(`Enriched: "${story.title}" (${articleWords({ body: finalBody, summary: null })} words, ${research.facts.length} facts, ${checked.removed.length} removed by the check).`);
    // Indexable now (thinContent.ts): tell search engines it changed. A short one stays noindex.
    if (!asShort) await submitToIndexNow([articleUrl(story.slug)]);
  }

  // Merged with what is stored now: a local run and the workflow may both have
  // written since this one read the log.
  if (!opts.dryRun) await writeLog(pruneLog(mergeLogs(await readLog(), log), now));
  return { enriched, note };
}

if (require.main === module) {
  enrichTopStories(new Date(), { dryRun: process.argv.includes("--dry-run") })
    .then(({ enriched, note }) => {
      console.log(`Enrich top stories: ${enriched} enriched (${note}).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Enrich top stories failed:", err);
      process.exit(1);
    });
}
