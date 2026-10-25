/**
 * "Has this event already been covered?" for the news write-up step
 * (2026-10-04). Five or ten outlets run the same story (18 headlines about
 * Gavaskar on Rohit Sharma's 92 in one day; 43% of a day's cricket stories
 * repeated another's), and each got its own Gemini write-up and its own page.
 * Title similarity was only used to pick what to post to social media. Now a
 * story whose headline closely matches one already written up in the same
 * sport in the last 48 hours isn't written up: it's rejected as covered, the
 * way a story that can't be written is.
 *
 * Deliberately stricter than the social-posting check (60% overlap and 4
 * shared words, not 50% and 3): at 50% / 3 it merged different games
 * ("Florida put on upset alert before Mizzou" / "Ohio State put on upset
 * alert before Iowa"). Wrongly skipping a distinct story costs more than
 * letting a repeat through. Measured on 2,967 stories from two days: skips
 * 22% (cricket 20%).
 */
import { sharesWords, significantWords } from "../titleSimilarity";

export const COVERAGE_THRESHOLD = 0.6;
export const COVERAGE_MIN_OVERLAP = 4;
// How far back a story counts as already covering the event.
export const COVERAGE_WINDOW_MS = 48 * 60 * 60 * 1000;

// "cricket/ipl" and "cricket" are the same sport.
const sportOf = (category: string) => category.split("/")[0];

export function createCoverageIndex(rows: { title: string; category: string }[] = []) {
  const bySport = new Map<string, Set<string>[]>();
  const add = (title: string, category: string) => {
    const words = significantWords(title);
    if (words.size === 0) return;
    const sport = sportOf(category);
    const list = bySport.get(sport) ?? [];
    list.push(words);
    bySport.set(sport, list);
  };
  for (const r of rows) add(r.title, r.category);
  return {
    add,
    // Takes back one add() (a write-up reserved before the AI call that then
    // produced nothing, so later stories on the event aren't skipped for it).
    remove(title: string, category: string): void {
      const words = significantWords(title);
      const list = bySport.get(sportOf(category));
      if (!list || words.size === 0) return;
      const i = list.findLastIndex((w) => w.size === words.size && [...words].every((x) => w.has(x)));
      if (i >= 0) list.splice(i, 1);
    },
    isCovered(title: string, category: string): boolean {
      const words = significantWords(title);
      return (bySport.get(sportOf(category)) ?? []).some((w) => sharesWords(words, w, COVERAGE_THRESHOLD, COVERAGE_MIN_OVERLAP));
    },
  };
}

export const COVERED_REASON = "covered by an earlier story";
