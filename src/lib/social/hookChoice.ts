/**
 * Choosing the best hook for a story (pure, unit-tested). The hook writer returns several candidate hooks, one per
 * style that suits the story; each is checked against the article (hookCheck.ts), the valid ones are scored, and the
 * best is used. A small share of stories (EXPLORE_SHARE, by article id) takes a random valid candidate instead of the
 * top-scored one, so every style keeps being tried and the reports can show which really perform. All candidates, their
 * scores, the check results and the choice are kept in the decision log for the analysis system to learn from.
 */
import { checkHook, safeHookFromTitle } from "./hookCheck";
import type { HookStyle } from "./hookStyles";

export interface HookCandidate { style: HookStyle | "model"; hook: string }
export interface ScoredCandidate extends HookCandidate { score: number; ok: boolean; problems: string[] }
export interface HookChoice { hook: string; style: HookStyle | "model" | "fallback"; by: "best" | "explore" | "fallback"; candidates: ScoredCandidate[] }

// Starting weights per style: the top-viewed sports Shorts so far were mostly a named person plus a reaction, a
// record or a question (commentary.ts). Modest priors to be replaced by measured results (decision log + reports).
export const STYLE_PRIOR: Record<HookStyle | "model", number> = {
  quote: 1.15, reaction: 1.15, number: 1.1, hottake: 1.05, question: 1.05, record: 1.0, contrast: 1.0, breaking: 1.0, stakes: 0.95, next: 0.9, model: 1.0,
};
export const EXPLORE_SHARE = 0.2;

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
const overlap = (a: string, b: string) => { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

// How strong a hook reads (higher is better), before the style prior. Pure and deliberately simple.
export function scoreHook(hook: string, style: HookStyle | "model", title: string): number {
  const n = hook.trim().split(/\s+/).filter(Boolean).length;
  let s = 1;
  if (n >= 4 && n <= 9) s += 0.2; else if (n > 10) s -= 0.3; else if (n < 3) s -= 0.3;
  if (/\d/.test(hook)) s += 0.15;
  if (hook.split(/\s+/).slice(1).some((t) => /^\p{Lu}\p{Ll}/u.test(t.replace(/^[^\p{L}]+/u, "")))) s += 0.15; // a named person or team
  if (overlap(hook, title) > 0.8) s -= 0.2; // just the headline again
  if (/^(breaking|big news|you won't believe)/i.test(hook)) s -= 0.4;
  // Abstract, report-like wording stops no one ("critiques the proposed transition"); a contrast or a limit does
  // ("16, not 24", "Still won", "only two").
  if (/\b(critiques?|proposed|potential|transition|discusses|regarding|reflects?|addresses|amid|following)\b/i.test(hook)) s -= 0.25;
  if (/\b(not|still|only|instead|never|first|last|but|without)\b/i.test(hook)) s += 0.15;
  return Math.round(s * STYLE_PRIOR[style] * 1000) / 1000;
}

// A stable value in [0, 1) from the article id, for the explore decision and the explore pick.
function unit(id: string, salt: string): number {
  let h = 0;
  for (const c of `${id}|${salt}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 10000) / 10000;
}

export function chooseHook(raw: HookCandidate[], title: string, body: string, articleId: string): HookChoice {
  const seen = new Set<string>();
  const candidates: ScoredCandidate[] = [];
  for (const c of raw) {
    const hook = (c.hook ?? "").replace(/\s+/g, " ").trim();
    if (!hook || seen.has(hook.toLowerCase())) continue;
    seen.add(hook.toLowerCase());
    const check = checkHook(hook, title, body);
    candidates.push({ style: c.style, hook, ok: check.ok, problems: check.problems, score: scoreHook(hook, c.style, title) });
  }
  const valid = candidates.filter((c) => c.ok).sort((a, b) => b.score - a.score);
  if (!valid.length) return { hook: safeHookFromTitle(title), style: "fallback", by: "fallback", candidates };
  if (valid.length > 1 && unit(articleId, "explore") < EXPLORE_SHARE) {
    const pick = valid[Math.floor(unit(articleId, "pick") * valid.length)];
    return { hook: pick.hook, style: pick.style, by: "explore", candidates };
  }
  return { hook: valid[0].hook, style: valid[0].style, by: "best", candidates };
}
