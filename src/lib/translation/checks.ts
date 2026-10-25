import { createHash } from "node:crypto";

// Pure helpers for the translation job (no DB/network) so the quality gate is
// unit-tested. Measured in the Phase 0 spike (PLAN.md): the lite model's real
// failure mode is returning the BODY untranslated, plus rare slips in numbers.

export interface Fields { title: string; summary: string; body: string }

// Fingerprint of the English text a translation was made from. When it changes
// (match articles are rewritten as scores come in; admin edits) the job
// re-translates.
export function sourceHash(f: Fields): string {
  return createHash("sha256").update(`${f.title}\u0000${f.summary}\u0000${f.body}`).digest("hex").slice(0, 32);
}

// "1,200" and "1.200" and "1200" must compare equal across languages, so
// strip separators inside a number ("2.5" and "2,5" both become "25" — only
// equality matters here, not the value).
function numbers(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

// Words that occur in English prose and (almost) never in Spanish. Names and
// quoted English are rare enough that a few hits are fine; a body that is
// still English hits dozens.
const ENGLISH_MARKERS = /\b(the|and|with|has|have|will|said|was|were|from|that|this|his|her|their|but|after|before)\b/gi;

export type CheckResult = { ok: true } | { ok: false; reason: string };

// "Matchday 5" may come out as "quinta jornada" or "cinco": a small number written as a word is
// still the number (pure, unit-tested).
const SPANISH_SMALL: Record<string, string[]> = {
  "1": ["uno", "una", "primer"], "2": ["dos", "segund"], "3": ["tres", "tercer"], "4": ["cuatro", "cuart"], "5": ["cinco", "quint"],
  "6": ["seis", "sext"], "7": ["siete", "séptim"], "8": ["ocho", "octav"], "9": ["nueve", "noven"], "10": ["diez", "décim"],
};
export function spelledOut(n: string, lowerSpanishText: string): boolean {
  return (SPANISH_SMALL[n] ?? []).some((w) => new RegExp(`(^|[^a-záéíóúñ])${w}`).test(lowerSpanishText));
}

export function checkTranslation(src: Fields, out: Partial<Fields> | null | undefined): CheckResult {
  if (!out || !out.title?.trim() || !out.summary?.trim() || !out.body?.trim()) return { ok: false, reason: "empty field" };

  const words = out.body.split(/\s+/).filter(Boolean).length || 1;
  const englishHits = (out.body.match(ENGLISH_MARKERS) ?? []).length;
  if (englishHits >= 3 && englishHits / words > 0.03) return { ok: false, reason: `body looks untranslated (${englishHits} English words)` };
  if (out.body.slice(0, 120).trim() === src.body.slice(0, 120).trim()) return { ok: false, reason: "body identical to source" };

  const ratio = out.body.length / Math.max(1, src.body.length);
  if (ratio < 0.7 || ratio > 1.7) return { ok: false, reason: `length ratio ${ratio.toFixed(2)}` };

  // Per field: a score present in the English headline must be in the Spanish
  // headline, not merely somewhere else in the article.
  for (const k of ["title", "summary", "body"] as const) {
    const have = new Set(numbers(out[k]!));
    const outText = out[k]!.toLowerCase();
    const missing = [...new Set(numbers(src[k]))].filter((n) => !have.has(n) && !spelledOut(n, outText));
    if (missing.length > 0) return { ok: false, reason: `numbers missing in ${k}: ${missing.slice(0, 5).join(",")}` };
  }

  // A story saved with one newline between paragraphs counts as several (the model
  // answers with blank lines, which is the same text).
  // Subheadings ("## ...") are not paragraphs: a translation may attach one to the text below it.
  const countParas = (t: string) => t.split(/\n+/).filter((p) => p.trim() && !p.trim().startsWith("## ")).length;
  const srcParas = countParas(src.body);
  const outParas = countParas(out.body);
  if (Math.abs(srcParas - outParas) > 1) return { ok: false, reason: `paragraphs ${srcParas} -> ${outParas}` };

  return { ok: true };
}

// URL slug from a translated title: lower-case, accents folded, a-z0-9 only.
export function slugFromTitle(title: string, uniqueSuffix: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(.{1,80})(?:-.*)?$/, "$1") // cut at a word boundary, never mid-word
    .replace(/-+$/g, "");
  return `${base || "articulo"}-${uniqueSuffix}`;
}

// Higher = translate sooner (trending story, boosted when it matches the
// audience's clubs/leagues/players).
export function priorityScore(trendingScore: number, title: string, priorityTerms: string[]): number {
  const t = title.toLowerCase();
  return trendingScore + (priorityTerms.some((p) => t.includes(p)) ? 1000 : 0);
}

// Applies per-sport daily limits to an already priority-sorted list: a new
// translation is kept only while its sport is under its cap (counting what was
// already translated in the last 24h). Re-translations of changed articles
// (isNew false) are never capped. A sport without a cap is unlimited.
// New translations of capped (noindex) stories, at most `cap` more in the
// period `usedSoFar` was counted over, highest priority first (items arrive
// sorted). Other stories and re-translations always pass (pure, unit-tested).
// `isThin` picks which items this cap counts (default: the `thin` flag), so two caps can run
// one after the other over different groups.
export function applyThinCap<T extends { isNew: boolean; thin: boolean }>(items: T[], usedToday: number, cap: number, isThin: (item: T) => boolean = (it) => it.thin): T[] {
  let used = usedToday;
  return items.filter((it) => {
    if (!it.isNew || !isThin(it)) return true;
    if (used >= cap) return false;
    used++;
    return true;
  });
}

export function applyDailyCaps<T extends { category: string; isNew: boolean }>(
  items: T[],
  usedToday: Record<string, number>,
  caps: Record<string, number>,
): T[] {
  const used = { ...usedToday };
  return items.filter((it) => {
    if (!it.isNew) return true;
    const cap = caps[it.category];
    if (cap === undefined) return true;
    if ((used[it.category] ?? 0) >= cap) return false;
    used[it.category] = (used[it.category] ?? 0) + 1;
    return true;
  });
}
