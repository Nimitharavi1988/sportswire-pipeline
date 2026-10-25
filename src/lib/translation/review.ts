import { callGemini } from "../ingestion/commentary";
import type { LocaleConfig } from "../i18n/locales";
import type { Fields } from "./checks";

// Second opinion on a translation (PLAN.md): after the deterministic checks
// pass, a separate model call reads the English and the Spanish side by side
// like a bilingual sports editor and reports real problems. It exists because
// nobody on the team can judge the Spanish by eye, and number/length checks
// can't see a wrong meaning or unnatural wording.

export type Verdict = "ok" | "minor" | "major";
export interface Review { verdict: Verdict; issues: string[] }

// The reviewer runs on the standard Flash model, not the lite model that wrote
// the translation: a different (stronger) model is a more independent check.
export const REVIEW_MODEL = "gemini-flash-latest";

export function buildReviewPrompt(locale: LocaleConfig, src: Fields, out: Fields): string {
  return `You are a bilingual (English / Spanish) sports-news editor reviewing a machine translation into ${locale.promptName}.

Compare the Spanish translation with the English original and report ONLY real problems:
- meaning changed, wrong, or reversed; facts, numbers, scores, dates, names or quotes added, dropped or altered
- sentences left in English (other than proper names, team names, titles of works, quotes in English)
- wrong sport terminology or an unnatural/ungrammatical phrase a native reader would notice
Ignore pure style preferences and acceptable regional variants.
Today is ${new Date().toISOString().slice(0, 10)}: dates in the English original, including 2025 and 2026, are real and in the past or present as written. Never "correct" a year or call it a future date; a year that matches the English is correct.

Verdict:
- "ok": no real problems
- "minor": small wording issues that do not change the meaning
- "major": the meaning is wrong or a fact is missing/added/changed, or the Spanish is clearly broken
List each problem briefly in "issues" (empty if ok).

ENGLISH TITLE: ${src.title}
SPANISH TITLE: ${out.title}

ENGLISH SUMMARY: ${src.summary}
SPANISH SUMMARY: ${out.summary}

ENGLISH BODY:
${src.body}

SPANISH BODY:
${out.body}`;
}

// Pure: turn the model's JSON into a Review. Anything unparseable or
// unrecognised is treated as "major" so a broken review can never wave a
// translation through.
export function parseReview(parsed: unknown): Review {
  const p = parsed as { verdict?: unknown; issues?: unknown } | null;
  const verdict = p?.verdict;
  if (verdict !== "ok" && verdict !== "minor" && verdict !== "major") {
    return { verdict: "major", issues: ["review unavailable or malformed"] };
  }
  const issues = Array.isArray(p?.issues) ? p!.issues.filter((i): i is string => typeof i === "string").map((i) => i.trim()).filter(Boolean).slice(0, 8) : [];
  return { verdict, issues };
}

export async function reviewTranslation(locale: LocaleConfig, src: Fields, out: Fields): Promise<Review> {
  const parsed = await callGemini(buildReviewPrompt(locale, src, out), {
    model: REVIEW_MODEL,
    temperature: 0,
    maxOutputTokens: 1024,
    retries: 4,
    responseSchema: {
      type: "OBJECT",
      properties: {
        verdict: { type: "STRING", enum: ["ok", "minor", "major"] },
        issues: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["verdict", "issues"],
    },
  });
  return parseReview(parsed);
}
