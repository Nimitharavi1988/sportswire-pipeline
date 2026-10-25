// @ts-expect-error - text-readability has no bundled types
import rs from "text-readability";

import { containsProfanity } from "../profanity";

// General-purpose RSS feeds (BBC Sport, etc.) mix in self-promotional filler
// alongside real reporting — quizzes, polls, "sign up" prompts — that isn't
// news at all. A general sports/news reader shouldn't have to see "Flex your
// football brain with our daily quizzes" presented as if it were a match
// report. Title-pattern based since these items are structurally different
// from news headlines (an interactive feature, not an event that happened),
// not a topic filter — living config, extend as new filler shapes turn up
// in the review queue.
const NON_NEWS_PATTERNS = [
  /\bquiz(zes)?\b/i,
  /\bcrossword\b/i,
  // Deliberately NOT a standalone /\bpuzzle\b/ — real tactical-analysis
  // headlines use "puzzle" metaphorically ("Guardiola solves the puzzle of
  // his front three"), the same class of false-positive trap as the
  // profanity list's "Scunthorpe problem" above. No real filler example has
  // used "puzzle" alone so far — leaving it out rather than guessing at a
  // narrower phrasing with no observed case to justify it.
  /how (well|much) do you know/i,
  /test your (football|cricket|sports)? ?knowledge/i,
  /guess the (player|score|team)/i,
  /^vote:/i,
  /^poll:/i,
  /sign up (for|to) our newsletter/i,
];

function isNonNewsFiller(title: string): boolean {
  return NON_NEWS_PATTERNS.some((pattern) => pattern.test(title));
}

// Low-quality content-farm sites append a random bot/video-ID string in
// parentheses to game search rankings — real example caught live: "Pakistan
// Vs Australia 2nd T20 Live Match Today | PAK Vs AUS 2nd T20 Live Scores &
// Commentary Lewandowski (PdBBl3l0s4)". Deliberately narrow and keyed to
// that exact shape (trailing parenthetical, 6+ chars, mixes uppercase,
// lowercase AND a digit, no spaces inside) rather than a broad "any
// parenthetical" rule — same false-positive-avoidance reasoning as the
// profanity list's "Scunthorpe problem": a real headline's parenthetical is
// almost always a readable word/abbreviation ("(video)", "(2026)", "(AUS)"),
// never a random string mixing all three character classes with no spaces.
function looksLikeSpamId(title: string): boolean {
  const match = title.match(/\(([A-Za-z0-9]{6,})\)\s*$/);
  if (!match) return false;
  const id = match[1];
  return /[a-z]/.test(id) && /[A-Z]/.test(id) && /[0-9]/.test(id);
}

export interface QualityCheckResult {
  passed: boolean;
  profanityFlag: boolean;
  profanityDetail: string | null;
  readabilityScore: number;
}

export function runQualityChecks(title: string, summary: string): QualityCheckResult {
  const combinedText = `${title} ${summary}`;

  const { flagged: profanityFlag, matched } = containsProfanity(combinedText);
  const nonNewsFlag = isNonNewsFiller(title);
  const spamIdFlag = looksLikeSpamId(title);
  const profanityDetail = profanityFlag
    ? `Profanity detected: ${matched.join(", ")}`
    : nonNewsFlag
      ? "Not a news article (quiz/poll/filler content)"
      : spamIdFlag
        ? "Looks like content-farm spam (bot-generated ID in title)"
        : null;

  // Stored for visibility in the admin queue, but NOT used as a pass/fail gate:
  // Flesch Reading Ease penalizes long/foreign proper nouns (team names like
  // "Internazionale") the same way it penalizes genuinely garbled text, which
  // made short, perfectly valid match-result sentences fail this check. The
  // `looksBroken` check below is the actual detector for garbled/broken scrapes.
  const readabilityScore = rs.fleschReadingEase(summary);

  // Catch obviously broken scrapes: leftover HTML tags, or a summary that's
  // suspiciously short (likely a truncated/garbled pull from source).
  const looksBroken = /<[^>]+>/.test(summary) || summary.trim().length < 20;

  const passed = !profanityFlag && !looksBroken && !nonNewsFlag && !spamIdFlag;

  return { passed, profanityFlag: profanityFlag || nonNewsFlag || spamIdFlag, profanityDetail, readabilityScore };
}
