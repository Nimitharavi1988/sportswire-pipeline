/**
 * Tracked clubs/teams for /club/[slug] pages — same pattern as players.ts (a
 * curated list + substring search terms matched against article titles),
 * not a new mechanism. Search terms are the club's core distinctive name
 * without a league-specific suffix (e.g. "Manchester City" not "Manchester
 * City FC") since these match as substrings — safer than needing to know
 * every league's exact naming convention (FC/CF/AFC prefixes vary).
 *
 * The original ~22 soccer entries below are deliberately not exhaustive
 * (3-5 best-known clubs per league) and have no `sport` field (implicitly
 * football — see the `?? "football"` fallback wherever this is consumed,
 * e.g. club/[slug]/page.tsx's standings-widget selection). Everything below
 * the "Generated via scripts/generateTeamEntities.ts" marker is real,
 * comprehensive, API-sourced team data (full league rosters, not a curated
 * shortlist) with an explicit `sport` tag — re-run that script later to
 * pick up renamed/relocated/expansion teams, same "living config" spirit.
 */
export type ClubSport = "football" | "american-football" | "basketball" | "baseball" | "hockey" | "cricket" | "college-football";

export interface TrackedClub {
  slug: string;
  name: string;
  searchTerms: string[];
  sport?: ClubSport;
}

export const TRACKED_CLUBS: TrackedClub[] = [
  // Premier League
  { slug: "manchester-city", name: "Manchester City", searchTerms: ["Manchester City", "Man City"] },
  { slug: "arsenal", name: "Arsenal", searchTerms: ["Arsenal"] },
  { slug: "liverpool", name: "Liverpool", searchTerms: ["Liverpool"] },
  { slug: "manchester-united", name: "Manchester United", searchTerms: ["Manchester United", "Man Utd", "Man United"] },
  { slug: "chelsea", name: "Chelsea", searchTerms: ["Chelsea"] },
  // La Liga
  { slug: "real-madrid", name: "Real Madrid", searchTerms: ["Real Madrid"] },
  { slug: "barcelona", name: "Barcelona", searchTerms: ["Barcelona", "Barça", "Barca"] },
  { slug: "atletico-madrid", name: "Atlético Madrid", searchTerms: ["Atlético Madrid", "Atletico Madrid"] },
  // Serie A
  { slug: "inter-milan", name: "Inter Milan", searchTerms: ["Internazionale", "Inter Milan"] },
  { slug: "ac-milan", name: "AC Milan", searchTerms: ["AC Milan"] },
  { slug: "juventus", name: "Juventus", searchTerms: ["Juventus", "Juve"] },
  // Bundesliga
  { slug: "bayern-munich", name: "Bayern Munich", searchTerms: ["Bayern Munich", "Bayern München", "Bayern"] },
  { slug: "borussia-dortmund", name: "Borussia Dortmund", searchTerms: ["Borussia Dortmund", "Dortmund"] },
  // Ligue 1
  { slug: "psg", name: "Paris Saint-Germain", searchTerms: ["Paris Saint-Germain", "PSG"] },
  { slug: "marseille", name: "Marseille", searchTerms: ["Marseille"] },
  // Primeira Liga
  { slug: "benfica", name: "Benfica", searchTerms: ["Benfica"] },
  { slug: "porto", name: "FC Porto", searchTerms: ["FC Porto", "Porto"] },
  { slug: "sporting-cp", name: "Sporting CP", searchTerms: ["Sporting Clube de Portugal", "Sporting CP"] },
  // Eredivisie
  { slug: "ajax", name: "Ajax", searchTerms: ["Ajax"] },
  { slug: "psv", name: "PSV Eindhoven", searchTerms: ["PSV"] },
  // Brasileirão
  { slug: "flamengo", name: "Flamengo", searchTerms: ["Flamengo"] },
  { slug: "palmeiras", name: "Palmeiras", searchTerms: ["Palmeiras"] },

  // Generated via scripts/generateTeamEntities.ts (2026-09-20) — real, full
  // league rosters from ESPN's public teams endpoint, not hand-picked.
  // Four real teams deliberately excluded from this batch: MLB's
  // "Athletics" (collides with this site's own "athletics" category —
  // every track & field mention would false-link to a baseball club), and
  // Ligue 1's "Nice"/"Angers" (both common English words — "nice
  // performance", "this angers fans") and "Monza" (collides with the F1
  // circuit this site also covers, via Autosport's feed). Re-run the
  // script to refresh for renamed/relocated/expansion teams.

  // NFL
  { slug: "arizona-cardinals", name: "Arizona Cardinals", searchTerms: ["Arizona Cardinals"], sport: "american-football" },
  { slug: "atlanta-falcons", name: "Atlanta Falcons", searchTerms: ["Atlanta Falcons"], sport: "american-football" },
  { slug: "baltimore-ravens", name: "Baltimore Ravens", searchTerms: ["Baltimore Ravens"], sport: "american-football" },
  { slug: "buffalo-bills", name: "Buffalo Bills", searchTerms: ["Buffalo Bills"], sport: "american-football" },
  { slug: "carolina-panthers", name: "Carolina Panthers", searchTerms: ["Carolina Panthers"], sport: "american-football" },
  { slug: "chicago-bears", name: "Chicago Bears", searchTerms: ["Chicago Bears"], sport: "american-football" },
  { slug: "cincinnati-bengals", name: "Cincinnati Bengals", searchTerms: ["Cincinnati Bengals"], sport: "american-football" },
  { slug: "cleveland-browns", name: "Cleveland Browns", searchTerms: ["Cleveland Browns"], sport: "american-football" },
  { slug: "dallas-cowboys", name: "Dallas Cowboys", searchTerms: ["Dallas Cowboys"], sport: "american-football" },
  { slug: "denver-broncos", name: "Denver Broncos", searchTerms: ["Denver Broncos"], sport: "american-football" },
  { slug: "detroit-lions", name: "Detroit Lions", searchTerms: ["Detroit Lions"], sport: "american-football" },
  { slug: "green-bay-packers", name: "Green Bay Packers", searchTerms: ["Green Bay Packers"], sport: "american-football" },
  { slug: "houston-texans", name: "Houston Texans", searchTerms: ["Houston Texans"], sport: "american-football" },
  { slug: "indianapolis-colts", name: "Indianapolis Colts", searchTerms: ["Indianapolis Colts"], sport: "american-football" },
  { slug: "jacksonville-jaguars", name: "Jacksonville Jaguars", searchTerms: ["Jacksonville Jaguars"], sport: "american-football" },
  { slug: "kansas-city-chiefs", name: "Kansas City Chiefs", searchTerms: ["Kansas City Chiefs"], sport: "american-football" },
  { slug: "las-vegas-raiders", name: "Las Vegas Raiders", searchTerms: ["Las Vegas Raiders"], sport: "american-football" },
  { slug: "los-angeles-chargers", name: "Los Angeles Chargers", searchTerms: ["Los Angeles Chargers"], sport: "american-football" },
  { slug: "los-angeles-rams", name: "Los Angeles Rams", searchTerms: ["Los Angeles Rams"], sport: "american-football" },
  { slug: "miami-dolphins", name: "Miami Dolphins", searchTerms: ["Miami Dolphins"], sport: "american-football" },
  { slug: "minnesota-vikings", name: "Minnesota Vikings", searchTerms: ["Minnesota Vikings"], sport: "american-football" },
  { slug: "new-england-patriots", name: "New England Patriots", searchTerms: ["New England Patriots"], sport: "american-football" },
  { slug: "new-orleans-saints", name: "New Orleans Saints", searchTerms: ["New Orleans Saints"], sport: "american-football" },
  { slug: "new-york-giants", name: "New York Giants", searchTerms: ["New York Giants"], sport: "american-football" },
  { slug: "new-york-jets", name: "New York Jets", searchTerms: ["New York Jets"], sport: "american-football" },
  { slug: "philadelphia-eagles", name: "Philadelphia Eagles", searchTerms: ["Philadelphia Eagles"], sport: "american-football" },
  { slug: "pittsburgh-steelers", name: "Pittsburgh Steelers", searchTerms: ["Pittsburgh Steelers"], sport: "american-football" },
  { slug: "san-francisco-49ers", name: "San Francisco 49ers", searchTerms: ["San Francisco 49ers"], sport: "american-football" },
  { slug: "seattle-seahawks", name: "Seattle Seahawks", searchTerms: ["Seattle Seahawks"], sport: "american-football" },
  { slug: "tampa-bay-buccaneers", name: "Tampa Bay Buccaneers", searchTerms: ["Tampa Bay Buccaneers"], sport: "american-football" },
  { slug: "tennessee-titans", name: "Tennessee Titans", searchTerms: ["Tennessee Titans"], sport: "american-football" },
  { slug: "washington-commanders", name: "Washington Commanders", searchTerms: ["Washington Commanders"], sport: "american-football" },

  // NBA
  { slug: "atlanta-hawks", name: "Atlanta Hawks", searchTerms: ["Atlanta Hawks"], sport: "basketball" },
  { slug: "boston-celtics", name: "Boston Celtics", searchTerms: ["Boston Celtics"], sport: "basketball" },
  { slug: "brooklyn-nets", name: "Brooklyn Nets", searchTerms: ["Brooklyn Nets"], sport: "basketball" },
  { slug: "charlotte-hornets", name: "Charlotte Hornets", searchTerms: ["Charlotte Hornets"], sport: "basketball" },
  { slug: "chicago-bulls", name: "Chicago Bulls", searchTerms: ["Chicago Bulls"], sport: "basketball" },
  { slug: "cleveland-cavaliers", name: "Cleveland Cavaliers", searchTerms: ["Cleveland Cavaliers"], sport: "basketball" },
  { slug: "dallas-mavericks", name: "Dallas Mavericks", searchTerms: ["Dallas Mavericks"], sport: "basketball" },
  { slug: "denver-nuggets", name: "Denver Nuggets", searchTerms: ["Denver Nuggets"], sport: "basketball" },
  { slug: "detroit-pistons", name: "Detroit Pistons", searchTerms: ["Detroit Pistons"], sport: "basketball" },
  { slug: "golden-state-warriors", name: "Golden State Warriors", searchTerms: ["Golden State Warriors"], sport: "basketball" },
  { slug: "houston-rockets", name: "Houston Rockets", searchTerms: ["Houston Rockets"], sport: "basketball" },
  { slug: "indiana-pacers", name: "Indiana Pacers", searchTerms: ["Indiana Pacers"], sport: "basketball" },
  { slug: "la-clippers", name: "LA Clippers", searchTerms: ["LA Clippers"], sport: "basketball" },
  { slug: "los-angeles-lakers", name: "Los Angeles Lakers", searchTerms: ["Los Angeles Lakers"], sport: "basketball" },
  { slug: "memphis-grizzlies", name: "Memphis Grizzlies", searchTerms: ["Memphis Grizzlies"], sport: "basketball" },
  { slug: "miami-heat", name: "Miami Heat", searchTerms: ["Miami Heat"], sport: "basketball" },
  { slug: "milwaukee-bucks", name: "Milwaukee Bucks", searchTerms: ["Milwaukee Bucks"], sport: "basketball" },
  { slug: "minnesota-timberwolves", name: "Minnesota Timberwolves", searchTerms: ["Minnesota Timberwolves"], sport: "basketball" },
  { slug: "new-orleans-pelicans", name: "New Orleans Pelicans", searchTerms: ["New Orleans Pelicans"], sport: "basketball" },
  { slug: "new-york-knicks", name: "New York Knicks", searchTerms: ["New York Knicks"], sport: "basketball" },
  { slug: "oklahoma-city-thunder", name: "Oklahoma City Thunder", searchTerms: ["Oklahoma City Thunder"], sport: "basketball" },
  { slug: "orlando-magic", name: "Orlando Magic", searchTerms: ["Orlando Magic"], sport: "basketball" },
  { slug: "philadelphia-76ers", name: "Philadelphia 76ers", searchTerms: ["Philadelphia 76ers"], sport: "basketball" },
  { slug: "phoenix-suns", name: "Phoenix Suns", searchTerms: ["Phoenix Suns"], sport: "basketball" },
  { slug: "portland-trail-blazers", name: "Portland Trail Blazers", searchTerms: ["Portland Trail Blazers"], sport: "basketball" },
  { slug: "sacramento-kings", name: "Sacramento Kings", searchTerms: ["Sacramento Kings"], sport: "basketball" },
  { slug: "san-antonio-spurs", name: "San Antonio Spurs", searchTerms: ["San Antonio Spurs"], sport: "basketball" },
  { slug: "toronto-raptors", name: "Toronto Raptors", searchTerms: ["Toronto Raptors"], sport: "basketball" },
  { slug: "utah-jazz", name: "Utah Jazz", searchTerms: ["Utah Jazz"], sport: "basketball" },
  { slug: "washington-wizards", name: "Washington Wizards", searchTerms: ["Washington Wizards"], sport: "basketball" },

  // MLB ("Athletics" excluded -- see note above)
  { slug: "arizona-diamondbacks", name: "Arizona Diamondbacks", searchTerms: ["Arizona Diamondbacks"], sport: "baseball" },
  { slug: "atlanta-braves", name: "Atlanta Braves", searchTerms: ["Atlanta Braves"], sport: "baseball" },
  { slug: "baltimore-orioles", name: "Baltimore Orioles", searchTerms: ["Baltimore Orioles"], sport: "baseball" },
  { slug: "boston-red-sox", name: "Boston Red Sox", searchTerms: ["Boston Red Sox"], sport: "baseball" },
  { slug: "chicago-cubs", name: "Chicago Cubs", searchTerms: ["Chicago Cubs"], sport: "baseball" },
  { slug: "chicago-white-sox", name: "Chicago White Sox", searchTerms: ["Chicago White Sox"], sport: "baseball" },
  { slug: "cincinnati-reds", name: "Cincinnati Reds", searchTerms: ["Cincinnati Reds"], sport: "baseball" },
  { slug: "cleveland-guardians", name: "Cleveland Guardians", searchTerms: ["Cleveland Guardians"], sport: "baseball" },
  { slug: "colorado-rockies", name: "Colorado Rockies", searchTerms: ["Colorado Rockies"], sport: "baseball" },
  { slug: "detroit-tigers", name: "Detroit Tigers", searchTerms: ["Detroit Tigers"], sport: "baseball" },
  { slug: "houston-astros", name: "Houston Astros", searchTerms: ["Houston Astros"], sport: "baseball" },
  { slug: "kansas-city-royals", name: "Kansas City Royals", searchTerms: ["Kansas City Royals"], sport: "baseball" },
  { slug: "los-angeles-angels", name: "Los Angeles Angels", searchTerms: ["Los Angeles Angels"], sport: "baseball" },
  { slug: "los-angeles-dodgers", name: "Los Angeles Dodgers", searchTerms: ["Los Angeles Dodgers"], sport: "baseball" },
  { slug: "miami-marlins", name: "Miami Marlins", searchTerms: ["Miami Marlins"], sport: "baseball" },
  { slug: "milwaukee-brewers", name: "Milwaukee Brewers", searchTerms: ["Milwaukee Brewers"], sport: "baseball" },
  { slug: "minnesota-twins", name: "Minnesota Twins", searchTerms: ["Minnesota Twins"], sport: "baseball" },
  { slug: "new-york-mets", name: "New York Mets", searchTerms: ["New York Mets"], sport: "baseball" },
  { slug: "new-york-yankees", name: "New York Yankees", searchTerms: ["New York Yankees"], sport: "baseball" },
  { slug: "philadelphia-phillies", name: "Philadelphia Phillies", searchTerms: ["Philadelphia Phillies"], sport: "baseball" },
  { slug: "pittsburgh-pirates", name: "Pittsburgh Pirates", searchTerms: ["Pittsburgh Pirates"], sport: "baseball" },
  { slug: "san-diego-padres", name: "San Diego Padres", searchTerms: ["San Diego Padres"], sport: "baseball" },
  { slug: "san-francisco-giants", name: "San Francisco Giants", searchTerms: ["San Francisco Giants"], sport: "baseball" },
  { slug: "seattle-mariners", name: "Seattle Mariners", searchTerms: ["Seattle Mariners"], sport: "baseball" },
  { slug: "st-louis-cardinals", name: "St. Louis Cardinals", searchTerms: ["St. Louis Cardinals"], sport: "baseball" },
  { slug: "tampa-bay-rays", name: "Tampa Bay Rays", searchTerms: ["Tampa Bay Rays"], sport: "baseball" },
  { slug: "texas-rangers", name: "Texas Rangers", searchTerms: ["Texas Rangers"], sport: "baseball" },
  { slug: "toronto-blue-jays", name: "Toronto Blue Jays", searchTerms: ["Toronto Blue Jays"], sport: "baseball" },
  { slug: "washington-nationals", name: "Washington Nationals", searchTerms: ["Washington Nationals"], sport: "baseball" },

  // NHL
  { slug: "anaheim-ducks", name: "Anaheim Ducks", searchTerms: ["Anaheim Ducks"], sport: "hockey" },
  { slug: "boston-bruins", name: "Boston Bruins", searchTerms: ["Boston Bruins"], sport: "hockey" },
  { slug: "buffalo-sabres", name: "Buffalo Sabres", searchTerms: ["Buffalo Sabres"], sport: "hockey" },
  { slug: "calgary-flames", name: "Calgary Flames", searchTerms: ["Calgary Flames"], sport: "hockey" },
  { slug: "carolina-hurricanes", name: "Carolina Hurricanes", searchTerms: ["Carolina Hurricanes"], sport: "hockey" },
  { slug: "chicago-blackhawks", name: "Chicago Blackhawks", searchTerms: ["Chicago Blackhawks"], sport: "hockey" },
  { slug: "colorado-avalanche", name: "Colorado Avalanche", searchTerms: ["Colorado Avalanche"], sport: "hockey" },
  { slug: "columbus-blue-jackets", name: "Columbus Blue Jackets", searchTerms: ["Columbus Blue Jackets"], sport: "hockey" },
  { slug: "dallas-stars", name: "Dallas Stars", searchTerms: ["Dallas Stars"], sport: "hockey" },
  { slug: "detroit-red-wings", name: "Detroit Red Wings", searchTerms: ["Detroit Red Wings"], sport: "hockey" },
  { slug: "edmonton-oilers", name: "Edmonton Oilers", searchTerms: ["Edmonton Oilers"], sport: "hockey" },
  { slug: "florida-panthers", name: "Florida Panthers", searchTerms: ["Florida Panthers"], sport: "hockey" },
  { slug: "los-angeles-kings", name: "Los Angeles Kings", searchTerms: ["Los Angeles Kings"], sport: "hockey" },
  { slug: "minnesota-wild", name: "Minnesota Wild", searchTerms: ["Minnesota Wild"], sport: "hockey" },
  { slug: "montreal-canadiens", name: "Montreal Canadiens", searchTerms: ["Montreal Canadiens"], sport: "hockey" },
  { slug: "nashville-predators", name: "Nashville Predators", searchTerms: ["Nashville Predators"], sport: "hockey" },
  { slug: "new-jersey-devils", name: "New Jersey Devils", searchTerms: ["New Jersey Devils"], sport: "hockey" },
  { slug: "new-york-islanders", name: "New York Islanders", searchTerms: ["New York Islanders"], sport: "hockey" },
  { slug: "new-york-rangers", name: "New York Rangers", searchTerms: ["New York Rangers"], sport: "hockey" },
  { slug: "ottawa-senators", name: "Ottawa Senators", searchTerms: ["Ottawa Senators"], sport: "hockey" },
  { slug: "philadelphia-flyers", name: "Philadelphia Flyers", searchTerms: ["Philadelphia Flyers"], sport: "hockey" },
  { slug: "pittsburgh-penguins", name: "Pittsburgh Penguins", searchTerms: ["Pittsburgh Penguins"], sport: "hockey" },
  { slug: "san-jose-sharks", name: "San Jose Sharks", searchTerms: ["San Jose Sharks"], sport: "hockey" },
  { slug: "seattle-kraken", name: "Seattle Kraken", searchTerms: ["Seattle Kraken"], sport: "hockey" },
  { slug: "st-louis-blues", name: "St. Louis Blues", searchTerms: ["St. Louis Blues"], sport: "hockey" },
  { slug: "tampa-bay-lightning", name: "Tampa Bay Lightning", searchTerms: ["Tampa Bay Lightning"], sport: "hockey" },
  { slug: "toronto-maple-leafs", name: "Toronto Maple Leafs", searchTerms: ["Toronto Maple Leafs"], sport: "hockey" },
  { slug: "utah-mammoth", name: "Utah Mammoth", searchTerms: ["Utah Mammoth"], sport: "hockey" },
  { slug: "vancouver-canucks", name: "Vancouver Canucks", searchTerms: ["Vancouver Canucks"], sport: "hockey" },
  { slug: "vegas-golden-knights", name: "Vegas Golden Knights", searchTerms: ["Vegas Golden Knights"], sport: "hockey" },
  { slug: "washington-capitals", name: "Washington Capitals", searchTerms: ["Washington Capitals"], sport: "hockey" },
  { slug: "winnipeg-jets", name: "Winnipeg Jets", searchTerms: ["Winnipeg Jets"], sport: "hockey" },

  // Premier League (additions)
  { slug: "afc-bournemouth", name: "AFC Bournemouth", searchTerms: ["AFC Bournemouth"], sport: "football" },
  { slug: "aston-villa", name: "Aston Villa", searchTerms: ["Aston Villa"], sport: "football" },
  { slug: "brentford", name: "Brentford", searchTerms: ["Brentford"], sport: "football" },
  { slug: "brighton-hove-albion", name: "Brighton & Hove Albion", searchTerms: ["Brighton & Hove Albion"], sport: "football" },
  { slug: "coventry-city", name: "Coventry City", searchTerms: ["Coventry City"], sport: "football" },
  { slug: "crystal-palace", name: "Crystal Palace", searchTerms: ["Crystal Palace"], sport: "football" },
  { slug: "everton", name: "Everton", searchTerms: ["Everton"], sport: "football" },
  { slug: "fulham", name: "Fulham", searchTerms: ["Fulham"], sport: "football" },
  { slug: "hull-city", name: "Hull City", searchTerms: ["Hull City"], sport: "football" },
  { slug: "ipswich-town", name: "Ipswich Town", searchTerms: ["Ipswich Town"], sport: "football" },
  { slug: "leeds-united", name: "Leeds United", searchTerms: ["Leeds United"], sport: "football" },
  { slug: "newcastle-united", name: "Newcastle United", searchTerms: ["Newcastle United"], sport: "football" },
  { slug: "nottingham-forest", name: "Nottingham Forest", searchTerms: ["Nottingham Forest"], sport: "football" },
  { slug: "sunderland", name: "Sunderland", searchTerms: ["Sunderland"], sport: "football" },
  { slug: "tottenham-hotspur", name: "Tottenham Hotspur", searchTerms: ["Tottenham Hotspur"], sport: "football" },

  // Bundesliga (additions)
  { slug: "1-fc-union-berlin", name: "1. FC Union Berlin", searchTerms: ["1. FC Union Berlin"], sport: "football" },
  { slug: "bayer-leverkusen", name: "Bayer Leverkusen", searchTerms: ["Bayer Leverkusen"], sport: "football" },
  { slug: "borussia-monchengladbach", name: "Borussia Mönchengladbach", searchTerms: ["Borussia Mönchengladbach"], sport: "football" },
  { slug: "eintracht-frankfurt", name: "Eintracht Frankfurt", searchTerms: ["Eintracht Frankfurt"], sport: "football" },
  { slug: "fc-augsburg", name: "FC Augsburg", searchTerms: ["FC Augsburg"], sport: "football" },
  { slug: "fc-cologne", name: "FC Cologne", searchTerms: ["FC Cologne"], sport: "football" },
  { slug: "hamburg-sv", name: "Hamburg SV", searchTerms: ["Hamburg SV"], sport: "football" },
  { slug: "mainz", name: "Mainz", searchTerms: ["Mainz"], sport: "football" },
  { slug: "rb-leipzig", name: "RB Leipzig", searchTerms: ["RB Leipzig"], sport: "football" },
  { slug: "sc-freiburg", name: "SC Freiburg", searchTerms: ["SC Freiburg"], sport: "football" },
  { slug: "sc-paderborn-07", name: "SC Paderborn 07", searchTerms: ["SC Paderborn 07"], sport: "football" },
  { slug: "schalke-04", name: "Schalke 04", searchTerms: ["Schalke 04"], sport: "football" },
  { slug: "sv-elversberg", name: "SV Elversberg", searchTerms: ["SV Elversberg"], sport: "football" },
  { slug: "tsg-hoffenheim", name: "TSG Hoffenheim", searchTerms: ["TSG Hoffenheim"], sport: "football" },
  { slug: "vfb-stuttgart", name: "VfB Stuttgart", searchTerms: ["VfB Stuttgart"], sport: "football" },
  { slug: "werder-bremen", name: "Werder Bremen", searchTerms: ["Werder Bremen"], sport: "football" },

  // Serie A (additions; "Monza" excluded -- see note above)
  { slug: "as-roma", name: "AS Roma", searchTerms: ["AS Roma"], sport: "football" },
  { slug: "atalanta", name: "Atalanta", searchTerms: ["Atalanta"], sport: "football" },
  { slug: "bologna", name: "Bologna", searchTerms: ["Bologna"], sport: "football" },
  { slug: "cagliari", name: "Cagliari", searchTerms: ["Cagliari"], sport: "football" },
  { slug: "como", name: "Como", searchTerms: ["Como"], sport: "football" },
  { slug: "fiorentina", name: "Fiorentina", searchTerms: ["Fiorentina"], sport: "football" },
  { slug: "frosinone", name: "Frosinone", searchTerms: ["Frosinone"], sport: "football" },
  { slug: "genoa", name: "Genoa", searchTerms: ["Genoa"], sport: "football" },
  { slug: "lazio", name: "Lazio", searchTerms: ["Lazio"], sport: "football" },
  { slug: "lecce", name: "Lecce", searchTerms: ["Lecce"], sport: "football" },
  { slug: "napoli", name: "Napoli", searchTerms: ["Napoli"], sport: "football" },
  { slug: "parma", name: "Parma", searchTerms: ["Parma"], sport: "football" },
  { slug: "sassuolo", name: "Sassuolo", searchTerms: ["Sassuolo"], sport: "football" },
  { slug: "torino", name: "Torino", searchTerms: ["Torino"], sport: "football" },
  { slug: "udinese", name: "Udinese", searchTerms: ["Udinese"], sport: "football" },
  { slug: "venezia", name: "Venezia", searchTerms: ["Venezia"], sport: "football" },

  // Ligue 1 (additions; "Nice"/"Angers" excluded -- see note above)
  { slug: "aj-auxerre", name: "AJ Auxerre", searchTerms: ["AJ Auxerre"], sport: "football" },
  { slug: "as-monaco", name: "AS Monaco", searchTerms: ["AS Monaco"], sport: "football" },
  { slug: "brest", name: "Brest", searchTerms: ["Brest"], sport: "football" },
  { slug: "le-havre-ac", name: "Le Havre AC", searchTerms: ["Le Havre AC"], sport: "football" },
  { slug: "le-mans", name: "Le Mans", searchTerms: ["Le Mans"], sport: "football" },
  { slug: "lens", name: "Lens", searchTerms: ["Lens"], sport: "football" },
  { slug: "lille", name: "Lille", searchTerms: ["Lille"], sport: "football" },
  { slug: "lorient", name: "Lorient", searchTerms: ["Lorient"], sport: "football" },
  { slug: "lyon", name: "Lyon", searchTerms: ["Lyon"], sport: "football" },
  { slug: "paris-fc", name: "Paris FC", searchTerms: ["Paris FC"], sport: "football" },
  { slug: "stade-rennais", name: "Stade Rennais", searchTerms: ["Stade Rennais"], sport: "football" },
  { slug: "strasbourg", name: "Strasbourg", searchTerms: ["Strasbourg"], sport: "football" },
  { slug: "toulouse", name: "Toulouse", searchTerms: ["Toulouse"], sport: "football" },
  { slug: "troyes", name: "Troyes", searchTerms: ["Troyes"], sport: "football" },

  // MLS
  { slug: "atlanta-united-fc", name: "Atlanta United FC", searchTerms: ["Atlanta United FC"], sport: "football" },
  { slug: "austin-fc", name: "Austin FC", searchTerms: ["Austin FC"], sport: "football" },
  { slug: "cf-montreal", name: "CF Montréal", searchTerms: ["CF Montréal"], sport: "football" },
  { slug: "charlotte-fc", name: "Charlotte FC", searchTerms: ["Charlotte FC"], sport: "football" },
  { slug: "chicago-fire-fc", name: "Chicago Fire FC", searchTerms: ["Chicago Fire FC"], sport: "football" },
  { slug: "colorado-rapids", name: "Colorado Rapids", searchTerms: ["Colorado Rapids"], sport: "football" },
  { slug: "columbus-crew", name: "Columbus Crew", searchTerms: ["Columbus Crew"], sport: "football" },
  { slug: "d-c-united", name: "D.C. United", searchTerms: ["D.C. United"], sport: "football" },
  { slug: "fc-cincinnati", name: "FC Cincinnati", searchTerms: ["FC Cincinnati"], sport: "football" },
  { slug: "fc-dallas", name: "FC Dallas", searchTerms: ["FC Dallas"], sport: "football" },
  { slug: "houston-dynamo-fc", name: "Houston Dynamo FC", searchTerms: ["Houston Dynamo FC"], sport: "football" },
  { slug: "inter-miami-cf", name: "Inter Miami CF", searchTerms: ["Inter Miami CF"], sport: "football" },
  { slug: "la-galaxy", name: "LA Galaxy", searchTerms: ["LA Galaxy"], sport: "football" },
  { slug: "lafc", name: "LAFC", searchTerms: ["LAFC"], sport: "football" },
  { slug: "minnesota-united-fc", name: "Minnesota United FC", searchTerms: ["Minnesota United FC"], sport: "football" },
  { slug: "nashville-sc", name: "Nashville SC", searchTerms: ["Nashville SC"], sport: "football" },
  { slug: "new-england-revolution", name: "New England Revolution", searchTerms: ["New England Revolution"], sport: "football" },
  { slug: "new-york-city-fc", name: "New York City FC", searchTerms: ["New York City FC"], sport: "football" },
  { slug: "orlando-city-sc", name: "Orlando City SC", searchTerms: ["Orlando City SC"], sport: "football" },
  { slug: "philadelphia-union", name: "Philadelphia Union", searchTerms: ["Philadelphia Union"], sport: "football" },
  { slug: "portland-timbers", name: "Portland Timbers", searchTerms: ["Portland Timbers"], sport: "football" },
  { slug: "real-salt-lake", name: "Real Salt Lake", searchTerms: ["Real Salt Lake"], sport: "football" },
  { slug: "red-bull-new-york", name: "Red Bull New York", searchTerms: ["Red Bull New York"], sport: "football" },
  { slug: "san-diego-fc", name: "San Diego FC", searchTerms: ["San Diego FC"], sport: "football" },
  { slug: "san-jose-earthquakes", name: "San Jose Earthquakes", searchTerms: ["San Jose Earthquakes"], sport: "football" },
  { slug: "seattle-sounders-fc", name: "Seattle Sounders FC", searchTerms: ["Seattle Sounders FC"], sport: "football" },
  { slug: "sporting-kansas-city", name: "Sporting Kansas City", searchTerms: ["Sporting Kansas City"], sport: "football" },
  { slug: "st-louis-city-sc", name: "St. Louis CITY SC", searchTerms: ["St. Louis CITY SC"], sport: "football" },
  { slug: "toronto-fc", name: "Toronto FC", searchTerms: ["Toronto FC"], sport: "football" },
  { slug: "vancouver-whitecaps", name: "Vancouver Whitecaps", searchTerms: ["Vancouver Whitecaps"], sport: "football" },
  // IPL (Indian Premier League) — added 2026-09-20 (explicit request, real
  // article gap: Chennai Super Kings' new head coach announcement had no
  // club page to link to). All 10 current real franchises, WebSearch-
  // verified live against ESPNcricinfo/Wikipedia, not guessed — includes
  // Royal Challengers Bengaluru's real 2023 rename (searchTerms keeps the
  // old "Bangalore" name too, since older/habitual references still use
  // it). No crest URL needed here — club pages resolve crests dynamically
  // from matched articles' own homeCrestUrl/awayCrestUrl (findClubCrest),
  // not a hardcoded field on this entry, same as every other club below.
  { slug: "chennai-super-kings", name: "Chennai Super Kings", searchTerms: ["Chennai Super Kings"], sport: "cricket" },
  { slug: "mumbai-indians", name: "Mumbai Indians", searchTerms: ["Mumbai Indians"], sport: "cricket" },
  { slug: "royal-challengers-bengaluru", name: "Royal Challengers Bengaluru", searchTerms: ["Royal Challengers Bengaluru", "Royal Challengers Bangalore"], sport: "cricket" },
  { slug: "kolkata-knight-riders", name: "Kolkata Knight Riders", searchTerms: ["Kolkata Knight Riders"], sport: "cricket" },
  { slug: "sunrisers-hyderabad", name: "Sunrisers Hyderabad", searchTerms: ["Sunrisers Hyderabad"], sport: "cricket" },
  { slug: "rajasthan-royals", name: "Rajasthan Royals", searchTerms: ["Rajasthan Royals"], sport: "cricket" },
  { slug: "delhi-capitals", name: "Delhi Capitals", searchTerms: ["Delhi Capitals"], sport: "cricket" },
  { slug: "punjab-kings", name: "Punjab Kings", searchTerms: ["Punjab Kings"], sport: "cricket" },
  { slug: "gujarat-titans", name: "Gujarat Titans", searchTerms: ["Gujarat Titans"], sport: "cricket" },
  { slug: "lucknow-super-giants", name: "Lucknow Super Giants", searchTerms: ["Lucknow Super Giants"], sport: "cricket" },
  // Added 2026-09-27: clubs in the news with no page.
  { slug: "west-ham-united", name: "West Ham United", searchTerms: ["West Ham"], sport: "football" },
  // College football: full names where the state or school alone is
  // ambiguous (Texas, Georgia, Michigan, Oregon...).
  { slug: "ohio-state", name: "Ohio State Buckeyes", searchTerms: ["Ohio State"], sport: "college-football" },
  { slug: "penn-state", name: "Penn State Nittany Lions", searchTerms: ["Penn State"], sport: "college-football" },
  { slug: "notre-dame", name: "Notre Dame Fighting Irish", searchTerms: ["Notre Dame"], sport: "college-football" },
  { slug: "ole-miss", name: "Ole Miss Rebels", searchTerms: ["Ole Miss"], sport: "college-football" },
  { slug: "michigan-wolverines", name: "Michigan Wolverines", searchTerms: ["Michigan Wolverines"], sport: "college-football" },
  { slug: "michigan-state", name: "Michigan State Spartans", searchTerms: ["Michigan State"], sport: "college-football" },
  { slug: "texas-longhorns", name: "Texas Longhorns", searchTerms: ["Texas Longhorns"], sport: "college-football" },
  { slug: "tennessee-volunteers", name: "Tennessee Volunteers", searchTerms: ["Tennessee Volunteers", "Vols"], sport: "college-football" },
  { slug: "georgia-bulldogs", name: "Georgia Bulldogs", searchTerms: ["Georgia Bulldogs"], sport: "college-football" },
  { slug: "alabama-crimson-tide", name: "Alabama Crimson Tide", searchTerms: ["Alabama Crimson Tide"], sport: "college-football" },
  { slug: "lsu-tigers", name: "LSU Tigers", searchTerms: ["LSU"], sport: "college-football" },
  { slug: "oregon-ducks", name: "Oregon Ducks", searchTerms: ["Oregon Ducks"], sport: "college-football" },
  { slug: "usc-trojans", name: "USC Trojans", searchTerms: ["USC Trojans"], sport: "college-football" },
  { slug: "iowa-state", name: "Iowa State Cyclones", searchTerms: ["Iowa State"], sport: "college-football" },
  { slug: "mississippi-state", name: "Mississippi State Bulldogs", searchTerms: ["Mississippi State"], sport: "college-football" },
  { slug: "colorado-buffaloes", name: "Colorado Buffaloes", searchTerms: ["Colorado Buffaloes"], sport: "college-football" },
];
