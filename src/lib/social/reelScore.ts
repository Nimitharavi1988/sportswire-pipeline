/**
 * A scoreboard strip above the photo of a reel (2026-10-15). The most-viewed sports Shorts and reels of the week
 * often showed the score over the image; ours never did. Reels are made from news stories, which carry no score of
 * their own, so the strip is found the same way the match-day ranking finds a fixture (matchDay.ts): the story's
 * title must name BOTH sides of a match from our match rows that is live or finished within the last 12 hours.
 *
 * Accuracy first: the score is read from the same match row the scores pages use, never from the story text, and it is
 * left off whenever it could be the wrong game. Two games between the same sides in the window (a T20 series on
 * consecutive days) is ambiguous, so no strip.
 */
import type { ScoreMatch } from "../scores/scoreboardModel";
import { expandAbbreviations, mentions } from "./matchDay";
import { significantWords } from "../titleSimilarity";
import { formFor, FORM_LOOKBACK_DAYS } from "./reelForm";

export interface ReelScore {
  home: string;
  away: string;
  homeScore: string;
  awayScore: string;
  // "FINAL", or the live clock / "LIVE".
  label: string;
  league: string;
  // Each side's last results before this match, newest first ("W", "D", "L"; "G", "E", "P" in Spanish). Both or
  // neither: left off when either side has fewer than 3 known results or an unclear one (reelForm.ts).
  homeForm?: string[];
  awayForm?: string[];
}

export const REEL_SCORE_WINDOW_MS = 12 * 3_600_000;

// The one match the title names both sides of, or null (none, or two in the window: ambiguous). Pure.
export function findScoreMatch(title: string, matches: ScoreMatch[], now: Date): ScoreMatch | null {
  const words = significantWords(expandAbbreviations(title));
  const found = matches.filter((m) => {
    if (m.state !== "live" && m.state !== "paused" && m.state !== "final") return false;
    if (m.home.score == null || m.away.score == null || !m.kickoffAt) return false;
    const dt = now.getTime() - new Date(m.kickoffAt).getTime();
    if (dt < -3_600_000 || dt > REEL_SCORE_WINDOW_MS) return false;
    return mentions(words, m.home.name) && mentions(words, m.away.name);
  });
  return found.length === 1 ? found[0] : null;
}

function stripFor(m: ScoreMatch, language: "en" | "es"): ReelScore {
  const live = language === "es" ? "EN VIVO" : "LIVE";
  return {
    home: m.home.name,
    away: m.away.name,
    homeScore: m.home.score!,
    awayScore: m.away.score!,
    label: m.state === "final" ? "FINAL" : m.clock ?? live,
    league: m.leagueLabel,
  };
}

// Pure, unit-tested.
export function scoreStripFor(title: string, matches: ScoreMatch[], now: Date, language: "en" | "es" = "en"): ReelScore | null {
  const m = findScoreMatch(title, matches, now);
  return m ? stripFor(m, language) : null;
}

// The strip for a story, or null (no match, ambiguous, or the scoreboard is unavailable: the reel is made without it).
// Each side's recent form is added when both can be found; otherwise the strip still shows the score alone.
export async function loadScoreStrip(title: string, language: "en" | "es" = "en", now = new Date()): Promise<ReelScore | null> {
  try {
    const { fetchScoreboard, fetchTeamMatches } = await import("../scores/scoreboard");
    const m = findScoreMatch(title, await fetchScoreboard({ windowMs: REEL_SCORE_WINDOW_MS }), now);
    if (!m) return null;
    const strip = stripFor(m, language);
    try {
      const [home, away] = await Promise.all([m.home.name, m.away.name].map((t) => fetchTeamMatches([t], FORM_LOOKBACK_DAYS, 40)));
      const homeForm = formFor(m.home.name, home, m, language);
      const awayForm = formFor(m.away.name, away, m, language);
      if (homeForm && awayForm) return { ...strip, homeForm, awayForm };
    } catch (err) {
      console.error("[reel] form unavailable:", err);
    }
    return strip;
  } catch (err) {
    console.error("[reel] score strip unavailable:", err);
    return null;
  }
}
