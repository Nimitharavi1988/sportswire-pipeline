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
  return words.slice(0, maxWords).join(" ").replace(/[,;:—-]+$/, "") + "…";
}
