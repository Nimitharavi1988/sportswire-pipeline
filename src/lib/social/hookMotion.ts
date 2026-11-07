// Timing for the animated reel hook (2026-11-07). The headline is built word by word in the first second, a key word is highlighted with an
// underline that draws itself in, and the first fact slides up at 3 s. Pure functions of time so they can be tested and used both by the
// frame renderer (previews) and, later, by the reel's ffmpeg layers. All times in seconds.

export const WORD_START = 0.25; // first word begins
export const WORD_GAP = 0.12; // between words
export const WORD_DURATION = 0.3; // one word's pop-in
export const FACT_AT = 3.0; // first fact line begins

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Ease-out with a small overshoot: the word lands slightly big, then settles.
export function easeOutBack(x: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  const t = clamp01(x) - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

// How far word i has popped in at time t (0 = not started, 1 = settled).
export function wordProgress(i: number, t: number): number {
  return clamp01((t - (WORD_START + i * WORD_GAP)) / WORD_DURATION);
}

// Scale and opacity of word i: grows from 78% with the overshoot, fading in over the first half of its pop.
export function wordStyle(i: number, t: number): { scale: number; opacity: number } {
  const p = wordProgress(i, t);
  if (p <= 0) return { scale: 0.78, opacity: 0 };
  return { scale: 0.78 + 0.22 * easeOutBack(p), opacity: clamp01(p * 2) };
}

// When the last word has settled.
export function headlineDoneAt(wordCount: number): number {
  return WORD_START + Math.max(0, wordCount - 1) * WORD_GAP + WORD_DURATION;
}

// The underline under the key word draws from left to right just after the headline is built.
export function underlineProgress(wordCount: number, t: number): number {
  const start = headlineDoneAt(wordCount) - 0.1;
  return easeOutCubic((t - start) / 0.4);
}

// A slide-up for a later line: offset in px (starts `from` below, ends at 0) and opacity.
export function slideUp(t: number, at: number, from = 50, dur = 0.35): { dy: number; opacity: number } {
  const p = easeOutCubic((t - at) / dur);
  return { dy: from * (1 - p), opacity: p };
}

// A number counting up to `target` between `start` and `start + dur`.
export function countUp(target: number, t: number, start: number, dur = 0.8): number {
  return Math.round(target * easeOutCubic((t - start) / dur));
}

// The word to highlight: the first number, else the longest capitalised word after the first, else the longest word.
export function keyWordIndex(words: string[]): number {
  const num = words.findIndex((w) => /\d/.test(w));
  if (num >= 0) return num;
  let best = -1;
  words.forEach((w, i) => {
    if (i > 0 && /^[A-ZÀ-Ý]/.test(w) && (best < 0 || w.length > words[best].length)) best = i;
  });
  if (best >= 0) return best;
  return words.reduce((b, w, i) => (w.length > words[b].length ? i : b), 0);
}
