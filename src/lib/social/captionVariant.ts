// A/B split for caption tests: each story gets "hook" or "control" by its id, so
// the two versions run side by side on the same Page and the same days, and the
// version a story got can be recomputed later (no database field needed).
export type CaptionVariant = "hook" | "control";

export function captionVariantFor(articleId: string): CaptionVariant {
  let h = 0;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "hook" : "control";
}

// The short main-Page reel caption (2026-10-13 test): reels from the main Page averaged 2 to 12 plays
// each with 60-word captions that end in "Click the link" and a bare URL, which a viewer cannot tap
// and which tells Facebook the reel leads off the platform. The "hook" half of the stories get only the
// opening sentence, cut at maxWords, with no link; the photo credit and hashtags are added by the
// caller. Pure, unit-tested.
export function shortReelCaption(caption: string, maxWords = 22): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  // Sentences end at . ! or ? and a space; a fragment under 8 words ("... to No.") is joined to the next one.
  const parts = flat.split(/(?<=[.!?])\s+/);
  let first = parts[0] ?? "";
  for (let k = 1; first.split(" ").length < 8 && k < parts.length; k++) first += " " + parts[k];
  const words = first.split(" ");
  if (words.length <= maxWords) return first;
  // A sentence a little over the limit stays whole: cutting it mid-thought ("...caused by the realization that a rematch…")
  // leaves a caption that reads badly and gives search nothing to read. Past the hard limit it is cut at the last clause break
  // (comma, semicolon, dash) that leaves at least 12 words, and only then at the word limit.
  if (words.length <= maxWords + 8) return first;
  const head = words.slice(0, maxWords + 8);
  for (let i = head.length - 1; i >= 11; i--) {
    if (/[,;—–]$/.test(head[i])) return head.slice(0, i + 1).join(" ").replace(/[,;:—–-]+$/, "") + ".";
  }
  return words.slice(0, maxWords).join(" ").replace(/[,;:—-]+$/, "") + "…";
}

// Topic-Page reel captions (2026-10-28, from Facebook's own reel suggestions): a caption that ends in a debate question
// gets the question moved to the front, so it is the first line a viewer reads. A caption with no closing question, or
// one that is only a question, is returned as it was. Pure, unit-tested.
export function questionFirst(caption: string): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  const parts = flat.split(/(?<=[.!?]["”’)]?)\s+/);
  if (parts.length < 2) return caption;
  const last = parts[parts.length - 1];
  if (!/\?["”’)]?$/.test(last) || last.split(" ").length < 3) return caption;
  return `${last}\n\n${parts.slice(0, -1).join(" ")}`;
}
