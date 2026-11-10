// Reel copy taken from the article itself when no AI can write it (2026-11-10: every free provider hit its daily limit and no reel went
// out anywhere, because each reel needs a hook and fact rows). Nothing is rewritten: the hook is the story's real headline and every row
// is the opening of a real sentence of the body, cut only at a clause break, so no fact can be invented. Plainer than the AI's copy, but
// a reel goes out. English only. Pure, unit-tested.
import { splitSentences, isCallToAction } from "../social/sentences";
import { dropRepeatedRows } from "./commentary";

const MAX_HOOK_WORDS = 16;
const MAX_HOOK_CHARS = 100;
const MAX_ROW_WORDS = 14;
const MAX_ROW_CHARS = 90;
const ROW_LABELS = ["The news", "Key detail", "Also", "More"];

const words = (s: string) => s.split(/\s+/).filter(Boolean);

// The headline as the hook. A long one is cut at its first separator (": ", " | ", " – ") when what is left is still a full thought.
export function fallbackHook(title: string): string | null {
  const clean = title.replace(/\s+/g, " ").trim();
  const fits = (s: string) => words(s).length >= 3 && words(s).length <= MAX_HOOK_WORDS && s.length <= MAX_HOOK_CHARS;
  if (fits(clean)) return clean.replace(/[.\s]+$/, "");
  const head = clean.split(/:\s|\s[|–—]\s/)[0];
  return head !== clean && words(head).length >= 4 && fits(head) ? head.replace(/[.\s]+$/, "") : null;
}

// One row from one sentence: whole when short enough, else cut at the last comma, semicolon or dash that leaves at least 5 words.
// Not usable: a sentence that does not start like a statement, has unbalanced brackets or a quotation, or has no clean cut.
function rowFrom(sentence: string): string | null {
  const s = sentence.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!/^(\p{Lu}|\d)/u.test(s)) return null;
  if (/^(speaking|having|looking|following|according|in contrast|meanwhile)/i.test(s)) return null;
  if (/["“”]/.test(s) || /\b(preview|kickoff|kick-off)\b/i.test(s)) return null;
  const ok = (t: string) => words(t).length >= 4 && words(t).length <= MAX_ROW_WORDS && t.length <= MAX_ROW_CHARS && (t.match(/\(/g) ?? []).length === (t.match(/\)/g) ?? []).length;
  if (ok(s)) return s;
  // Cut at the last comma, semicolon or dash that keeps a long head (8 to 14 words): a head that long is nearly always a whole statement.
  const breaks = [...s.matchAll(/[,;]\s+|\s[—–]\s/g)];
  let best: string | null = null;
  for (const m of breaks) {
    const head = s.slice(0, m.index);
    if (ok(head) && words(head).length >= 8) best = head;
  }
  return best;
}

export function fallbackPosterContent(title: string, body: string): { eyebrow: string; hook: string; rows: { label: string; value: string }[] } | null {
  if (!body || body.trim().length < 40) return null;
  const hook = fallbackHook(title);
  if (!hook) return null;
  const seen = new Set<string>();
  const candidates: { label: string; value: string }[] = [];
  for (const sentence of splitSentences(body).slice(0, 14)) {
    if (isCallToAction(sentence)) continue;
    const v = rowFrom(sentence);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); candidates.push({ label: "The news", value: v }); }
  }
  const rows = dropRepeatedRows(candidates, title, hook).slice(0, 4).map((r, i) => ({ label: ROW_LABELS[i], value: r.value }));
  return rows.length >= 3 ? { eyebrow: "SPORTS NEWS", hook, rows } : null;
}
