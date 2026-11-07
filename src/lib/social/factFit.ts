// How a fact card's value is set so it always fits the frame (2026-11-07: bottom text was sometimes cut). Four size steps by length, and a hard
// cap on the text so the biggest case is at most 4 lines at its size; a value over the cap is cut at a word with "…". Pure, unit-tested.

export interface FactFit {
  size: number;
  text: string;
}

const MAX_CHARS = 120;

export function fitFact(value: string): FactFit {
  const v = value.trim().replace(/\s+/g, " ");
  const size = v.length <= 14 ? 110 : v.length <= 30 ? 84 : v.length <= 60 ? 62 : 50;
  if (v.length <= MAX_CHARS) return { size, text: v };
  const cut = v.slice(0, MAX_CHARS - 1);
  const at = cut.lastIndexOf(" ");
  return { size, text: `${(at > MAX_CHARS * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–]+$/, "")}…` };
}

// Splits number-highlight parts (splitNumbers) into words, each word keeping its coloured pieces ("5th" stays one word, "5" coloured).
// Rendering words as separate wrapping items lets a long fact wrap onto lines instead of running off the frame as one unbreakable span.
export function wordsOf(parts: { text: string; num: boolean }[]): { text: string; num: boolean }[][] {
  const words: { text: string; num: boolean }[][] = [];
  let cur: { text: string; num: boolean }[] = [];
  for (const p of parts) {
    p.text.split(/(\s+)/).forEach((piece) => {
      if (piece === "") return;
      if (/^\s+$/.test(piece)) {
        if (cur.length) words.push(cur);
        cur = [];
      } else cur.push({ text: piece, num: p.num });
    });
  }
  if (cur.length) words.push(cur);
  return words;
}
