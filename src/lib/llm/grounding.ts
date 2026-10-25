/**
 * A check on an AI write-up that doesn't depend on which AI wrote it
 * (2026-10-04). The write-up prompts forbid inventing facts, but the free
 * fallback models are less careful about it than Gemini. A figure in the
 * write-up that appears nowhere in the source text (a made-up score, record
 * or attendance) is the commonest invention, and the easiest to catch without
 * another AI call.
 */

const YEAR = /^(19|20)\d{2}$/;

// Numbers as digit strings: commas out ("1,632" is 1632), "+" and "%" ignored.
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
}

// The figures of three or more digits in `output` that `source` doesn't
// contain. Years aren't counted (a write-up may state the current year), and
// neither are figures shorter than three digits (they come from counting and
// ordinals too often to be worth a false alarm) (pure, unit-tested).
export function ungroundedNumbers(output: string, source: string): string[] {
  const known = new Set(numbersIn(source));
  const missing = new Set<string>();
  for (const n of numbersIn(output)) {
    if (n.replace(".", "").length < 3 || YEAR.test(n) || known.has(n)) continue;
    missing.add(n);
  }
  return [...missing];
}
