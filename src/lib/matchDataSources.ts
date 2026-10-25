// Sources that produce auto-generated match previews/results ("Team A 1-2
// Team B") rather than editorial reporting. Single source of truth, shared
// between ingestion (runIngest.ts, to skip Gemini spend on content that's
// already a template), the scoreboard (which rows are matches, and what to
// tell readers about where a score comes from), and the admin "highlight"
// action (a routine final score is never an "Editor's pick"). Living
// config — register a new structured-data source here when one's added.
export interface MatchDataSource {
  /** Article.sourceName, exactly as the fetcher stores it. */
  name: string;
  /** Who the data comes from, as shown to readers ("Source: ESPN"). */
  provider: string;
  /** Sources whose matches this one supplies the live score for when it
   *  has the same match (by matchKey) — the row keeps its owner, only the
   *  score comes from here. For a provider that is clearly fresher and more
   *  accurate for the same games. */
  supersedes?: string[];
}

export const MATCH_DATA_SOURCES: MatchDataSource[] = [
  { name: "football-data.org", provider: "football-data.org" },
  { name: "CricketData.org", provider: "CricketData.org" },
  // CricketData's free tier lags ESPN by 10-45 min on county games and
  // credits a follow-on to the wrong team (checked side by side 2026-09-26:
  // Middlesex shown 66/2 while ESPN had them winning by 7 wickets).
  { name: "ESPN Cricket", provider: "ESPN", supersedes: ["CricketData.org"] },
  { name: "ESPN NFL", provider: "ESPN" },
  { name: "MLB Stats API", provider: "MLB" },
  { name: "ESPN NBA", provider: "ESPN" },
  { name: "ESPN Football", provider: "ESPN" },
  { name: "ESPN NHL", provider: "ESPN" },
  { name: "API-Volleyball", provider: "API-Sports" },
  { name: "ESPN Volleyball", provider: "ESPN" },
  { name: "ESPN College Football", provider: "ESPN" },
  { name: "ESPN WNBA", provider: "ESPN" },
];

export const MATCH_DATA_SOURCE_NAMES = MATCH_DATA_SOURCES.map((s) => s.name);

const BY_NAME = new Map(MATCH_DATA_SOURCES.map((s) => [s.name, s]));

export function isMatchDataSource(sourceName: string): boolean {
  return BY_NAME.has(sourceName);
}

// Public provider label for a match row ("ESPN", "MLB"); the raw source
// name when unregistered.
export function matchDataProvider(sourceName: string): string {
  return BY_NAME.get(sourceName)?.provider ?? sourceName;
}

// Whether `source`'s scores replace `other`'s for the same match.
export function supersedes(source: string, other: string): boolean {
  return BY_NAME.get(source)?.supersedes?.includes(other) ?? false;
}

// Every source that supplies scores for `source`'s matches.
export function supersedingSources(source: string): string[] {
  return MATCH_DATA_SOURCES.filter((s) => s.supersedes?.includes(source)).map((s) => s.name);
}

// The sources `source` supplies scores for (its `supersedes` list).
export function supersededBy(source: string): string[] {
  return BY_NAME.get(source)?.supersedes ?? [];
}
