import type { SeriesInfo } from "./cricketSeries";
import { TRACKED_CLUBS } from "../clubs";

/**
 * Groups articles into a shared "series" for a real, dated multi-sport event
 * — unlike cricketSeries.ts's detectSeriesFromTitle (bilateral two-team
 * international series, cricket-only), an event here can span every
 * category (cricket, football, athletics, anything) and isn't shaped like a
 * team pair at all. Reuses the exact same /series/[seriesKey] page
 * infrastructure, which was already generic (just "articles matching this
 * seriesKey", no cricket-specific logic in the page itself) even though it
 * had never been used for anything but cricket series until this.
 *
 * Added 2026-09-20 (explicit request) for the 2026 Asian Games
 * (Aichi-Nagoya, Japan, Sep 19 - Oct 4) — confirmed real and live via
 * WebSearch before adding, not guessed: women's cricket Sep 17-22, men's
 * cricket Sep 24-Oct 3. 20 real articles (cricket + football/teqball)
 * already existed with no seriesKey before this.
 *
 * Detection is a plain title-substring match, same recency-based safety
 * reasoning cricketSeries.ts already relies on: every ingested item is
 * already filtered to the last 3 days (MAX_RSS_ITEM_AGE_MS in runIngest.ts),
 * so a fresh title naming a specific, currently-live event is overwhelmingly
 * about that current edition, not a retrospective piece — no year/date
 * disambiguation needed on top of that.
 *
 * Living config: add a new entry here (name substring, key, label) for the
 * next real multi-sport event — a Commonwealth Games, an Olympics — rather
 * than special-casing detection per event.
 */
// `season` (inclusive ISO dates) is when the event is actually being
// played — it decides whether the event shows in "Happening now"
// (competitions.ts). Story volume can't: an evergreen league like IPL gets
// coaching/auction news all year, so it would always look "live". An event
// without a season (IPL until next season's dates are confirmed) is still
// grouped, searchable and followable — it just never shows as happening.
const EVENTS: { match: RegExp; key: string; label: string; season?: { start: string; end: string } }[] = [
  { match: /\bAsian Games\b/i, key: "asian-games-2026", label: "Asian Games 2026", season: { start: "2026-09-19", end: "2026-10-04" } },
  // Deliberately evergreen (no season year in the key/label), unlike the
  // Asian Games above — IPL isn't a fixed-window event the way a Games
  // ceremony is. Confirmed live 2026-09-20: real IPL coverage (Chennai
  // Super Kings appointing Zaheer Khan head coach) is happening in
  // September, months after the 2026 season (Mar-May) ended, clearly about
  // next season rather than a specific past/future edition. A dated
  // "IPL 2026" label would misleadingly claim every grouped story is about
  // that one season when trade/auction/coaching news genuinely spans the
  // whole year. \bIPL\b (not a bare substring) matters here — confirmed
  // live that a plain substring match would false-positive on "multiple"
  // and "discipline".
  { match: /\bIPL\b/i, key: "ipl", label: "IPL" },
];

// The event's own name ("Asian Games 2026"), or null if not an event key.
export function eventLabel(key: string): string | null {
  return EVENTS.find((e) => e.key === key)?.label ?? null;
}

// null = not an EVENTS key (e.g. a bilateral cricket series from
// cricketSeries.ts); otherwise the event's season, if one is set.
export function eventSeason(key: string): { season?: { start: string; end: string } } | null {
  const event = EVENTS.find((e) => e.key === key);
  return event ? { season: event.season } : null;
}

export function detectEventSeries(title: string): SeriesInfo | null {
  for (const event of EVENTS) {
    if (event.match.test(title)) return { key: event.key, label: event.label };
  }
  return null;
}

// Body-text fallback for when the event is the article's lead fact but
// never made it into the headline's own wording (real example: a
// Harmanpreet Kaur retrospective feature whose body opens with "...secured
// an Asian Games gold medal..." but whose headline talks about her career
// arc instead) — added 2026-09-23. Deliberately NOT "detectEventSeries on a
// sliced prefix": slicing the text first and matching against the slice
// can truncate the very phrase being searched for at the cut boundary (a
// real bug caught live — "Asian Games" cut to "Asian G" at a 100-char
// slice, silently never matching). This instead matches against the FULL
// text and only accepts a match whose START position falls within
// maxIndex, so a phrase straddling the boundary still matches correctly.
export function detectEventSeriesNear(text: string, maxIndex: number): SeriesInfo | null {
  for (const event of EVENTS) {
    const match = event.match.exec(text);
    if (match && match.index < maxIndex) return { key: event.key, label: event.label };
  }
  return null;
}

// Real gap reported live 2026-09-23: 23 real CSK/Zaheer-Khan coaching
// articles (Chennai Super Kings hiring a new head coach) had no seriesKey
// at all, because none of their titles or bodies ever say the literal word
// "IPL" -- IPL team news overwhelmingly refers to the team itself (full
// name or, very commonly in headlines, its official abbreviation: "CSK",
// not "Chennai Super Kings" or "IPL"), not the league name. The plain
// \bIPL\b check above can never catch this class of story at all.
//
// Reuses TRACKED_CLUBS's cricket entries (clubs.ts) for the 10 real IPL
// franchises' full names rather than a second, hand-maintained list --
// already curated, already used for the same 10 teams' /club pages. Their
// official broadcast/scorecard abbreviations (CSK, MI, RCB, KKR, SRH, RR,
// DC, PBKS, GT, LSG -- standard, not guessed) are added here, NOT to
// clubs.ts's own searchTerms: that field is also used site-wide for
// auto-linking article text (entityLinks.tsx) and crest matching, where a
// short 2-4 letter code ("GT", "DC", "MI", "RR") is genuinely ambiguous
// outside cricket context (Washington DC, Miami, other real teams/terms in
// other sports). Gating this whole check to category==="cricket" at the
// call site keeps that ambiguity from ever mattering here -- within a
// cricket article, none of these abbreviations plausibly mean anything
// else.
const IPL_TEAM_ABBREVIATIONS: Record<string, string> = {
  "chennai-super-kings": "CSK",
  "mumbai-indians": "MI",
  "royal-challengers-bengaluru": "RCB",
  "kolkata-knight-riders": "KKR",
  "sunrisers-hyderabad": "SRH",
  "rajasthan-royals": "RR",
  "delhi-capitals": "DC",
  "punjab-kings": "PBKS",
  "gujarat-titans": "GT",
  "lucknow-super-giants": "LSG",
};

const IPL_TEAM_TERMS: [string, RegExp][] = TRACKED_CLUBS.filter((c) => c.sport === "cricket").flatMap((club) => {
  const terms = [...club.searchTerms];
  const abbreviation = IPL_TEAM_ABBREVIATIONS[club.slug];
  if (abbreviation) terms.push(abbreviation);
  return terms.map((term): [string, RegExp] => [term, new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)]);
});

// Cricket-only (see the comment above) — call site must gate on
// category === "cricket" before using this, same as detectSeriesFromTitle's
// own cricket-only bilateral check right below it in runIngest.ts.
export function detectIplTeamMention(text: string): SeriesInfo | null {
  for (const [, pattern] of IPL_TEAM_TERMS) {
    if (pattern.test(text)) return { key: "ipl", label: "IPL" };
  }
  return null;
}
