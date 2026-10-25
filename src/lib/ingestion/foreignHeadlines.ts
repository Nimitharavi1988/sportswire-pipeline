/**
 * Feeds written in another language (padel: Marca, Mundo Deportivo, PadelSpain).
 * The English site stores English headlines and the commentary step writes in
 * English from the source text, so a headline in Spanish must become English
 * first; the Spanish edition then translates the finished article back like any
 * other. Only NEW stories cost a Gemini call — a story already in the database
 * keeps its stored (English) title, so the 15-minute runs do not translate the
 * same feed again and again.
 */
import { inArray } from "drizzle-orm";
import type { RawMatchItem } from "./footballData";
import { callGemini } from "./commentary";
import { computeStableDedupeHash } from "./dedupe";

// New headlines translated per run (all feeds together): the feeds list about 50-100
// items, the pipeline publishes only a handful per run anyway.
export const MAX_NEW_HEADLINES_PER_RUN = 25;

export const FOREIGN_SOURCE_NOTE = "[The source text below is in Spanish. Write the article in English.]\n";

// One English headline per input, in order — or null when the answer cannot be
// trusted (wrong count, empty line), so the caller drops the items instead of
// publishing a Spanish headline on the English site (pure, tested).
export function parseHeadlines(parsed: unknown, expected: number): string[] | null {
  const titles = (parsed as { titles?: unknown } | null)?.titles;
  if (!Array.isArray(titles) || titles.length !== expected) return null;
  const out = titles.map((t) => (typeof t === "string" ? t.trim() : ""));
  return out.every((t) => t.length > 0) ? out : null;
}

async function translateHeadlines(titles: string[]): Promise<string[] | null> {
  const parsed = await callGemini(
    `Translate these Spanish sports headlines into natural English headlines. Keep names of people, teams and competitions as they are normally written. Do not add or remove facts. Return exactly ${titles.length} headlines, in the same order.\n\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    {
      temperature: 0,
      maxOutputTokens: 2048,
      retries: 2,
      responseSchema: { type: "OBJECT", properties: { titles: { type: "ARRAY", items: { type: "STRING" } } }, required: ["titles"] },
    }
  );
  return parseHeadlines(parsed, titles.length);
}

export async function englishifyForeignItems(items: RawMatchItem[]): Promise<RawMatchItem[]> {
  if (items.length === 0) return [];
  // Loaded here, not at the top, so importing rssFeeds (and its tests) needs no database.
  const { db } = await import("@/db");
  const { article } = await import("@/db/schema");
  const hash = (i: RawMatchItem) => computeStableDedupeHash(i.dedupeKey ?? i.sourceUrl);
  const existing = new Map(
    (await db.select({ h: article.dedupeHash, title: article.title }).from(article).where(inArray(article.dedupeHash, items.map(hash)))).map((r) => [r.h, r.title])
  );

  const out: RawMatchItem[] = [];
  const fresh: RawMatchItem[] = [];
  for (const item of items) {
    const stored = existing.get(hash(item));
    if (stored) out.push({ ...item, title: stored, originalTitle: item.title });
    else fresh.push(item);
  }

  const batch = fresh.slice(0, MAX_NEW_HEADLINES_PER_RUN);
  if (batch.length === 0) return out;
  const english = await translateHeadlines(batch.map((i) => i.title));
  if (!english) {
    console.error(`[foreignHeadlines] headline translation failed for ${batch.length} items; skipping them this run`);
    return out;
  }
  batch.forEach((item, i) => out.push({ ...item, title: english[i], originalTitle: item.title, sourceSnippet: item.sourceSnippet ? FOREIGN_SOURCE_NOTE + item.sourceSnippet : undefined }));
  return out;
}
