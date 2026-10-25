/**
 * The paid review pass for local drafts (2026-10-06). The free models write a
 * draft; a stronger paid Gemini model then reads it against the researched
 * facts, rejects one that contradicts itself or the facts, and corrects small
 * slips by DELETING or repairing the sentence (never adding new facts). Only
 * drafts that pass reach the review page, so a reviewer isn't the one finding
 * "the Raiders have the bye" or "Hutchinson is a linebacker".
 *
 * One call per draft (about 4k tokens in, 2k out: a few cents a day at 5-8
 * drafts). It calls the paid key directly, not the router, so it can't compete
 * with the free slots, and the local script caps how many calls it may make.
 * The key is read from GEMINI_PAID_REVIEW_KEY (the script maps the paid
 * GEMINI_API_KEY into it); without one the pass is simply unavailable.
 */
import { RESEARCH_MODEL } from "./research";

export interface ReviewedText { title: string; summary: string; body: string }
export interface DraftReview {
  verdict: "pass" | "fix" | "reject";
  problems: string[];
  // A part the reviewer left out (it needed no change) is empty here and
  // keeps the original text in applyReview.
  corrected?: Partial<ReviewedText>;
}

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["pass", "fix", "reject"] },
    problems: { type: "ARRAY", items: { type: "STRING" } },
    correctedTitle: { type: "STRING", description: "Only for a fix: the corrected headline, just the headline" },
    correctedSummary: { type: "STRING", description: "Only for a fix: the corrected summary, just the summary" },
    correctedBody: { type: "STRING", description: "Only for a fix: the full corrected story text, paragraphs separated by blank lines" },
  },
  required: ["verdict", "problems"],
};

export function buildReviewPrompt(draft: ReviewedText, facts: string[]): string {
  return `You are the fact-checking editor of a sports news site. Below are FACTS (the only source of truth) and a DRAFT story written from them. Check the draft hard.

FACTS:
${facts.map((f) => `- ${f}`).join("\n")}

DRAFT
Headline: ${draft.title}
Summary: ${draft.summary}
Body:
${draft.body}

Look for, in this order:
1. Anything the facts do not state: events, numbers, quotes, injuries, records, who plays for whom, a person's role or position (e.g. a defensive end called a linebacker).
2. Contradictions inside the draft or against the facts: scores, leads, records, which team has a bye, who is injured, who played.
3. Judgments of a named person's character, motives or past conduct that the facts don't state and attribute.
4. Outlook filler and unsupported hype (a "statement win", "rout", "collapse" for what the facts show as a close game; "the clock is ticking"), and invented grades or labels with no basis in the facts.

Verdict:
- "pass": none of the above.
- "fix": a few small problems. Return the full corrected text in correctedTitle (the headline only), correctedSummary (the summary only) and correctedBody (the whole story, paragraphs separated by blank lines): repair a wrong detail only when the facts state the right one, otherwise DELETE the sentence. Never add any fact that is not in the FACTS. Keep the voice and structure; keep subheadings as lines starting with "## ".
- "reject": the draft contradicts itself or the facts in a way you cannot repair by deleting a sentence or two, or most of it is unsupported.
"problems": each problem found, one short line each (empty for "pass"). Be strict: when unsure whether a claim is in the facts, treat it as unsupported.`;
}

// The model sometimes puts the whole corrected story into one field, as
// "Headline\nSummary: ...\nBody:\n...". Splits that back into its parts, or
// returns null when the markers aren't there (pure, unit-tested).
export function splitPackedText(packed: string): ReviewedText | null {
  const m = /^([\s\S]*?)\r?\n\s*Summary:\s*([\s\S]*?)\r?\n\s*Body:\s*([\s\S]+)$/i.exec(packed.trim());
  if (!m) return null;
  const [title, summary, body] = [m[1], m[2], m[3]].map((x) => x.trim());
  return title && summary && body ? { title: title.replace(/^(?:Headline|Title):\s*/i, ""), summary, body } : null;
}

// The model's answer in a safe shape (pure, unit-tested).
export function parseReview(raw: unknown): DraftReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const verdict = r.verdict;
  if (verdict !== "pass" && verdict !== "fix" && verdict !== "reject") return null;
  const problems = Array.isArray(r.problems) ? r.problems.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim()) : [];
  if (verdict !== "fix") return { verdict, problems };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let corrected: Partial<ReviewedText> = { title: str(r.correctedTitle), summary: str(r.correctedSummary), body: str(r.correctedBody) };
  if (!corrected.body) {
    const packed = splitPackedText(str(r.correctedTitle));
    if (packed) corrected = packed;
  }
  // A "fix" must at least carry a corrected body; an unchanged headline or
  // summary is simply left out by the model.
  if (!corrected.body) return null;
  return { verdict, problems, corrected };
}

// The review's outcome for the draft (pure, unit-tested): the text to carry
// on with, or why to drop it.
export function applyReview(original: ReviewedText, review: DraftReview): { ok: true; text: ReviewedText; notes: string[] } | { ok: false; reason: string } {
  if (review.verdict === "reject") return { ok: false, reason: `paid review rejected it: ${review.problems.slice(0, 3).join("; ") || "unsupported claims"}` };
  if (review.verdict === "pass") return { ok: true, text: original, notes: ["Paid review: passed, no problems found."] };
  const c = review.corrected!;
  const corrected: ReviewedText = { title: c.title || original.title, summary: c.summary || original.summary, body: c.body || original.body };
  return { ok: true, text: corrected, notes: [`Paid review corrected ${review.problems.length} problem(s):`, ...review.problems.map((p) => `  - ${p}`)] };
}

// JSON.parse that returns null instead of throwing (pure, unit-tested). The review model can run on to its output limit
// (2026-10-17: a 43,000-character answer cut off mid-string), and a cut-off answer is not valid JSON.
export function parseJsonOrNull(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let paidCalls = 0;
export const paidReviewCalls = () => paidCalls;
// A paid call made elsewhere (the paid write pass) counts toward the same cap.
export const notePaidCall = () => { paidCalls++; };

export async function paidReviewDraft(draft: ReviewedText, facts: string[]): Promise<DraftReview | null> {
  const key = process.env.GEMINI_PAID_REVIEW_KEY;
  if (!key) return null;
  paidCalls++;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${RESEARCH_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildReviewPrompt(draft, facts) }] }],
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: REVIEW_SCHEMA,
          temperature: 0,
          maxOutputTokens: 8192,
        },
      }),
    });
    if (!res.ok) {
      console.error(`Paid review failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    // An answer that can't be read is a verdict on this draft (skip it), not on
    // the service: the run goes on.
    const json = parseJsonOrNull(text);
    if (json === null) {
      // Cut off or not JSON: a verdict on this draft (reject it), not on the service, so the run goes on.
      console.error(`Paid review answer was not valid JSON (${text.length} characters, finishReason ${data.candidates?.[0]?.finishReason}); rejecting this draft`);
      return { verdict: "reject", problems: ["the review answer was cut off or not valid JSON"] };
    }
    const parsed = parseReview(json);
    if (!parsed) {
      const raw = json as Record<string, unknown>;
      const shape = Object.entries(raw).map(([k, v]) => `${k}=${typeof v === "string" ? `string(${v.length})` : Array.isArray(v) ? `array(${v.length})` : typeof v}`).join(", ");
      console.error(`Paid review answer unreadable, shape: ${shape}; finishReason ${data.candidates?.[0]?.finishReason}`);
    }
    return parsed ?? { verdict: "reject", problems: ["the review answer could not be read"] };
  } catch (err) {
    console.error("Paid review error:", err);
    return null;
  }
}
