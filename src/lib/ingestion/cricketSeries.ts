/**
 * Groups cricket articles — both structured match-data items (CricketData.org)
 * AND editorial RSS/player-news coverage — into a shared "series" whenever
 * they're about the same bilateral international tour (e.g. "India vs
 * Afghanistan, T20I"), so /series/[seriesKey] can list a tour's news together
 * instead of the site only ever showing one flat chronological feed.
 *
 * Deliberately scoped to bilateral INTERNATIONAL series only (Test/ODI/T20I)
 * for now, not franchise tournaments (IPL etc.) — those group by a single
 * tournament name rather than a team pair, a different shape this doesn't
 * attempt to handle yet.
 *
 * NOT gated on cricketCountries.ts's CRICKET_COUNTRIES list — Afghanistan and
 * West Indies are deliberately excluded there (no freely-licensed flag /
 * no single national flag), but both are entirely real, common international
 * teams that need to group correctly here regardless.
 *
 * Detection is title-only (detectSeriesFromTitle), NOT anchored to
 * CricketData.org match data — an earlier version required a live match from
 * that feed to "seed" a series before any editorial article could be tagged.
 * Confirmed live that this was a real design flaw, not a temporary gap: a
 * genuine, heavily-covered England vs Pakistan Test (day four, BBC/Cricinfo/
 * Guardian all over it) never appeared in CricketData.org's currentMatches at
 * all — that free-tier feed reliably surfaces domestic franchise/county
 * cricket but not every real international. Two recognized team names (see
 * TEAM_NAMES below) plus a format word in the SAME title is a safe signal on
 * its own: country names aren't ambiguous the way player surnames can be, and
 * every ingested item is already recency-filtered (MAX_RSS_ITEM_AGE_MS, 3
 * days), so a title-only match is overwhelmingly about a current series, not
 * an old one being retrospectively discussed.
 */

// Reuses cricketCountries.ts's names as the base list (still the curated,
// hand-checked set — this only adds the two teams excluded there for
// flag-specific reasons, which don't apply to series grouping).
import { CRICKET_COUNTRIES } from "./cricketCountries";

const TEAM_NAMES: string[] = [
  ...CRICKET_COUNTRIES.flatMap((c) => c.names),
  "Afghanistan",
  "West Indies",
];

// Abbreviated codes ("IND vs AFG") are extremely common in real cricket
// headlines — confirmed live: several of a live series' own "LIVE Score"
// update articles used ONLY the codes, never spelling out both full names
// anywhere in the title, so findTeamPair (full-name-only) found at most one
// recognized team and never tagged them into the series at all. Resolved to
// the matching full name below so the key/label output is unchanged either
// way a headline happens to phrase it.
const CODE_TO_NAME: Record<string, string> = {
  IND: "India", AUS: "Australia", ENG: "England", PAK: "Pakistan", SA: "South Africa",
  NZ: "New Zealand", SL: "Sri Lanka", BAN: "Bangladesh", AFG: "Afghanistan", ZIM: "Zimbabwe",
  IRE: "Ireland", SCO: "Scotland", NED: "Netherlands", NEP: "Nepal", WI: "West Indies",
};

export interface SeriesInfo {
  key: string;
  label: string;
}

// Matches both singular ("T20I") and plural ("T20Is") — real editorial
// headlines overwhelmingly use the plural ("Afghanistan T20Is"), which a
// bare \bT20I\b word-boundary check misses entirely (no boundary between
// "I" and a following "s", both word characters). Bare "T20" (no trailing
// "I") is also common in real headlines for an international match
// ("India thrash Afghanistan... in first T20", "India-Afghanistan T20
// tie") — confirmed live: this alone silently excluded several genuine
// match-day articles from a series already confirmed live elsewhere on the
// site. Checked after the stricter T20I pattern so "T20I" itself still
// resolves precisely; both map to the same "T20I" label since this
// function already requires two recognized COUNTRY names in the same
// title, which rules out a bare domestic "T20" (club names, not countries).
const FORMAT_LABELS: [RegExp, string][] = [
  [/\bT20Is?\b/i, "T20I"],
  [/\bT20\b/i, "T20I"],
  [/\bODIs?\b/i, "ODI"],
  [/\bTests?\b/i, "Test"],
];

export function detectSeriesFormat(text: string): string | null {
  for (const [pattern, label] of FORMAT_LABELS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function normalizeTeamName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Alphabetical team ordering keeps the key/label stable regardless of which
// team a given source lists as "home" — CricketData.org's match.name order
// isn't guaranteed consistent run to run.
export function deriveSeriesKey(homeTeam: string, awayTeam: string, formatSourceText: string): SeriesInfo | null {
  const format = detectSeriesFormat(formatSourceText);
  if (!format) return null;

  const homeNorm = normalizeTeamName(homeTeam);
  const awayNorm = normalizeTeamName(awayTeam);
  if (!homeNorm || !awayNorm || homeNorm === awayNorm) return null;

  const [firstNorm, firstLabel, secondLabel] =
    homeNorm < awayNorm ? [homeNorm, homeTeam.trim(), awayTeam.trim()] : [awayNorm, awayTeam.trim(), homeTeam.trim()];
  const secondNorm = firstNorm === homeNorm ? awayNorm : homeNorm;

  return {
    key: `${firstNorm}-vs-${secondNorm}-${format.toLowerCase()}`,
    label: `${firstLabel} vs ${secondLabel} • ${format}`,
  };
}

// Longest tokens first — "South Africa" must win over a hypothetical shorter
// substring match before "Africa" alone (not in the list, but the same
// discipline as cricketSeries's other regexes), and prevents "New Zealand"
// from matching only part of itself against another multi-word name.
const TEAM_TOKENS = [...TEAM_NAMES, ...Object.keys(CODE_TO_NAME)];
const TEAM_NAME_PATTERN = new RegExp(
  `\\b(${[...TEAM_TOKENS].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

function resolveMatchedToken(raw: string): string {
  const code = CODE_TO_NAME[raw.toUpperCase()];
  if (code) return code;
  return TEAM_NAMES.find((n) => n.toLowerCase() === raw.toLowerCase()) ?? raw;
}

// Finds the first two DISTINCT recognized international teams in a title
// (full name or abbreviation, resolved to a canonical full name either
// way), in the order they appear — good enough for the overwhelming
// majority of real headlines, which are about exactly two teams when they
// mention a series at all. A roundup mentioning three teams just gets
// grouped by whichever two are named first, which is an acceptable
// approximation rather than a case worth extra complexity for.
function findTeamPair(title: string): [string, string] | null {
  TEAM_NAME_PATTERN.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEAM_NAME_PATTERN.exec(title))) {
    const name = resolveMatchedToken(match[0]);
    if (!found.some((f) => f.toLowerCase() === name.toLowerCase())) found.push(name);
    if (found.length === 2) return [found[0], found[1]];
  }
  return null;
}

// The main entry point: derives a series directly from an article's title
// alone — no CricketData.org match-data confirmation required (see the
// module comment for why that anchor turned out to be unreliable). Used for
// every cricket-category item, match-data and editorial alike.
//
// Rankings headlines name two teams and a format without being about a
// series between them ("India displace England to reclaim No.1 T20I
// spot") — confirmed live 2026-09-25: four such stories had created a
// phantom "England vs India • T20I" series that surfaced on the homepage.
const RANKINGS_PATTERN = /\brankings?\b|\bno\.?\s?1\b|\bnumber one\b|\btop spot\b/i;

export function detectSeriesFromTitle(title: string): SeriesInfo | null {
  if (RANKINGS_PATTERN.test(title)) return null;
  const teams = findTeamPair(title);
  if (!teams) return null;
  return deriveSeriesKey(teams[0], teams[1], title);
}
