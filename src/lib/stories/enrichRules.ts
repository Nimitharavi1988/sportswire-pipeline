/** Pure rules for enriching top stories (enrich.ts): caps, picking, the log. */
import { hasRealImage, isImageUrlBlocked } from "../contentQuality";
import { MIN_INDEXED_WORDS, articleWords, isNotAStory } from "../thinContent";
import { ungroundedNumbers } from "../llm/grounding";
import { significantWords, sharesWords } from "../titleSimilarity";

// Fifteen a day from 2026-10-06 (the pilot ran at 6 first; was 10 while research
// cost money, it is free now, so
// coverageResearch.ts), two a run: a steady flow of substantial indexed pages
// (about 180 a month at 6, 450 at 15) without the volume itself becoming the "scaled content"
// problem the noindex rule fixed. Raise only after reading what it produces.
// PAUSED from 2026-10-20 until the job has a fact-check against the real world. The audit of 2026-10-19 found a verified-false
// claim on 78% of the enriched pages (wrong dates, scores, names), because the writer and its checker are free models working
// from other outlets' text. Set ENRICH_PAUSED=0 (repository variable, or in a local run) to resume; anything else keeps it off.
export function enrichmentPaused(env: Record<string, string | undefined> = process.env): boolean {
  return env.ENRICH_PAUSED?.trim() !== "0";
}

export const MAX_ENRICH_PER_RUN = 2;
export const MAX_ENRICH_PER_DAY = 15;
// Stories researched per run, enriched or not (each is a search call).
export const MAX_ENRICH_RESEARCH_PER_RUN = 4;
// Below this many researched facts there isn't enough for a full report.
export const MIN_ENRICH_FACTS = 6;
// The rewritten story must clear the indexing bar (the same word count decides
// indexing, and the credit line adds ~10 more words after this check), so a
// small margin is enough: 305.
export const MIN_ENRICHED_WORDS = MIN_INDEXED_WORDS + 5;
// A result under that bar is still published (it stays noindex, so it cannot affect the
// indexed-content picture) when it is a real step up: at least this many words and at
// least 1.5x the original. It has its own daily limit and does not use up the main one.
export const MIN_SHORT_ENRICHED_WORDS = 200;
export const SHORT_ENRICH_GROWTH = 1.5;
export const MAX_SHORT_ENRICH_PER_DAY = 20;

// Whether a result under the indexing bar is worth publishing anyway (pure, unit-tested).
export function acceptShortEnrichment(words: number, originalWords: number): boolean {
  return words >= MIN_SHORT_ENRICHED_WORDS && words < MIN_ENRICHED_WORDS && words >= originalWords * SHORT_ENRICH_GROWTH;
}
// How long attempts are remembered (stories older than a day aren't
// candidates anyway).
export const LOG_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

// The limits can be raised without a deploy (GitHub variables ENRICH_MAX_PER_DAY,
// ENRICH_MAX_PER_RUN, ENRICH_MAX_RESEARCH_PER_RUN, or the same names in the
// environment of a local run). Empty, missing or invalid means the defaults
// above (pure, unit-tested).
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return raw && Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}
export function enrichLimitsFrom(env: Record<string, string | undefined>): { perRun: number; perDay: number; researchPerRun: number; perDayShort: number } {
  return {
    perRun: positiveInt(env.ENRICH_MAX_PER_RUN, MAX_ENRICH_PER_RUN),
    perDay: positiveInt(env.ENRICH_MAX_PER_DAY, MAX_ENRICH_PER_DAY),
    researchPerRun: positiveInt(env.ENRICH_MAX_RESEARCH_PER_RUN, MAX_ENRICH_RESEARCH_PER_RUN),
    perDayShort: positiveInt(env.ENRICH_SHORT_MAX_PER_DAY, MAX_SHORT_ENRICH_PER_DAY),
  };
}

export type EnrichResult = "enriched" | "enriched-short" | "few-facts" | "too-short" | "failed";
// detail: why this result, kept so the thresholds can be tuned from real runs
// (facts found, outlets read, words written, figures not in the facts...).
export interface EnrichLogEntry { id: string; at: string; result: EnrichResult; detail?: Record<string, number | string> }

// The writer sometimes talks about its own inputs ("the provided facts do not
// repeat his goal record", "no further details are provided"), seen in the
// 2026-10-06 local dry run. A reader must never see that, so an article that
// does is not used (pure, unit-tested).
const META_LEAK = /\b(?:provided facts?|verified facts?|the facts (?:do|does|state|say|provided|given)|facts (?:are|is) (?:not )?(?:provided|given|available)|(?:is|are|was|were) (?:not )?provided|(?:not|no [a-z ]{0,40}) (?:are|is) (?:provided|given|available)|the (?:research|excerpts?)|according to the (?:facts|provided)|the report (?:concludes|notes that no))\b/i;
export function mentionsItsInputs(body: string): string | null {
  return META_LEAK.exec(body)?.[0] ?? null;
}

// Machine-sounding prose: the same sentence opening three or more times
// ("Dave Williams stated that ..." seven times in one article, 2026-10-06), or
// the same seven words twice. Such an article is not used (pure, unit-tested).
export function isRepetitive(body: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const openings = new Map<string, number>();
  for (const sentence of body.split(/(?<=[.!?])\s+/)) {
    const w = words(sentence);
    if (w.length < 6) continue;
    const key = w.slice(0, 4).join(" ");
    openings.set(key, (openings.get(key) ?? 0) + 1);
  }
  if ([...openings.values()].some((n) => n >= 3)) return true;
  const all = words(body);
  const seen = new Set<string>();
  for (let i = 0; i + 7 <= all.length; i++) {
    const gram = all.slice(i, i + 7).join(" ");
    if (seen.has(gram)) return true;
    seen.add(gram);
  }
  return false;
}

// One enriched report per event: four near-identical Ovechkin pieces were
// written on 2026-10-06, which reads as the scaled content the site is
// avoiding. A story whose headline is about the same event as one already
// enriched (in the last two days, or earlier this run) is skipped
// (pure, unit-tested).
export function sameEventAsEnriched(title: string, enrichedTitles: string[]): boolean {
  const words = significantWords(title);
  return enrichedTitles.some((t) => sharesWords(words, significantWords(t), 0.25, 2));
}

// Figures of three or more digits in the finished article that none of the
// researched facts (or the headline) contain: a sign the writer invented or
// mangled a number, so the article is not used (pure, unit-tested).
export function unsupportedFigures(body: string, facts: string[], title: string): string[] {
  return ungroundedNumbers(body, [title, ...facts].join(String.fromCharCode(10)));
}

export interface EnrichCandidate {
  id: string;
  title: string;
  body: string | null;
  summary: string;
  heroImageUrl: string | null;
  homeCrestUrl: string | null;
}

// The day's stories worth enriching, in the order given (highest trending
// first): a real story with a real photo, still under the indexing bar, not
// tried before (pure, unit-tested).
export function pickCandidates<T extends EnrichCandidate>(rows: T[], log: EnrichLogEntry[], n: number): T[] {
  const tried = new Set(log.map((e) => e.id));
  return rows
    .filter((r) => !tried.has(r.id))
    .filter((r) => !isNotAStory(r.title))
    .filter((r) => hasRealImage(r) && !isImageUrlBlocked(r.heroImageUrl))
    .filter((r) => articleWords(r) < MIN_INDEXED_WORDS)
    .slice(0, n);
}

// Two jobs can write the log at once (the workflow and a local run): keep every
// entry either one has, so neither erases the other's record (pure, unit-tested).
export function mergeLogs(a: EnrichLogEntry[], b: EnrichLogEntry[]): EnrichLogEntry[] {
  const seen = new Map<string, EnrichLogEntry>();
  for (const e of [...a, ...b]) seen.set(`${e.id}|${e.at}|${e.result}`, e);
  return [...seen.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

// The log without entries older than LOG_KEEP_MS (pure, unit-tested).
export function pruneLog(log: EnrichLogEntry[], now: Date): EnrichLogEntry[] {
  return log.filter((e) => now.getTime() - Date.parse(e.at) < LOG_KEEP_MS);
}

export function enrichedToday(log: EnrichLogEntry[], now: Date): number {
  return log.filter((e) => e.result === "enriched" && now.getTime() - Date.parse(e.at) < 24 * 60 * 60 * 1000).length;
}

export function enrichedShortToday(log: EnrichLogEntry[], now: Date): number {
  return log.filter((e) => e.result === "enriched-short" && now.getTime() - Date.parse(e.at) < 24 * 60 * 60 * 1000).length;
}

// The writing prompt (pure, unit-tested).
export function buildEnrichPrompt(s: { title: string; sourceName: string; text: string; facts: string[] }): string {
  return `You are a sports news writer. Write a full news report on this story for Sports Wire Live.

Headline (keep the story about exactly this): ${s.title}
First reported by: ${s.sourceName}
What our short version said (background only; do not copy its wording):
"""
${s.text}
"""

Verified facts from today's reporting (the ONLY facts you may state):
${s.facts.map((f) => `- ${f}`).join("\n")}

Rules:
- A news report, not an opinion piece: open with the most important facts, then the details and the context (results, standings, records, what led here), all from the facts above. Say what happens next ONLY if a fact names it (a date, an opponent, a decision); otherwise end on the last real fact.
- No filler: never write general outlook or commentary such as "both teams will need to...", "remains to be seen", "will test whether" or "a catalyst for improvement", and never call a team's form a "surge", "run" or "streak" unless a fact states it. Use more of the facts instead (standings, records, individual numbers, quotes).
- Never invent anything: no names, numbers, quotes, dates or events that aren't in the facts. Quotes only word for word as given, with who said them.
- Say which team or side a person belongs to only where a fact says so; never work it out yourself, and never describe how a game "turned" or who "had momentum" beyond what the facts state.
- Your own words throughout; don't copy sentences from the facts or the short version.
- 350-550 words if the facts support it; never pad with filler or repeat a point.
- Never talk about your inputs or what is missing: no "the facts", "provided", "verified", "the report concludes", "no further details are provided". If something is not known, leave it out silently. No speculation about what might happen (no "could", "pending clearances", "ready for the second half").
- Plain paragraphs only: no subheadings, bullet points, bold or emojis. Don't mention the sources, the research or these instructions.`;
}

// The closing credit: the other outlets the research drew on (the original
// publisher is already credited on the page). Pure, unit-tested.
// Social, video and aggregator sites aren't outlets to credit (seen in
// testing 2026-10-04: youtube.com, ground.news).
const NOT_AN_OUTLET = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|reddit\.com|ground\.news|news\.google\.com|msn\.com|wikipedia\.org)$/;

// Names are compared without spaces or punctuation ("Yahoo Sports" is
// "yahoosports", as is a site called yahoosports.com), so the original publisher
// is not credited a second time (seen in the 2026-10-05 dry run).
const GENERIC_LABEL = new Set(["sports", "sport", "news", "www"]);
const normName = (s: string) => s.toLowerCase().replace(/^www./, "").replace(/[^a-z0-9.]/g, "");

export function creditLine(sources: string[], originalSource: string): string | null {
  const original = normName(originalSource);
  const seen = new Set<string>();
  const others = sources.filter((s) => {
    const site = normName(s);
    if (!site || seen.has(site) || NOT_AN_OUTLET.test(site)) return false;
    const label = site.split(".")[0];
    const sameAsOriginal = site.includes(original) || original.includes(site) || (label.length >= 4 && !GENERIC_LABEL.has(label) && original.includes(label));
    if (sameAsOriginal) return false;
    seen.add(site);
    return true;
  });
  return others.length > 0 ? `This report also draws on coverage from ${others.slice(0, 5).join(", ")}.` : null;
}
