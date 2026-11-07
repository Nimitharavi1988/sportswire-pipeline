// Which hook layout a no-photo (graphic) reel gets (2026-11-07), chosen by the story, from its real text and data only:
//  - "score":    a match with a known score -> the team badges and the score first, the headline smaller below.
//  - "question": the hook is a question -> a big question, with an open-loop tag ("3 quick facts").
//  - "number":   the hook carries a plain number (42 points) -> that number large above the headline.
//  - "headline": anything else -> the headline large in the upper-middle of the frame.
// The hero number and the labels are taken from the hook's own words, never invented. Pure, unit-tested.

export type HookLayout = "score" | "question" | "number" | "headline";

export interface HookHero {
  value: string; // "42", "78%", "$12"
  label: string; // "POINTS", or ""
}

const QUESTION_START = /^(why|how|will|is|are|can|could|should|did|does|do|who|what|when|where|would)\b/i;
// A plain number: 1 to 3 digits (thousands commas allowed), an optional decimal, optional % or leading currency. Not a year.
const PLAIN_NUMBER = /^[$€£]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/;

export function isQuestionHook(hook: string): boolean {
  const t = hook.trim();
  return t.endsWith("?") || QUESTION_START.test(t);
}

// The first plain number in the hook and the word after it as its label ("42 points" -> 42 / POINTS).
export function heroNumber(hook: string): HookHero | null {
  const tokens = hook.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[.,;:!?)"']+$/, "").replace(/^["'(]+/, "");
    if (!PLAIN_NUMBER.test(raw)) continue;
    const digits = raw.replace(/[^\d]/g, "");
    // A year (1900-2099) or anything too long to show big.
    if (digits.length === 4 && Number(digits) >= 1900 && Number(digits) <= 2099) continue;
    if (raw.length > 6) continue;
    const next = (tokens[i + 1] ?? "").replace(/[^A-Za-zÀ-ÿ'-]/g, "");
    return { value: raw, label: next.length > 0 && next.length <= 14 ? next.toUpperCase() : "" };
  }
  return null;
}

export function chooseHookLayout(i: { hook: string; hasScore: boolean }): { layout: HookLayout; hero: HookHero | null } {
  if (i.hasScore) return { layout: "score", hero: null };
  if (isQuestionHook(i.hook)) return { layout: "question", hero: null };
  const hero = heroNumber(i.hook);
  if (hero) return { layout: "number", hero };
  return { layout: "headline", hero: null };
}

// The open-loop tag under a question hook: true to the reel's own content (the number of fact cards it really has).
export function openLoopText(factCount: number): string | null {
  return factCount >= 2 ? `${factCount} quick facts` : null;
}
