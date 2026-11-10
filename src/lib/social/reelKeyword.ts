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

// The Spanish Page's version (2026-11-10: only 18% of its Instagram and 28% of its Facebook reel captions named the sport in the
// visible first line). Same shape: [keyword to lead with, words that already count as naming the sport].
const SPORT_WORDS_ES: Record<string, [string, RegExp]> = {
  mma: ["MMA", /\b(mma|ufc|bellator|pfl|octágono|octagono|jaula)\b/i],
  boxing: ["Boxeo", /\b(box(?:eo|eador|eadores)|peso pesado|combate|nocaut|knockout)\b/i],
  cricket: ["Críquet", /\b(cr[ií]quet|ipl|wpl|t20i?|odi|bcci|wickets?|entradas|bateador|lanzador)\b/i],
  football: ["Fútbol", /\b(f[uú]tbol|soccer|premier league|la liga|liga mx|bundesliga|serie a|ligue 1|champions|europa league|mls|goles?|gol|delantero|mediocampista|portero|clásico|clasico)\b/i],
  "american-football": ["NFL", /\b(nfl|mariscal|quarterback|touchdowns?|s[uú]per bowl|yardas?)\b/i],
  "college-football": ["Fútbol americano universitario", /\b(f[uú]tbol americano|ncaa|cfp|heisman|touchdowns?)\b/i],
  basketball: ["NBA", /\b(nba|baloncesto|b[aá]squetbol|puntos|rebotes|asistencias|playoffs)\b/i],
  wnba: ["WNBA", /\b(wnba|baloncesto|b[aá]squetbol)\b/i],
  baseball: ["Béisbol", /\b(mlb|b[eé]isbol|jonrones?|lanzador|serie mundial)\b/i],
  hockey: ["NHL", /\b(nhl|hockey|copa stanley|portero)\b/i],
  tennis: ["Tenis", /\b(tenis|atp|wta|grand slam|roland garros|wimbledon)\b/i],
  "formula-1": ["Fórmula 1", /\b(f[oó]rmula 1|f1|gran premio|pole)\b/i],
};

export function sportKeywordForLanguage(category: string, language: "en" | "es" = "en"): string | null {
  return (language === "es" ? SPORT_WORDS_ES : SPORT_WORDS)[category.split("/")[0]]?.[0] ?? null;
}

// The caption with its sport leading, or unchanged when it already names the sport (or the sport is unknown).
export function withSportKeyword(caption: string, category: string, language: "en" | "es" = "en"): string {
  const entry = (language === "es" ? SPORT_WORDS_ES : SPORT_WORDS)[category.split("/")[0]];
  if (!entry) return caption;
  const text = caption.trim();
  if (!text || entry[1].test(text)) return caption;
  return `${entry[0]}: ${text}`;
}
