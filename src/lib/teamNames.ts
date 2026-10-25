// Match-article summaries reliably follow "{home} played/face {away} in the
// {competition}..." (see footballData.ts) — used here only to produce
// meaningful image alt text for team crests, since team names aren't stored
// as separate fields. Falls back to generic labels if the pattern doesn't
// match rather than guessing wrong.
export function crestAltText(summary: string): { home: string; away: string } {
  const match = summary.match(/^(.+?)\s+(?:played|face)\s+(.+?)\s+in the/);
  if (match) {
    return { home: `${match[1]} crest`, away: `${match[2]} crest` };
  }
  return { home: "Home team crest", away: "Away team crest" };
}

// Same reliable summary shape as above — "...in the {competition}, finishing
// ..." for a finished match, "...in the {competition} on {date}." for a
// preview — used to group match articles by competition (Premier League,
// Champions League, etc.) without a dedicated schema field. Only matches
// football-data.org-sourced summaries (RSS articles use a different, free-
// text summary and correctly return null rather than a wrong guess).
export function competitionFromSummary(summary: string): string | null {
  const match = summary.match(/\bin the (.+?)(?:, finishing|\s+on\s)/);
  return match ? match[1] : null;
}

// Clubs don't have a Wikimedia-style dedicated portrait fetch like players —
// their crest already appears on every match article they're in
// (homeCrestUrl/awayCrestUrl). Picks the club's own crest out of whichever
// side of the most recent matching article it actually was, using the same
// summary-parsing crestAltText already relies on, rather than guessing.
// Shared between the club page itself and its opengraph-image route.
export function findClubCrest(
  club: { searchTerms: string[] },
  articles: { summary: string; homeCrestUrl: string | null; awayCrestUrl: string | null }[]
): string | null {
  for (const article of articles) {
    if (!article.homeCrestUrl || !article.awayCrestUrl) continue;
    const { home, away } = crestAltText(article.summary);
    const isHome = club.searchTerms.some((term) => home.toLowerCase().includes(term.toLowerCase()));
    if (isHome) return article.homeCrestUrl;
    const isAway = club.searchTerms.some((term) => away.toLowerCase().includes(term.toLowerCase()));
    if (isAway) return article.awayCrestUrl;
  }
  return null;
}
