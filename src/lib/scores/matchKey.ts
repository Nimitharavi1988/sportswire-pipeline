/**
 * Provider-independent match identity (Article.matchKey):
 *   `${category}:${yyyy-mm-dd}:${home}-v-${away}`
 * e.g. "american-football:2026-09-27:buffalo-bills-v-los-angeles-chargers".
 *
 * dedupeHash stays provider-specific (built from e.g. "espn-nfl-<id>"), which
 * is right for "have I seen this exact provider record", but means a second
 * provider for the same game would look like a brand-new match. matchKey is
 * what two providers agree on, so one can be compared against or swapped in
 * for the other without duplicating the match.
 *
 * Date is the kickoff's UTC calendar day. Team names are slugified here, not
 * resolved to canonical names — providers that spell a team differently
 * ("LA Chargers" vs "Los Angeles Chargers") need an alias pass before
 * comparing; that belongs with the provider adapter that introduces it.
 */
export function slugifyTeam(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildMatchKey(
  category: string,
  kickoffAt: Date | undefined | null,
  homeTeam: string | undefined | null,
  awayTeam: string | undefined | null
): string | undefined {
  if (!kickoffAt || Number.isNaN(kickoffAt.getTime()) || !homeTeam || !awayTeam) return undefined;
  const home = slugifyTeam(homeTeam);
  const away = slugifyTeam(awayTeam);
  if (!home || !away) return undefined;
  return `${category.split("/")[0]}:${kickoffAt.toISOString().slice(0, 10)}:${home}-v-${away}`;
}

// Both orderings of a match's key. Providers can disagree on which team is
// "home" (cricket especially), so cross-provider comparison checks both.
export function matchKeyVariants(
  category: string,
  kickoffAt: Date | undefined | null,
  homeTeam: string | undefined | null,
  awayTeam: string | undefined | null
): string[] {
  const keys = [buildMatchKey(category, kickoffAt, homeTeam, awayTeam), buildMatchKey(category, kickoffAt, awayTeam, homeTeam)];
  return [...new Set(keys.filter((k): k is string => Boolean(k)))];
}
