// Sentences of a story's description for the voice and the short captions (2026-11-10). The old split broke after every full stop, so
// "Odell Beckham Jr. is joining the Vikings" was cut after "Jr." and the voice read a fragment ("Big move for the Vikings! Odell
// Beckham Jr."). This keeps abbreviations ("Jr.", "No. 1", "St.", initials) inside their sentence, and picks the sentences worth
// reading aloud: whole sentences, never a call to action ("Click the link", "Tell us in the comments"). Pure, unit-tested.

const SUFFIX = /\b(?:Jr|Sr|St|Mr|Mrs|Ms|Dr|Prof|Gen|Lt|Sgt|Capt|Inc|Co|Ltd|vs|v)\.$/;

// Splits at ". ", "! ", "? " but not after an abbreviation that is followed by more of the same sentence.
export function splitSentences(text: string): string[] {
  const pieces = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?]["”’)]?)\s+/).filter(Boolean);
  const out: string[] = [];
  for (const piece of pieces) {
    const prev = out[out.length - 1];
    const joinsPrev =
      prev !== undefined &&
      ((SUFFIX.test(prev) && /^[a-z0-9(]/.test(piece)) || // "... Beckham Jr." + "is joining" / "St." + "Louis" (a name with a capital too)
        (/\bSt\.$/.test(prev) && /^[A-Z]/.test(piece)) ||
        (/\bNo\.$/.test(prev) && /^\d/.test(piece)) || // "No." + "1 seed"
        (/(?:^|\s)[A-Z]\.$/.test(prev) && /^[A-Z]/.test(piece))); // an initial: "C." + "Stroud"
    if (joinsPrev) out[out.length - 1] = `${prev} ${piece}`;
    else out.push(piece);
  }
  return out;
}

export const isCallToAction = (s: string) =>
  /\b(click|tap|swipe)\b|\bread (the )?(full|more)\b|\bfull (story|breakdown)\b|\blink (below|in (the )?(bio|description|comments))\b|\btell us\b|\bin the comments\b|\bfollow (us|@)|\bsubscribe\b|\bwhat'?s your take\b/i.test(s);

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

// The description's own sentences, in order, as many whole ones as fit in maxWords: a one-sentence story reads that sentence (cut at a
// clause break by `cut` when it alone is too long), a longer one reads the first two or three. Sentences under 4 words are fragments and
// are skipped; calls to action never count. Returns "" when nothing readable is left.
export function readableDescription(description: string, maxWords: number, cut: (sentence: string, maxWords: number) => string): string {
  const sentences = splitSentences(description).filter((s) => !isCallToAction(s) && words(s) >= 4);
  if (sentences.length === 0) return "";
  const picked: string[] = [];
  let total = 0;
  for (const s of sentences) {
    const n = words(s);
    if (picked.length === 0 && n > maxWords) return cut(s, maxWords);
    if (total + n > maxWords) break;
    picked.push(s);
    total += n;
  }
  return picked.join(" ");
}
