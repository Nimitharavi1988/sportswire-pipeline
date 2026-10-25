/**
 * Pure rules for researching a story from coverage the site already holds
 * (coverageResearch.ts). No database, no network: unit-tested.
 *
 * Why: web research (Google Search grounding) has no free tier on the models
 * the free Gemini project can use, and enrichment is meant to cost nothing.
 * But the ingest job already collects the same event from many outlets (the
 * "covered by an earlier story" rows are exactly those), each with its link.
 * Reading a few of those pages gives a multi-source fact base without a
 * paid search.
 */
import { significantWords, sharesWords } from "../titleSimilarity";
import { ungroundedNumbers } from "../llm/grounding";

export interface CoverageRow {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
}

export const MAX_SOURCES = 6;
// Looser than the repeat test (60% / 4 words): the aim is every story about the
// same game or event, including other angles on it (a recap, an injury, a
// quote). The 48-hour window and the extraction prompt (facts about the
// headline's event only) keep other events out.
export const RELATED_THRESHOLD = 0.25;
export const RELATED_MIN_OVERLAP = 2;
// Several stories from one outlet are different angles, not independent
// confirmation, so only two count.
export const MAX_PER_OUTLET = 2;
// Below this much text in total there isn't enough to write a report from.
export const MIN_TOTAL_CHARS = 1_200;
export const MIN_EXCERPT_CHARS = 60;
export const MAX_FACTS = 25;

export function isReadableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // A Google News redirect can never be read (runIngest.ts isGoogleNewsRedirect).
    return /^https?:$/.test(u.protocol) && u.hostname !== "news.google.com";
  } catch {
    return false;
  }
}

// The story itself plus other stories on the same event, at most two per
// outlet, readable pages first (pure, unit-tested).
export function pickRelated(story: CoverageRow, candidates: CoverageRow[], max: number = MAX_SOURCES): CoverageRow[] {
  const words = significantWords(story.title);
  const perOutlet = new Map<string, number>([[story.sourceName.toLowerCase(), 1]]);
  const others: CoverageRow[] = [];
  for (const c of candidates) {
    if (c.id === story.id) continue;
    const outlet = c.sourceName.toLowerCase();
    if ((perOutlet.get(outlet) ?? 0) >= MAX_PER_OUTLET) continue;
    if (!sharesWords(words, significantWords(c.title), RELATED_THRESHOLD, RELATED_MIN_OVERLAP)) continue;
    perOutlet.set(outlet, (perOutlet.get(outlet) ?? 0) + 1);
    others.push(c);
  }
  others.sort((a, b) => Number(isReadableUrl(b.sourceUrl)) - Number(isReadableUrl(a.sourceUrl)) || b.summary.length - a.summary.length);
  return [story, ...others].slice(0, max);
}

export interface Excerpt { outlet: string; text: string }

export function buildFactsPrompt(title: string, excerpts: Excerpt[]): string {
  return `You are the research desk of a sports news site. Several outlets covered the same event. Extract the facts a reporter could verify from their coverage.

Event (headline): "${title}"

Excerpts from the coverage:
${excerpts.map((e) => `=== ${e.outlet} ===\n${e.text}`).join("\n\n")}

Rules:
- List only facts that the excerpts above state, about the event in the headline. Ignore other events, adverts, subscription prompts, related-story lists and anything else that is page furniture.
- One fact per item, as a complete sentence, with every name, number, score, date and place exactly as written. Do not round, convert or work anything out.
- Name the team, club or side of every player, coach or driver in the fact itself ("Chiefs running back Kenneth Walker ..."), and only when the excerpts say so. If the excerpts don't make clear which side someone is on, leave that fact out.
- A quotation only word for word, with who said it (and where, if given).
- If the outlets disagree about a figure or a claim, leave that fact out.
- An opinion or a prediction is a fact only when attributed ("X said ...").
- At most ${MAX_FACTS} facts, the most important first. Add nothing from your own knowledge.`;
}

// The extracted facts that are safe to use: strings, deduplicated, and with no
// figure of three or more digits that is missing from the excerpts (pure,
// unit-tested). Returns the facts and how many were dropped.
export function keepGroundedFacts(raw: unknown, excerpts: Excerpt[]): { facts: string[]; dropped: number } {
  const all = excerpts.map((e) => e.text).join("\n");
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const facts: string[] = [];
  let dropped = 0;
  for (const item of list) {
    const fact = typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "";
    if (fact.length < 15) continue;
    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (ungroundedNumbers(fact, all).length > 0) { dropped++; continue; }
    facts.push(fact);
  }
  return { facts: facts.slice(0, MAX_FACTS), dropped };
}

// The outlets behind the excerpts, for the credit line (pure, unit-tested).
export function outletsOf(excerpts: Excerpt[]): string[] {
  return [...new Set(excerpts.map((e) => e.outlet))];
}
