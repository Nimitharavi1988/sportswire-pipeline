/**
 * Is there enough real source text to write a story from? (2026-10-06)
 *
 * A write-up of 140 words from an 83-character snippet ("Full coverage from
 * Yahoo Sports...") or from a page that is mostly navigation can only be made
 * of invented detail, and a judge comparing 32 write-ups with their source
 * pages found about two thirds had at least one important claim the source
 * didn't support, with or without the free models (scripts/newsQualityAudit.ts).
 * So a story is written only from text that is long enough and about the
 * headline; otherwise it is left unwritten, like a story whose page can't be
 * read.
 *
 * MIN_GROUNDING_CHARS (env, a repo variable in the ingest workflow) sets the
 * length: unset or invalid is the default below; 0 turns the rule off.
 */
import { significantWords } from "../titleSimilarity";

export const DEFAULT_MIN_GROUNDING_CHARS = 500;
// Share of the headline's significant words that must appear in the source.
export const MIN_HEADLINE_OVERLAP = 0.4;

// The length setting from the environment (pure, unit-tested).
export function minGroundingChars(raw: string | undefined): number {
  const n = Number(raw?.trim());
  if (!raw || !Number.isFinite(n) || n < 0) return DEFAULT_MIN_GROUNDING_CHARS;
  return Math.floor(n);
}

// Why this text can't be written from, or null when it can (pure, unit-tested).
export function groundingProblem(title: string, text: string, minChars: number): string | null {
  const t = text.trim();
  if (t.length < minChars) return `source text too thin to write from (${t.length} chars, need ${minChars})`;
  const words = [...significantWords(title)];
  if (words.length >= 3) {
    const lower = t.toLowerCase();
    const found = words.filter((w) => lower.includes(w)).length;
    if (found / words.length < MIN_HEADLINE_OVERLAP) return "source text isn't about the headline (a navigation page or an unrelated one)";
  }
  return null;
}

// The longest candidate that passes, or why none did (pure, unit-tested).
export function bestSource(title: string, candidates: string[], minChars: number): { text: string } | { problem: string } {
  const sorted = candidates.map((c) => c.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return { problem: "no source text" };
  let firstProblem = "";
  for (const text of sorted) {
    const problem = groundingProblem(title, text, minChars);
    if (!problem) return { text };
    firstProblem ||= problem;
  }
  return { problem: firstProblem };
}
