/**
 * Curated cricket-playing nations recognized for real national-flag images
 * on genuinely international match articles (Test/ODI/T20I). Deliberately
 * NOT exhaustive and NOT derived from arbitrary string matching against team
 * names — every entry here is hand-checked to be an actual national side,
 * which is what keeps this safe from the two failure modes that matter:
 *  - A domestic franchise/county team name coincidentally containing or
 *    resembling a place name (e.g. "Barbados Tridents" is a Caribbean
 *    Premier League club, not the Barbados national team) never matches,
 *    since matching requires an exact name after stripping known
 *    qualifiers — see matchCountry() in cricketData.ts.
 *  - West Indies is deliberately excluded: it's a multi-nation confederation
 *    with no single national flag, and its actual team emblem is a
 *    trademarked Cricket West Indies logo, not a freely-licensed image —
 *    showing nothing (falling back to generic stock) is more honest than
 *    guessing.
 * Afghanistan is also deliberately excluded for now — its flag has been
 * politically contested since 2021, and getting that wrong on a public site
 * is a worse outcome than a generic stock photo.
 *
 * Flag files are hardcoded exact Wikimedia Commons titles rather than
 * derived from the country name — Commons' own naming isn't fully
 * consistent ("Flag of the United States.svg" vs "Flag of India.svg") and a
 * wrong guess should fail closed (fetchCommonsFile returns null, falls back
 * to stock photo) rather than silently link a nonexistent file.
 */
export interface CricketCountry {
  // Team-name variants as they appear in CricketData.org match titles, after
  // stripping a trailing gender/age qualifier (see stripTeamQualifiers).
  names: string[];
  flagFile: string;
}

export const CRICKET_COUNTRIES: CricketCountry[] = [
  { names: ["India"], flagFile: "Flag of India.svg" },
  { names: ["Australia"], flagFile: "Flag of Australia.svg" },
  { names: ["England"], flagFile: "Flag of England.svg" },
  { names: ["Pakistan"], flagFile: "Flag of Pakistan.svg" },
  { names: ["South Africa"], flagFile: "Flag of South Africa.svg" },
  { names: ["New Zealand"], flagFile: "Flag of New Zealand.svg" },
  { names: ["Sri Lanka"], flagFile: "Flag of Sri Lanka.svg" },
  { names: ["Bangladesh"], flagFile: "Flag of Bangladesh.svg" },
  { names: ["Zimbabwe"], flagFile: "Flag of Zimbabwe.svg" },
  { names: ["Ireland"], flagFile: "Flag of Ireland.svg" },
  { names: ["Scotland"], flagFile: "Flag of Scotland.svg" },
  { names: ["Netherlands"], flagFile: "Flag of the Netherlands.svg" },
  { names: ["Nepal"], flagFile: "Flag of Nepal.svg" },
  { names: ["UAE", "United Arab Emirates"], flagFile: "Flag of the United Arab Emirates.svg" },
  { names: ["USA", "United States", "United States of America"], flagFile: "Flag of the United States.svg" },
  { names: ["Papua New Guinea"], flagFile: "Flag of Papua New Guinea.svg" },
  { names: ["Oman"], flagFile: "Flag of Oman.svg" },
  { names: ["Namibia"], flagFile: "Flag of Namibia.svg" },
  { names: ["Uganda"], flagFile: "Flag of Uganda.svg" },
  { names: ["Kenya"], flagFile: "Flag of Kenya.svg" },
  { names: ["Tanzania"], flagFile: "Flag of Tanzania.svg" },
  { names: ["Canada"], flagFile: "Flag of Canada.svg" },
  { names: ["Hong Kong"], flagFile: "Flag of Hong Kong.svg" },
  { names: ["Malaysia"], flagFile: "Flag of Malaysia.svg" },
  { names: ["Singapore"], flagFile: "Flag of Singapore.svg" },
  { names: ["Bermuda"], flagFile: "Flag of Bermuda.svg" },
  { names: ["Jersey"], flagFile: "Flag of Jersey.svg" },
  { names: ["Botswana"], flagFile: "Flag of Botswana.svg" },
  { names: ["Rwanda"], flagFile: "Flag of Rwanda.svg" },
  { names: ["Nigeria"], flagFile: "Flag of Nigeria.svg" },
  { names: ["Vanuatu"], flagFile: "Flag of Vanuatu.svg" },
];

// Match titles use "Tanzania Women", "India Under-19", "Australia A" etc. —
// strip the qualifier so the remaining name can be matched exactly against
// CRICKET_COUNTRIES. Exact match (not substring) is deliberate: it's what
// keeps "Barbados Tridents" from ever resolving to "Barbados".
const QUALIFIER_SUFFIX = /\s+(Women|Men|Under-?19|U-?19|U-?23|A)$/i;

export function stripTeamQualifiers(teamName: string): string {
  return teamName.trim().replace(QUALIFIER_SUFFIX, "").trim();
}

export function matchCountry(teamName: string): CricketCountry | null {
  const stripped = stripTeamQualifiers(teamName).toLowerCase();
  return (
    CRICKET_COUNTRIES.find((c) => c.names.some((n) => n.toLowerCase() === stripped)) ?? null
  );
}

// A standard cricket-terminology signal, not an API-specific guess: "T20I"
// and "ODI" universally denote FULL INTERNATIONALS recognized by the ICC, as
// opposed to domestic T20/List A leagues which are never labeled this way.
// "Test" cricket has no domestic equivalent at all — it's exclusively
// played between national sides.
export function isInternationalFormat(matchTitleOrSeries: string): boolean {
  return /\b(T20I|ODI|Test)\b/i.test(matchTitleOrSeries);
}
