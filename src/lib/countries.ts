/**
 * Tracked cricket-playing nations for /country/[slug] pages — same
 * curated-list-plus-substring-searchTerms pattern as clubs.ts/players.ts.
 * Sourced from the same 14-nation list already established in
 * social/facebook.ts's TEAM_TO_CODE (used there for matchup hashtags), kept
 * consistent rather than inventing a second "core cricket nations" list.
 *
 * Cricket-only for now — country pages read as a general "all our coverage
 * of this nation" feed (not sport-scoped, same as club/player pages don't
 * scope either), so a football fan's mention of "England" or "Australia"
 * still gets linked and shown here too; it's just that the country list
 * itself was chosen for cricket relevance. Extend if a real gap turns up
 * for a nation prominent in another sport but missing here.
 */
export interface TrackedCountry {
  slug: string;
  name: string;
  searchTerms: string[];
}

export const TRACKED_COUNTRIES: TrackedCountry[] = [
  { slug: "india", name: "India", searchTerms: ["India"] },
  { slug: "australia", name: "Australia", searchTerms: ["Australia"] },
  { slug: "england", name: "England", searchTerms: ["England"] },
  { slug: "pakistan", name: "Pakistan", searchTerms: ["Pakistan"] },
  { slug: "south-africa", name: "South Africa", searchTerms: ["South Africa"] },
  { slug: "new-zealand", name: "New Zealand", searchTerms: ["New Zealand"] },
  { slug: "sri-lanka", name: "Sri Lanka", searchTerms: ["Sri Lanka"] },
  { slug: "bangladesh", name: "Bangladesh", searchTerms: ["Bangladesh"] },
  { slug: "afghanistan", name: "Afghanistan", searchTerms: ["Afghanistan"] },
  { slug: "zimbabwe", name: "Zimbabwe", searchTerms: ["Zimbabwe"] },
  { slug: "ireland", name: "Ireland", searchTerms: ["Ireland"] },
  { slug: "scotland", name: "Scotland", searchTerms: ["Scotland"] },
  { slug: "netherlands", name: "Netherlands", searchTerms: ["Netherlands"] },
  { slug: "nepal", name: "Nepal", searchTerms: ["Nepal"] },
  // A cricket team of several nations, not one country, but it plays and is
  // reported as one: missing, it couldn't be tagged on India v West Indies
  // stories (2026-09-27).
  { slug: "west-indies", name: "West Indies", searchTerms: ["West Indies", "Windies"] },
];
