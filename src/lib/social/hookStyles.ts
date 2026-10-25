/**
 * Hook styles for reels and Shorts. A story gets a type (recap, breaking, opinion, preview, general), the type has a
 * short list of styles that suit it. The hook writer returns one candidate per style, hookCheck.ts rejects any that go
 * beyond the article, and hookChoice.ts picks the best. The styles and the choice go into the hook writer prompt
 * (ingestion/commentary.ts) and into the decision log, so the reports can later show which styles get more views.
 *
 * The styles beyond the usual curiosity / hot take / breaking buckets: number, contrast ("5 sacks. Still lost."),
 * record (only when the article itself calls it one), reaction, stakes, and "what is still unknown".
 * Every style carries the same rule: use only what the article states (hookCheck.ts enforces it).
 */

export type HookStyle = "number" | "question" | "quote" | "reaction" | "contrast" | "record" | "breaking" | "stakes" | "hottake" | "next";
export type StoryType = "recap" | "breaking" | "opinion" | "preview" | "general";

export const STYLE_GUIDE: Record<HookStyle, string> = {
  number: "Build the hook around ONE number or result from the article that creates tension by itself, as two short fragments (for example \"168 yards. One win.\"). Use only numbers that appear in the article.",
  question: "Ask one short question that the article answers (who, how, why or what next). The answer must be in the article; never ask a question the article cannot answer.",
  quote: "Use a short exact quote from a named person, attributed: Name: \"quote\". The quote must appear word for word in the article.",
  reaction: "Lead with a named person's reaction, admission or reveal, in your own words and the article's own verb (for example \"Name admits X\", \"Name opens up on X\").",
  contrast: "Set a result against what the article says happened around it, using two real facts (for example \"5 sacks. Still lost.\"): the strong number first, the surprising outcome second.",
  record: "Lead with the record, first or milestone, but ONLY if the article itself calls it a record, a first, or historic. Otherwise use a different angle.",
  breaking: "Write it like a news alert: who did, signed, was ruled out or was named, plain and specific (for example \"X signs with Y\"). No hype words.",
  stakes: "Lead with what it means or what is now on the line, exactly as the article frames it.",
  hottake: "Lead with a named person's strong stance, attributed to them (for example \"Name wants X, not Y\", \"Name: X would Z\"). It must be their stance, not yours.",
  next: "Lead with what happens next or what is still unknown, stated as the article states it (for example an opponent not yet announced).",
};

export const STYLES_BY_TYPE: Record<StoryType, HookStyle[]> = {
  recap: ["number", "contrast", "record", "quote", "stakes"],
  breaking: ["breaking", "number", "stakes", "question", "next"],
  opinion: ["quote", "reaction", "hottake", "question"],
  preview: ["stakes", "question", "next", "number"],
  general: ["number", "question", "quote", "stakes"],
};

const BREAKING = /\b(signs?|signed|signing|ruled out|out for|will miss|traded?|trading|released|waived|fired|hired|named|appointed|announces?d?|officially|confirmed|suspended|retires?|injur(?:y|ed)|surgery|torn|deal)\b/i;
const RECAP = /\b\d{1,3}\s?[-–]\s?\d{1,3}\b[^.]{0,80}\b(beat|beats|defeat|defeats|defeated|win|wins|won|loss|lose|loses|lost|edge|edges|edged|overtime|top|tops|down)\b|\b(beat|beats|defeat|defeats|defeated|wins?|won|edges?|edged|tops?)\b[^.]{0,80}\b\d{1,3}\s?[-–]\s?\d{1,3}\b|\bfinal score\b/i;
const PREVIEW = /\b(preview|how to watch|what to know|ahead of|will face|tonight|this weekend|set to|odds|prediction|expected to)\b/i;
const OPINION = /\b(says?|said|slams?|fires back|defends?|criticiz|responds?|reacts?|blasts?|calls? for|wants?|argues?|admits?)\b/i;

// The story's type from its headline and the start of its text (pure, unit-tested).
export function storyTypeOf(title: string, body: string): StoryType {
  const head = `${title}. ${body.slice(0, 600)}`;
  const quotes = (body.match(/["“]/g) ?? []).length;
  if (RECAP.test(title) || RECAP.test(body.slice(0, 300))) return "recap";
  if (PREVIEW.test(title)) return "preview";
  if (OPINION.test(title) || quotes >= 4) return "opinion";
  if (BREAKING.test(head)) return "breaking";
  return "general";
}
