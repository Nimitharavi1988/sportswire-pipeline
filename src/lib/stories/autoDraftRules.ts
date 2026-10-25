/** Pure rules for automatic drafts (autoDraft.ts): limits, picking, checks. */
import type { StoryIdea } from "../storyIdeas";
import type { AiDraft } from "../aiDraft";
import type { DraftFormat } from "../aiDraft";
import type { PhotoResult } from "../photoSearch";
import { STORY_LIMITS } from "../stories";
import { articleWords } from "../thinContent";
import { MIN_ENRICHED_WORDS, isRepetitive, mentionsItsInputs } from "./enrichRules";

// Few and good (2026-10-04, was 2 a run / 6 a day): each draft now costs a
// web-research and a fact-check call, and a pile of AI drafts is exactly the
// "scaled content" AdSense rejects. One per run spreads them over the day.
export const MAX_DRAFTS_PER_RUN = 1;
export const MAX_DRAFTS_PER_DAY = 3;
// Ideas researched per run, drafted or not (each is a search call).
export const MAX_RESEARCH_PER_RUN = 3;
// Below this many researched facts there isn't enough for a real piece.
export const MIN_WEB_FACTS = 5;

// Who a draft is suggested to, by sport: the writers' beats as of 2026-10-04.
// Only a suggestion, shown as a note: the byline goes on when that writer has
// read and approved the piece, never automatically.
export const WRITER_BEATS: Record<string, string> = {
  football: "Pavana",
  cricket: "Robin",
  baseball: "Renjini",
  "american-football": "Vinaya",
  "college-football": "Vinaya",
  athletics: "Abhinav Earnest",
};
export const DEFAULT_WRITER = "Abhinav Earnest";

export function suggestedWriter(sport: string): string {
  return WRITER_BEATS[sport] ?? DEFAULT_WRITER;
}

// The formats that suit each kind of idea; one is picked at random so the
// drafts don't all read alike (pure given rnd, unit-tested).
const FORMATS_BY_KIND: Record<string, DraftFormat[]> = {
  preview: ["feature", "qa", "numbers"],
  report: ["takeaways", "numbers", "feature", "reportCard"],
  trend: ["qa", "feature", "takeaways"],
};
export function pickFormat(ideaKind: string, rnd: number = Math.random()): DraftFormat {
  const options = FORMATS_BY_KIND[ideaKind] ?? FORMATS_BY_KIND.trend;
  return options[Math.min(options.length - 1, Math.floor(rnd * options.length))];
}

// A suggested photo must name the subject in its title, so a search for
// "Shubman Gill" can't attach a stadium crowd or another player (pure,
// unit-tested). Matched on the surname, the part file names always carry.
export function pickPhoto(results: PhotoResult[], subject: string): PhotoResult | null {
  const surname = subject.trim().split(/\s+/).pop()?.toLowerCase();
  if (!surname || surname.length < 3) return null;
  return results.find((r) => r.title.toLowerCase().includes(surname)) ?? null;
}

// ---- Photos for clean drafts (2026-10-06) ---------------------------------
// The first drafts got a uniform chart, a 1958 trading card, a headquarters
// building and a logo (a name-only match on the file title). A usable photo is
// a real photograph, recent, of the subject.
const NOT_A_PHOTO = /uniform|logo|headquarters|topps|trading card|\bcards?\b|helmet|jersey|\bkits?\b|wordmark|flag|\bmap\b|diagram|\bseal\b|crest|badge|banner|poster|stamp|signature|autograph|statue|cartoon|sticker|stadium|arena|aerial|exterior|interior|building|roster|season|draft|logo|symbol|icon|screenshot/i;

export function isUsablePhoto(r: Pick<PhotoResult, "title" | "width" | "height" | "importUrl"> & { sourceName?: string }): boolean {
  // File names use underscores, which would defeat the word-boundary checks.
  const title = r.title.toLowerCase().replace(/_/g, " ");
  // Result titles carry no extension; the image address does.
  if (!/\.jpe?g$/.test((r.importUrl ?? title).split("?")[0].toLowerCase())) return false; // photographs, not PNG charts or SVG art
  if (NOT_A_PHOTO.test(title)) return false;
  if (r.width < 800) return false;
  // Wikimedia Commons only: Flickr titles are whatever the uploader typed (a
  // draft got a stranger eating chicken wings, 2026-10-06). No source name (a
  // stored photo being re-checked) is judged on its address alone.
  if (r.sourceName && r.sourceName !== "Wikimedia Commons") return false;
  // Any year in the file name must be recent: a 1958 card is not this week's
  // story, and a 2018 camp photo shows a player in his old team's uniform.
  const years = title.match(/\b(19|20)\d{2}\b/g)?.map(Number) ?? [];
  return years.every((y) => y >= 2022);
}

// The first usable photo whose file title names the subject by surname, or by a
// nickname given in `alsoMatch` (pure, unit-tested).
export function pickUsablePhoto(results: PhotoResult[], subject: string, alsoMatch: string[] = []): PhotoResult | null {
  return usablePhotos(results, subject, alsoMatch)[0] ?? null;
}

// All usable photos naming the subject, newest first, so a caller can skip one
// whose address turns out to be dead (pure, unit-tested).
export function usablePhotos(results: PhotoResult[], subject: string, alsoMatch: string[] = []): PhotoResult[] {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/['’.]/g, "");
  // Every word of the subject's name must be in the file title: a surname alone
  // ("Yadav") found "Dr. Raj Kumar Yadav of the Competition Commission" for
  // the cricketer Prince Yadav. Nicknames in `alsoMatch` match on their own.
  const words = norm(subject).split(/\s+/).filter((w) => w.length >= 2);
  const nicknames = alsoMatch.map(norm).filter((n) => n.length >= 3);
  if (words.length === 0 && nicknames.length === 0) return [];
  // Newest first: a 2025 photo beats a 2018 one of the same player.
  const year = (r: PhotoResult) => Math.max(0, ...(norm(r.title).match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? []));
  return results
    .filter((r) => {
      if (!isUsablePhoto(r)) return false;
      const t = norm(r.title);
      // The name as a phrase, not just its words anywhere ("Raj Kumar Yadav with Kuldeep Dalal" has both Kuldeep and Yadav).
      return (words.length > 0 && t.includes(words.join(" "))) || nicknames.some((n) => t.includes(n));
    })
    .sort((a, b) => year(b) - year(a));
}

// How well a photo fits the story: +2 when its title names one of the story's
// clubs (so the player is shown in that club's colours), +1 when it is from
// 2024 or later. A player photographed years ago may wear another team's kit
// (pure, unit-tested).
export function scorePhoto(r: Pick<PhotoResult, "title">, clubWords: string[]): number {
  const t = r.title.toLowerCase().replace(/_/g, " ");
  const year = Math.max(0, ...(t.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? []));
  return (clubWords.some((w) => w.length >= 4 && t.includes(w.toLowerCase())) ? 2 : 0) + (year >= 2024 ? 1 : 0);
}

// People named at least twice in the story, most mentioned first: the players
// worth searching a photo for (pure, unit-tested).
const NOT_A_NAME = /football|stadium|night|league|conference|division|bowl|week|state|university|college|field|park|center|centre|network|sports|news|press|association|coach|season|quarter|half|world|series|trophy|cup|first|second|third|fourth|sunday|monday|tuesday|wednesday|thursday|friday|saturday/i;
// Two-word places and teams that look like a name ("West Indies" found Usain Bolt and Obama).
const NOT_A_PERSON_PLACE = /\b(?:west indies|new zealand|south africa|sri lanka|united states|new york|new england|new orleans|los angeles|las vegas|kansas city|green bay|tampa bay|san francisco|san diego|san jose|saint louis|north carolina|south carolina|india|england|australia|pakistan|zimbabwe|bangladesh|afghanistan|ireland|scotland|netherlands)\b/i;
export function candidatePeople(body: string, clubNames: string[], max = 4): string[] {
  const clubs = clubNames.map((c) => c.toLowerCase());
  const names = new Set<string>();
  // Two capitalised words ("Tetairoa McMillan", "Amon-Ra St. Brown" up to its last part), after any
  // sentence-opening word ("The Carolina" is not a person).
  for (const m of body.matchAll(/\b([A-Z][A-Za-z'’-]*[a-z]\s+[A-Z][A-Za-z'’-]*[a-z](?:\s+(?:Jr\.?|III|II))?)\b/g)) {
    let name = m[1].replace(/\s+(Jr\.?|III|II)$/, "").replace(/^(?:The|A|An|On|In|At|With|After|Before|During|When|While|But|And|Meanwhile|However|For|By|From|Both|Each|This|That|His|Her|Their|Its|Our|Despite|Following)\s+/, "");
    name = name.replace(/['’]s$/, "");
    if (!/\s/.test(name)) continue;
    if (NOT_A_NAME.test(name) || NOT_A_PERSON_PLACE.test(name)) continue;
    // A club or its city ("San Francisco", "San Francisco 49ers") is not a person.
    if (clubs.some((c) => c.includes(name.toLowerCase()) || name.toLowerCase().includes(c))) continue;
    names.add(name);
  }
  // Mentions are counted by surname: a player is named in full once, then "McMillan".
  const mentions = (name: string) => {
    const surname = name.split(" ").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (body.match(new RegExp(`\\b${surname}\\b`, "g")) ?? []).length;
  };
  return [...names].map((name) => ({ name, n: mentions(name) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).map((x) => x.name).slice(0, max);
}

// Notes for the editor at the end of the draft, each kept as a [CHECK: …]
// line so the story can't be published until they're read and deleted.
export function editorNotes(n: { writer: string; sources: string[]; removed: number; photoSubject: string | null }): string[] {
  return [
    `Suggested writer: ${n.writer}. Put their byline on only after they have read and approved this draft.`,
    ...(n.photoSubject ? [`Photo picked automatically: check it shows ${n.photoSubject}, or choose another with Find a photo.`] : []),
    ...(n.removed > 0 ? [`The automatic fact-check removed or corrected ${n.removed} claim${n.removed === 1 ? "" : "s"} the research didn't support.`] : []),
    ...(n.sources.length > 0 ? [`Researched from: ${n.sources.join(", ")}.`] : []),
  ];
}
// Drafts nobody has opened yet: when the queue is this long, stop adding.
export const MAX_UNREVIEWED = 8;
// More gaps than this and the model had too little to go on.
export const MAX_ADD_NOTES = 4;

// One idea per kind in turn (trend, report, preview), so a run's few drafts
// aren't all the same kind. Each kind keeps its own order (pure, unit-tested).
export function pickIdeas(ideas: StoryIdea[], n: number): StoryIdea[] {
  const lanes = (["trend", "report", "preview"] as const).map((k) => ideas.filter((i) => i.kind === k));
  const picked: StoryIdea[] = [];
  for (let round = 0; picked.length < n; round++) {
    const row = lanes.map((l) => l[round]).filter(Boolean);
    if (row.length === 0) break;
    picked.push(...row.slice(0, n - picked.length));
  }
  return picked;
}

// The draft as stored: the facts to verify go in as [CHECK: …] paragraphs at
// the end, which publishProblems refuses to publish until they're deleted
// (pure, unit-tested).
export function draftBodyWithChecks(draft: Pick<AiDraft, "body" | "checks">): string {
  const checks = draft.checks.map((c) => `[CHECK: ${c.replace(/[\[\]]/g, "")}]`);
  return [draft.body, ...checks].join("\n\n");
}

// Review-pack drafts (the local draft script, 2026-10-06): the story text is
// saved CLEAN, with no [ADD]/[CHECK] notes in it, so a reviewer reads it, reads
// the pack beside it and approves, with no editing. A draft that still has a
// gap or a note in the text is not saved (pure, unit-tested).
export function cleanDraftProblem(draft: AiDraft): string | null {
  const base = draftProblem(draft);
  if (base) return base;
  // A story written here is always indexed (thinContent.ts exempts originals),
  // so a short one would be a thin indexed page: it needs the same bar as an
  // enriched report.
  if (articleWords({ body: draft.body, summary: null }) < MIN_ENRICHED_WORDS) return "under the length bar";
  if (mentionsItsInputs(draft.body)) return "talks about its own inputs";
  if (isRepetitive(draft.body)) return "repetitive prose";
  if (/\[(ADD|CHECK)\b/i.test(`${draft.title} ${draft.summary} ${draft.body}`)) return "has notes or gaps in the text";
  return null;
}

// What the reviewer sees beside a clean draft (stored as a DataSnapshot row
// "draft:review:<id>", shown on /admin/stories/review).
export interface ReviewPack {
  writer: string;
  format: string;
  kind: string;
  sport: string;
  sources: string[];
  facts: string[];
  checks: string[];
  removed: number;
  photoSubject: string | null;
  createdAt: string;
}
export const reviewPackKey = (articleId: string) => `draft:review:${articleId}`;

// Whether a draft is worth a writer's time (pure, unit-tested).
export function draftProblem(draft: AiDraft): string | null {
  if (draft.title.length < STORY_LIMITS.title.min || draft.title.length > STORY_LIMITS.title.max) return "headline length";
  if (draft.summary.length < STORY_LIMITS.summary.min || draft.summary.length > STORY_LIMITS.summary.max) return "summary length";
  if (draft.body.length < STORY_LIMITS.body.min) return "too short";
  if ((draft.body.match(/\[ADD\b/gi) ?? []).length > MAX_ADD_NOTES) return "too many gaps";
  return null;
}
