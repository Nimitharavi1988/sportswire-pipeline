/**
 * Recent form for the reel's score strip (2026-10-18): each side's last five results before the match, newest first,
 * as W / D / L chips. Read from the same match rows the scores pages use, never from story text.
 *
 * Accuracy first: form is left off (null) whenever it could be wrong or thin: fewer than MIN_RESULTS finished games,
 * or any one of the last five without a clear result. Only football has draws; in every other sport a finished game
 * with no winner (a cricket tie, abandoned or no-result match) is unclear, so we show nothing rather than guess.
 */
import type { ScoreMatch } from "../scores/scoreboardModel";

export const FORM_LOOKBACK_DAYS = 60;
export const FORM_MAX = 5;
export const MIN_RESULTS = 3;

const LETTERS = {
  en: { W: "W", D: "D", L: "L" },
  es: { W: "G", D: "E", L: "P" },
} as const;

// The result of `team` in a finished match: W, D, L, or null when unclear. Pure.
function resultFor(team: string, m: ScoreMatch): "W" | "D" | "L" | null {
  const side = m.home.name === team ? m.home : m.away.name === team ? m.away : null;
  const other = side === m.home ? m.away : m.home;
  if (!side || side.score == null || other.score == null) return null;
  if (side.winner) return "W";
  if (other.winner) return "L";
  if (m.sport === "football" && side.score === other.score) return "D";
  return null;
}

// Pure, unit-tested. `current` is the match on the strip: it and anything not finished before it are excluded.
export function formFor(team: string, matches: ScoreMatch[], current: ScoreMatch, language: "en" | "es" = "en"): string[] | null {
  if (!current.kickoffAt) return null;
  const before = new Date(current.kickoffAt).getTime();
  const seen = new Set<string>();
  const past: ScoreMatch[] = [];
  const sorted = matches
    .filter((m) => m.id !== current.id && m.state === "final" && m.kickoffAt && new Date(m.kickoffAt).getTime() < before)
    .sort((a, b) => new Date(b.kickoffAt!).getTime() - new Date(a.kickoffAt!).getTime());
  // The same game can be stored twice (two providers, or filed under both "Football" and the league), which
  // would count it twice: keep one row per pair of sides per calendar day.
  past.length = 0;
  for (const m of sorted) {
    const key = [m.home.name, m.away.name].sort().join("|") + "|" + m.kickoffAt!.slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    past.push(m);
    if (past.length === FORM_MAX) break;
  }
  if (past.length < MIN_RESULTS) return null;
  const results = past.map((m) => resultFor(team, m));
  if (results.some((r) => r === null)) return null;
  const letters = LETTERS[language];
  return results.map((r) => letters[r!]);
}
