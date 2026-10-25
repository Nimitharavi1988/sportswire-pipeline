/**
 * Original stories written in admin (Write a story), and editor rewrites of
 * ingested ones. Pure helpers, unit-tested; the database work is in
 * src/app/admin/stories/actions.ts.
 *
 * An original story is an ordinary Article whose sourceName is the site
 * itself, with a byline (authorSlug -> Author). Written in plain text:
 * paragraphs separated by blank lines, a line starting "## " is a
 * subheading.
 */
import { slugifyTeam } from "./scores/matchKey";

export const ORIGINAL_SOURCE = "Sports Wire Live";

// Ranks an original story with the day's top stories (published trending
// scores run ~20 median, ~75 at p90, 120 max — checked 2026-09-26), so it
// leads the home page and is picked for social posting.
export const ORIGINAL_TRENDING_SCORE = 100;

// The kinds of original piece, shown as a label on the story and in the
// Analysis section.
export const STORY_KINDS = {
  analysis: "Analysis",
  preview: "Preview",
  opinion: "Opinion",
  feature: "Feature",
  report: "Match report",
} as const;
export type StoryKind = keyof typeof STORY_KINDS;

export function storyKindLabel(kind: string | null | undefined): string | null {
  return kind && kind in STORY_KINDS ? STORY_KINDS[kind as StoryKind] : null;
}

export const STORY_LIMITS = {
  title: { min: 10, max: 150 },
  summary: { min: 50, max: 300 },
  // A publishable story is a real piece, not a note: roughly 150+ words.
  body: { min: 800 },
};

export function isOriginalStory(a: { sourceName: string }): boolean {
  return a.sourceName === ORIGINAL_SOURCE;
}

export function storySlug(title: string, now: number = Date.now()): string {
  const base = slugifyTeam(title).slice(0, 80).replace(/-+$/, "");
  return `${base || "story"}-${now}`;
}

export function authorSlug(name: string): string {
  return slugifyTeam(name);
}

export interface StoryInput {
  title: string;
  summary: string;
  body: string;
  category: string;
  heroImageUrl: string | null;
}

// What's missing before a story can be published (drafts can be saved as
// they are). Empty when it's ready.
export function publishProblems(s: StoryInput, categories: string[]): string[] {
  const problems: string[] = [];
  const title = s.title.trim();
  const summary = s.summary.trim();
  if (title.length < STORY_LIMITS.title.min || title.length > STORY_LIMITS.title.max) {
    problems.push(`Headline must be ${STORY_LIMITS.title.min}-${STORY_LIMITS.title.max} characters.`);
  }
  if (summary.length < STORY_LIMITS.summary.min || summary.length > STORY_LIMITS.summary.max) {
    problems.push(`Summary must be ${STORY_LIMITS.summary.min}-${STORY_LIMITS.summary.max} characters.`);
  }
  if (s.body.trim().length < STORY_LIMITS.body.min) {
    problems.push(`The story needs at least ${STORY_LIMITS.body.min} characters (about 150 words).`);
  }
  if (!categories.includes(s.category)) problems.push("Choose a sport.");
  if (!s.heroImageUrl) problems.push("Add a photo.");
  // Notes left for the writer (e.g. by the AI draft: "[ADD: pitch report]").
  if (/\[(ADD|CHECK)\b/i.test(`${s.title} ${s.summary} ${s.body}`)) problems.push("Replace the [ADD: …] notes with real details first.");
  return problems;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// A body paragraph that's a subheading ("## Team news") -> its text.
export function subheading(paragraph: string): string | null {
  const m = paragraph.match(/^##\s+(.+)$/);
  return m ? m[1].trim() : null;
}
