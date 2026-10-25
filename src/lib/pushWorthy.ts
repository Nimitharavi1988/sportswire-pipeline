import { EVENT_KEYWORDS } from "./eventKeywords";
import { SUPERSTAR_SEARCH_TERMS } from "./players";

/**
 * A much narrower bar than isHighlightWorthy (highlightWorthy.ts), which
 * already populates the homepage's "Transfers & Big News" section
 * regularly and includes routine transfer/signing news by design. Checked
 * against real data before picking this (2026-09-24): trendingScore does
 * NOT cleanly separate genuinely major stories from routine ones -- a real
 * "Miami Dolphins sign defender from Buffalo Bills practice squad" scored
 * 73, right alongside Mark Wood's actual career-ending retirement
 * announcement at 78, because trendingScore is dominated by category
 * volume (NFL structurally scores high from raw article count) rather than
 * how major an event actually is. So this stays categorical, not
 * score-based.
 *
 * An explicit ALLOWLIST of EVENT_KEYWORDS entries, not "all of them except
 * transfers" -- a new keyword added to eventKeywords.ts later should NOT
 * silently become push-worthy without deliberate review; an allowlist
 * fails safe (excluded by default), an exclusion list doesn't. Deliberately
 * excludes the routine "player movement" language (transfer/sign/deal/
 * quits/departure/leave/exit) that fires constantly, and the cricket-
 * series-specific entries (ind vs afg etc.) that aren't about a single
 * major event at all.
 */
const PUSH_WORTHY_EVENT_KEYWORDS = new Set([
  "dies", "dead at", "death of", "passes away", "obituary", "tribute", "tributes",
  "retire", "retirement", "retires",
  "record", "milestone", "historic", "breaks", "first player",
]);

// Real-code cross-check: every entry above must actually exist in
// EVENT_KEYWORDS -- this is a stricter subset of it, not an independent
// list, so a typo here should fail loudly (a test covers this) rather than
// silently never matching.
export const PUSH_WORTHY_EVENT_KEYWORDS_LIST = [...PUSH_WORTHY_EVENT_KEYWORDS];
for (const kw of PUSH_WORTHY_EVENT_KEYWORDS_LIST) {
  if (!EVENT_KEYWORDS.includes(kw)) {
    throw new Error(`pushWorthy.ts: "${kw}" is not in EVENT_KEYWORDS -- fix the allowlist`);
  }
}

// Requires BOTH a genuinely major event type AND a tracked superstar name
// (AND, not isHighlightWorthy's OR) -- "X breaks a record" about an
// obscure player isn't push-worthy, but the same headline about a tracked
// star plausibly is. Deaths/tributes are the one case this is arguably too
// strict for (a genuinely major death of a non-tracked figure could be
// missed), but requiring the superstar match uniformly keeps this simple
// and avoids a second special case; revisit if that gap is ever hit live.
export function isPushWorthy(title: string): boolean {
  const lower = title.toLowerCase();
  const hasMajorEvent = PUSH_WORTHY_EVENT_KEYWORDS_LIST.some((kw) => lower.includes(kw));
  if (!hasMajorEvent) return false;
  return SUPERSTAR_SEARCH_TERMS.some((term) => lower.includes(term.toLowerCase()));
}
