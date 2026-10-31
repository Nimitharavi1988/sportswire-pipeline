// The sport keyword in a reel caption's first sentence (2026-10-31). Platforms read a caption like a search engine, and a caption
// such as "Islam Makhachev has revealed his upcoming bout will be among his final appearances" never says UFC or MMA: the word
// only sat in a hashtag. When the caption has no word for its sport, the sport leads it ("MMA: Islam Makhachev has revealed...").
// Topic Pages only (the main Page's caption text is guarded). English only. Pure, unit-tested.

// category prefix -> [keyword to lead with, words that already count as naming the sport]
const SPORT_WORDS: Record<string, [string, RegExp]> = {
  mma: ["MMA", /\b(mma|ufc|bellator|pfl|octagon|cage)\b/i],
  boxing: ["Boxing", /\b(box(?:ing|er|ers)|heavyweight|title fight|knockout|bout)\b/i],
  cricket: ["Cricket", /\b(cricket|ipl|wpl|t20i?|odi|test|bcci|wickets?|innings|batter|batsman|bowler|bowling|batting|ashes|runs)\b/i],
  football: ["Football", /\b(football|soccer|premier league|la liga|bundesliga|serie a|ligue 1|champions league|europa league|mls|goals?|striker|midfielder)\b/i],
  "american-football": ["NFL", /\b(nfl|quarterback|touchdowns?|super bowl|yards?)\b/i],
  "college-football": ["College football", /\b(college football|ncaa|cfp|heisman|bowl game|touchdowns?)\b/i],
  basketball: ["NBA", /\b(nba|basketball|points|rebounds|assists|playoffs)\b/i],
  wnba: ["WNBA", /\b(wnba|basketball)\b/i],
  baseball: ["MLB", /\b(mlb|baseball|home runs?|pitcher|world series|innings?)\b/i],
  hockey: ["NHL", /\b(nhl|hockey|stanley cup|goalie)\b/i],
};

export function sportKeywordFor(category: string): string | null {
  return SPORT_WORDS[category.split("/")[0]]?.[0] ?? null;
}

// The caption with its sport leading, or unchanged when it already names the sport (or the sport is unknown).
export function withSportKeyword(caption: string, category: string): string {
  const entry = SPORT_WORDS[category.split("/")[0]];
  if (!entry) return caption;
  const text = caption.trim();
  if (!text || entry[1].test(text)) return caption;
  return `${entry[0]}: ${text}`;
}
