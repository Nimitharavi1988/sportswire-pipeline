// Team, star and event hashtags for the topic Pages and accounts (2026-10-28). An audit of a week's stories found that most
// of them got only generic tags (#SportsNews): baseball, hockey, MMA, tennis, golf, MotoGP, cycling, padel, rugby and
// boxing had no sport tag at all, and the big sports named a team or player on only 30-50% of stories.
// Used by the topic selectors in hashtagRepertoire.ts; the main Page and main Instagram never call it. Pure, unit-tested.

import { cricketSpecifics } from "./cricketHashtags";

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const tagOf = (name: string) => "#" + strip(name).replace(/[^A-Za-z0-9]/g, "");

// "Full Name|Alias|Alias": the tag is the full name; any of the names (full or alias) in the headline matches.
type Star = string;
interface SportSet {
  sport: string | null;               // the sport's own tag, always offered as the broad one (cricket: none, its usual tags cover it)
  stars?: Star[];
  teams?: [tag: string, pattern: RegExp][];
  events?: [tag: string, pattern: RegExp][];
  // A matchup or debate: the tag counts only when the headline names both sides.
  rivalries?: [tag: string, pattern: RegExp][];
  // Tags worked out from the headline in code (cricket: matchup, franchise, player, teams), already most-specific first.
  derived?: (title: string) => string[];
}

const NBA_STARS: Star[] = [
  "LeBron James|LeBron", "Stephen Curry", "Luka Doncic|Luka Dončić", "Nikola Jokic|Nikola Jokić", "Giannis Antetokounmpo|Giannis",
  "Victor Wembanyama|Wembanyama", "Shai Gilgeous-Alexander", "Jayson Tatum", "Kevin Durant", "Anthony Edwards", "Jalen Brunson",
  "Ja Morant", "Devin Booker", "Anthony Davis", "Joel Embiid", "Cooper Flagg",
];
// Teams that are also ordinary words (Heat, Magic, Jazz, Kings, Suns, Nets) are matched with their city.
const NBA_TEAMS: [string, RegExp][] = [
  ["#Hawks", /\bAtlanta Hawks\b|\bHawks\b/], ["#Celtics", /\bCeltics\b/], ["#Nets", /\bBrooklyn Nets\b/], ["#Hornets", /\bHornets\b/],
  ["#Bulls", /\bBulls\b/], ["#Cavaliers", /\bCavaliers\b|\bCavs\b/], ["#Mavericks", /\bMavericks\b|\bMavs\b/], ["#Nuggets", /\bNuggets\b/],
  ["#Pistons", /\bPistons\b/], ["#Warriors", /\bGolden State Warriors\b|\bWarriors\b/], ["#Rockets", /\bRockets\b/], ["#Pacers", /\bPacers\b/],
  ["#Clippers", /\bClippers\b/], ["#Lakers", /\bLakers\b/], ["#Grizzlies", /\bGrizzlies\b/], ["#MiamiHeat", /\bMiami Heat\b/],
  ["#Bucks", /\bBucks\b/], ["#Timberwolves", /\bTimberwolves\b/], ["#Pelicans", /\bPelicans\b/], ["#Knicks", /\bKnicks\b/],
  ["#Thunder", /\bOklahoma City Thunder\b|\bOKC Thunder\b/], ["#OrlandoMagic", /\bOrlando Magic\b/], ["#Sixers", /\b76ers\b|\bSixers\b/],
  ["#Suns", /\bPhoenix Suns\b/], ["#TrailBlazers", /\bTrail Blazers\b|\bBlazers\b/], ["#SacramentoKings", /\bSacramento Kings\b/],
  ["#Spurs", /\bSan Antonio Spurs\b|\bSpurs\b/], ["#Raptors", /\bRaptors\b/], ["#UtahJazz", /\bUtah Jazz\b/], ["#Wizards", /\bWizards\b/],
];

// Nicknames shared across leagues or with ordinary words get a city-qualified tag (#NYGiants, #SeattleStorm), set in `fix`.
// Matching is by sport category, so a bare "Giants" in baseball is San Francisco's and in the NFL New York's.
const nick = (names: string[], fix: Record<string, string> = {}): [string, RegExp][] =>
  names.map((n) => [fix[n] ?? tagOf(n), new RegExp(`\\b${n.replace(/ /g, "\\s")}\\b`)] as [string, RegExp]);

// College programmes: a bare school name, but not its look-alikes ("Texas" is not Texas A&M or Texas Tech).
const NOT_AFTER = "(?! State| Tech| A&M| Southern| Atlantic)";
// "North Texas" is not Texas, nor "Eastern Michigan" Michigan.
const DIRECTIONAL = "(?<!North |South |East |West |Central |Northern |Southern |Eastern |Western |Middle )";
const school = (...names: string[]): [string, RegExp][] => names.map((n) => [tagOf(n), new RegExp(`${DIRECTIONAL}\\b${n.replace(/ /g, "\\s")}\\b${/ State$| Tech$| A&M$/.test(n) ? "" : NOT_AFTER}`)] as [string, RegExp]);

// A headline that names both sides of a matchup (either order).
const both = (x: string, y: string) => new RegExp("^(?=[\\s\\S]*\\b(?:" + x + ")\\b)(?=[\\s\\S]*\\b(?:" + y + ")\\b)");

const SETS: Record<string, SportSet> = {
  cricket: { sport: null, derived: cricketSpecifics },
  basketball: { sport: "#NBA", stars: NBA_STARS, teams: NBA_TEAMS },
  "american-football": {
    sport: "#NFL",
    stars: ["Patrick Mahomes|Mahomes", "Josh Allen", "Lamar Jackson", "Jalen Hurts", "Joe Burrow", "Caleb Williams", "Drake Maye", "Saquon Barkley", "Travis Kelce", "Justin Jefferson", "Christian McCaffrey", "Aaron Rodgers", "Brock Purdy", "C.J. Stroud", "Jayden Daniels", "Bo Nix", "Micah Parsons", "T.J. Watt", "Baker Mayfield", "Jared Goff", "Jordan Love", "Dak Prescott", "Sam Darnold", "Derrick Henry", "Ja'Marr Chase", "CeeDee Lamb", "Amon-Ra St. Brown", "Puka Nacua", "Malik Nabers", "Brian Thomas Jr.", "Bijan Robinson", "Jahmyr Gibbs", "Myles Garrett", "J.J. McCarthy", "Matthew Stafford", "Jaxon Smith-Njigba|Smith-Njigba"],
    teams: nick(["Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears", "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers", "Texans", "Colts", "Jaguars", "Chiefs", "Raiders", "Chargers", "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants", "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers", "Titans", "Commanders"],
      { Cardinals: "#AZCardinals", Panthers: "#CarolinaPanthers", Rams: "#LARams", Giants: "#NYGiants", Jets: "#NYJets", Bears: "#ChicagoBears", Lions: "#DetroitLions", Chargers: "#LAChargers", Raiders: "#RaiderNation" }),
    events: [["#SuperBowl", /\bSuper Bowl\b/], ["#NFLDraft", /\bNFL Draft\b/]],
  },
  "college-football": {
    sport: "#CollegeFootball",
    teams: [
      ...school("Alabama", "Georgia", "Ohio State", "Michigan", "Texas", "Oregon", "Notre Dame", "Clemson", "LSU", "Penn State", "Oklahoma", "USC", "Florida State", "Tennessee", "Texas A&M", "Ole Miss", "Indiana", "Auburn", "Nebraska", "Wisconsin", "Iowa", "Utah", "Kansas State", "Arizona State", "BYU", "TCU", "Baylor", "Louisville", "UCLA", "Minnesota", "Illinois", "Northwestern", "Duke", "Virginia Tech", "NC State", "Missouri", "Arkansas", "Kentucky", "South Carolina", "Vanderbilt", "Mississippi State", "Michigan State", "Oregon State", "Washington", "Boise State", "Army", "Navy", "SMU", "Cincinnati", "Houston", "Texas Tech", "Oklahoma State", "West Virginia", "Iowa State", "Kansas", "Colorado", "Syracuse", "Georgia Tech", "Florida", "Maryland", "Rutgers", "Purdue", "Pittsburgh", "Miami Hurricanes"),
    ],
    events: [["#CFBPlayoff", /\bCollege Football Playoff\b|\bCFP\b/], ["#HeismanTrophy", /\bHeisman\b/], ["#SECfootball", /\bSEC\b/], ["#BigTen", /\bBig Ten\b/], ["#Big12", /\bBig 12\b/], ["#ACC", /\bACC\b/]],
  },
  baseball: {
    sport: "#MLB",
    stars: ["Shohei Ohtani|Ohtani", "Aaron Judge", "Juan Soto", "Mookie Betts", "Paul Skenes|Skenes", "Bobby Witt Jr.", "Freddie Freeman", "Cal Raleigh", "Elly De La Cruz", "Corbin Carroll", "Gunnar Henderson", "Jacob Misiorowski|Misiorowski", "Jackson Chourio|Chourio", "Tarik Skubal|Skubal", "Garrett Crochet", "Yoshinobu Yamamoto|Yamamoto", "Julio Rodriguez|Julio Rodríguez", "Fernando Tatis Jr.", "Vladimir Guerrero Jr.", "Rafael Devers", "Francisco Lindor", "Pete Alonso", "Kyle Schwarber", "Bryce Harper", "Mike Trout", "Christian Yelich|Yelich", "Drew Rasmussen", "Pete Crow-Armstrong|Crow-Armstrong", "Yordan Alvarez", "Zack Wheeler"],
    teams: [...nick(["Diamondbacks", "Braves", "Orioles", "Red Sox", "Cubs", "White Sox", "Reds", "Guardians", "Rockies", "Tigers", "Astros", "Royals", "Angels", "Dodgers", "Marlins", "Brewers", "Twins", "Mets", "Yankees", "Phillies", "Pirates", "Padres", "Giants", "Mariners", "Cardinals", "Rays", "Rangers", "Blue Jays", "Nationals"],
      { Reds: "#CincinnatiReds", Tigers: "#DetroitTigers", Giants: "#SFGiants", Cardinals: "#STLCards", Rangers: "#TexasRangers", Twins: "#MNTwins", Angels: "#LAAngels", Cubs: "#Cubs" }), ["#Athletics", /\bAthletics\b/]],
    events: [["#WorldSeries", /\bWorld Series\b/], ["#MLBPostseason", /\bALCS\b|\bNLCS\b|\bALDS\b|\bNLDS\b/]],
  },
  hockey: {
    sport: "#NHL",
    stars: ["Connor McDavid|McDavid", "Sidney Crosby|Crosby", "Alex Ovechkin|Ovechkin", "Auston Matthews", "Nathan MacKinnon|MacKinnon", "Leon Draisaitl|Draisaitl", "Cale Makar", "Connor Bedard|Bedard", "Nikita Kucherov|Kucherov", "Macklin Celebrini|Celebrini", "Igor Shesterkin", "Quinn Hughes", "Matthew Tkachuk", "Jack Hughes", "Kirill Kaprizov|Kaprizov", "David Pastrnak|Pastrňák|Pastrnak", "Mitch Marner", "Jason Robertson", "Mikko Rantanen|Rantanen", "Andrei Vasilevskiy|Vasilevskiy"],
    teams: [...nick(["Ducks", "Bruins", "Sabres", "Flames", "Hurricanes", "Blackhawks", "Avalanche", "Blue Jackets", "Red Wings", "Oilers", "Panthers", "Canadiens", "Predators", "Devils", "Islanders", "Rangers", "Senators", "Flyers", "Penguins", "Sharks", "Kraken", "Lightning", "Maple Leafs", "Mammoth", "Canucks", "Golden Knights", "Capitals", "Jets"],
      { Ducks: "#AnaheimDucks", Panthers: "#FlaPanthers", Devils: "#NJDevils", Rangers: "#NYRangers", Lightning: "#TBLightning", Jets: "#WinnipegJets", Islanders: "#NYIslanders", "Golden Knights": "#VegasGoldenKnights" }),
      ["#MinnesotaWild", /\bMinnesota Wild\b/], ["#DallasStars", /\bDallas Stars\b/], ["#StLouisBlues", /\bSt\. Louis Blues\b|\bSt Louis Blues\b/], ["#LAKings", /\bLos Angeles Kings\b|\bLA Kings\b/]],
    events: [["#StanleyCup", /\bStanley Cup\b/]],
  },
  wnba: {
    sport: "#WNBA",
    stars: ["Caitlin Clark", "A'ja Wilson", "Angel Reese", "Breanna Stewart", "Paige Bueckers", "Napheesa Collier", "Sabrina Ionescu", "Kelsey Plum", "Cameron Brink", "Jewell Loyd", "Alyssa Thomas", "Satou Sabally", "Aliyah Boston", "Nneka Ogwumike", "Allisha Gray"],
    teams: nick(["Dream", "Sky", "Fever", "Liberty", "Mercury", "Lynx", "Sparks", "Aces", "Storm", "Wings", "Valkyries", "Tempo"],
      { Dream: "#AtlantaDream", Sky: "#ChicagoSky", Fever: "#IndianaFever", Liberty: "#NYLiberty", Mercury: "#PhoenixMercury", Lynx: "#MinnesotaLynx", Sparks: "#LASparks", Aces: "#LasVegasAces", Storm: "#SeattleStorm", Wings: "#DallasWings", Tempo: "#TorontoTempo" }),
    events: [["#WNBAFinals", /\bWNBA Finals\b/], ["#WNBAPlayoffs", /\bWNBA playoffs\b|\bWNBA Playoffs\b/]],
  },
  football: {
    sport: "#Football",
    rivalries: [
      ["#ElClasico", both("Real Madrid", "Barcelona|Barça")],
      ["#ElClasico", /\bEl Cl[aá]sico\b/],
      ["#ManchesterDerby", both("Manchester City|Man City", "Manchester United|Man United|Man Utd")],
      ["#NorthLondonDerby", both("Arsenal", "Tottenham|Spurs")],
      ["#MerseysideDerby", both("Liverpool", "Everton")],
      ["#MessiVsRonaldo", both("Messi", "Ronaldo")],
    ],
    stars: ["Erling Haaland|Haaland", "Kylian Mbappe|Mbappé|Mbappe", "Lionel Messi|Messi", "Cristiano Ronaldo", "Harry Kane", "Jude Bellingham|Bellingham", "Mohamed Salah|Salah", "Lamine Yamal|Yamal", "Vinicius Junior|Vinícius", "Bukayo Saka", "Declan Rice", "Florian Wirtz|Wirtz", "Cole Palmer", "Neymar", "Robert Lewandowski|Lewandowski", "Son Heung-min", "Kevin De Bruyne|De Bruyne", "Virgil van Dijk|Van Dijk", "Phil Foden|Foden", "Marcus Rashford|Rashford", "Bruno Fernandes", "Rodri", "Raphinha", "Pedri", "Victor Osimhen|Osimhen", "Lautaro Martinez|Lautaro Martínez", "Antoine Griezmann|Griezmann", "Trent Alexander-Arnold", "Viktor Gyokeres|Gyökeres|Gyokeres", "Alexander Isak|Isak", "Martin Odegaard|Ødegaard|Odegaard", "Eberechi Eze", "Ousmane Dembele|Dembélé|Dembele", "Christian Pulisic|Pulisic", "Alphonso Davies"],
    teams: [
      ["#Arsenal", /\bArsenal\b/], ["#Chelsea", /\bChelsea\b/], ["#Liverpool", /\bLiverpool\b/], ["#ManCity", /\bManchester City\b|\bMan City\b/], ["#ManUtd", /\bManchester United\b|\bMan United\b|\bMan Utd\b/],
      ["#Spurs", /\bTottenham\b|\bSpurs\b/], ["#Newcastle", /\bNewcastle\b/], ["#AstonVilla", /\bAston Villa\b/], ["#WestHam", /\bWest Ham\b/], ["#Everton", /\bEverton\b/],
      ["#Brighton", /\bBrighton\b/], ["#Brentford", /\bBrentford\b/], ["#Fulham", /\bFulham\b/], ["#CrystalPalace", /\bCrystal Palace\b/], ["#Wolves", /\bWolves\b|\bWolverhampton\b/], ["#NottmForest", /\bNottingham Forest\b/], ["#Bournemouth", /\bBournemouth\b/], ["#LeedsUnited", /\bLeeds\b/], ["#Sunderland", /\bSunderland\b/], ["#Celtic", /\bCeltic\b/],
      ["#RealMadrid", /\bReal Madrid\b/], ["#Barcelona", /\bBarcelona\b|\bBarça\b/], ["#Atletico", /\bAtl[eé]tico Madrid\b/], ["#Sevilla", /\bSevilla\b/], ["#RealSociedad", /\bReal Sociedad\b/], ["#Villarreal", /\bVillarreal\b/], ["#AthleticClub", /\bAthletic Club\b|\bAthletic Bilbao\b/],
      ["#Bayern", /\bBayern\b/], ["#BVB", /\bBorussia Dortmund\b|\bDortmund\b/], ["#Leverkusen", /\bLeverkusen\b/], ["#RBLeipzig", /\bRB Leipzig\b/], ["#Eintracht", /\bEintracht Frankfurt\b/],
      ["#Juventus", /\bJuventus\b/], ["#Inter", /\bInter Milan\b|\bInternazionale\b/], ["#ACMilan", /\bAC Milan\b/], ["#Napoli", /\bNapoli\b/], ["#ASRoma", /\bAS Roma\b/], ["#Atalanta", /\bAtalanta\b/], ["#Lazio", /\bLazio\b/],
      ["#PSG", /\bPSG\b|\bParis Saint-Germain\b/], ["#OM", /\bMarseille\b/], ["#OL", /\bLyon\b/], ["#ASMonaco", /\bMonaco\b/],
      ["#Ajax", /\bAjax\b/], ["#Benfica", /\bBenfica\b/], ["#FCPorto", /\bPorto\b/], ["#SportingCP", /\bSporting CP\b/], ["#Galatasaray", /\bGalatasaray\b/],
      ["#InterMiami", /\bInter Miami\b/], ["#LAFC", /\bLAFC\b/], ["#LAGalaxy", /\bLA Galaxy\b/], ["#SoundersFC", /\bSounders\b/], ["#ClubAmerica", /\bClub Am[eé]rica\b/], ["#Chivas", /\bChivas\b/], ["#TigresUANL", /\bTigres\b/], ["#Rayados", /\bRayados\b|\bMonterrey\b/], ["#BocaJuniors", /\bBoca Juniors\b/], ["#RiverPlate", /\bRiver Plate\b/],
    ],
    events: [["#ChampionsLeague", /\bChampions League\b/], ["#PremierLeague", /\bPremier League\b/], ["#LaLiga", /\bLa Liga\b/], ["#Bundesliga", /\bBundesliga\b/], ["#SerieA", /\bSerie A\b/], ["#Ligue1", /\bLigue 1\b/], ["#MLS", /\bMLS\b/], ["#LigaMX", /\bLiga MX\b/], ["#EuropaLeague", /\bEuropa League\b/], ["#WorldCup", /\bWorld Cup\b/], ["#FACup", /\bFA Cup\b/]],
  },
  mma: {
    sport: "#MMA",
    stars: ["Jon Jones", "Islam Makhachev|Makhachev", "Conor McGregor|McGregor", "Alex Pereira|Pereira", "Ilia Topuria|Topuria", "Alexander Volkanovski|Volkanovski", "Dricus du Plessis", "Max Holloway", "Charles Oliveira", "Sean O'Malley", "Merab Dvalishvili"],
    events: [["#UFC", /\bUFC\b/], ["#Bellator", /\bBellator\b/], ["#PFL", /\bPFL\b/]],
  },
  boxing: {
    sport: "#Boxing",
    stars: ["Canelo Alvarez|Canelo|Canelo Álvarez", "Terence Crawford|Crawford", "Oleksandr Usyk|Usyk", "Tyson Fury", "Anthony Joshua", "Naoya Inoue|Inoue", "Gervonta Davis", "Jake Paul", "Devin Haney", "Dmitry Bivol|Bivol", "Shakur Stevenson"],
  },
  tennis: {
    sport: "#Tennis",
    stars: ["Jannik Sinner|Sinner", "Carlos Alcaraz|Alcaraz", "Novak Djokovic|Djokovic", "Coco Gauff|Gauff", "Aryna Sabalenka|Sabalenka", "Iga Swiatek|Świątek|Swiatek", "Alexander Zverev|Zverev", "Taylor Fritz", "Elena Rybakina|Rybakina", "Jessica Pegula|Pegula", "Daniil Medvedev|Medvedev", "Madison Keys"],
    events: [["#ATPTour", /\bATP\b/], ["#WTA", /\bWTA\b/], ["#Wimbledon", /\bWimbledon\b/], ["#USOpen", /\bUS Open\b|\bU\.S\. Open\b/], ["#AusOpen", /\bAustralian Open\b/], ["#RolandGarros", /\bRoland Garros\b|\bFrench Open\b/], ["#DavisCup", /\bDavis Cup\b/]],
  },
  golf: {
    sport: "#Golf",
    stars: ["Scottie Scheffler|Scheffler", "Rory McIlroy|McIlroy", "Tiger Woods", "Xander Schauffele|Schauffele", "Jon Rahm|Rahm", "Bryson DeChambeau|DeChambeau", "Collin Morikawa|Morikawa", "Nelly Korda|Korda", "Ludvig Aberg|Åberg", "Brooks Koepka|Koepka"],
    events: [["#PGATour", /\bPGA Tour\b|\bPGA\b/], ["#LIVGolf", /\bLIV Golf\b|\bLIV\b/], ["#DPWorldTour", /\bDP World Tour\b/], ["#TheMasters", /\bMasters\b/], ["#RyderCup", /\bRyder Cup\b/], ["#LPGA", /\bLPGA\b/]],
  },
  motogp: {
    sport: "#MotoGP",
    stars: ["Marc Marquez|Marc Márquez|Márquez", "Francesco Bagnaia|Bagnaia|Pecco", "Jorge Martin|Jorge Martín", "Marco Bezzecchi|Bezzecchi", "Pedro Acosta|Acosta", "Fabio Quartararo|Quartararo"],
    teams: [["#Ducati", /\bDucati\b/], ["#Aprilia", /\bAprilia\b/], ["#KTM", /\bKTM\b/], ["#Yamaha", /\bYamaha\b/]],
  },
  cycling: {
    sport: "#Cycling",
    stars: ["Tadej Pogacar|Pogačar|Pogacar", "Jonas Vingegaard|Vingegaard", "Remco Evenepoel|Evenepoel", "Mathieu van der Poel", "Primoz Roglic|Roglič", "Wout van Aert"],
    events: [["#TourdeFrance", /\bTour de France\b/], ["#Giro", /\bGiro d'Italia\b|\bGiro\b/], ["#LaVuelta", /\bVuelta\b/], ["#UCI", /\bUCI\b/]],
  },
  padel: {
    sport: "#Padel",
    stars: ["Arturo Coello|Coello", "Agustin Tapia|Agustín Tapia|Tapia", "Ale Galan|Galán", "Juan Lebron|Lebrón", "Delfi Brea", "Paquito Navarro"],
    events: [["#PremierPadel", /\bPremier Padel\b/]],
  },
  rugby: {
    sport: "#Rugby",
    stars: ["Antoine Dupont|Dupont", "Ardie Savea|Savea", "Cheslin Kolbe|Kolbe", "Siya Kolisi|Kolisi", "Marcus Smith"],
    events: [["#SixNations", /\bSix Nations\b/], ["#RugbyChampionship", /\bRugby Championship\b/], ["#RugbyWorldCup", /\bRugby World Cup\b/], ["#BritishAndIrishLions", /\bBritish (?:and|&) Irish Lions\b|\bLions tour\b/]],
  },
  volleyball: {
    sport: "#Volleyball",
    teams: school("Nebraska", "Texas", "Wisconsin", "Penn State", "Stanford", "Louisville", "Pittsburgh", "Kentucky", "Purdue", "Creighton", "Minnesota", "San Diego", "Oregon", "Florida", "Arizona State", "Baylor"),
    events: [["#VNL", /\bVolleyball Nations League\b|\bVNL\b/], ["#AVCA", /\bAVCA\b/], ["#NCAAVolleyball", /\bNCAA\b/], ["#BigTenVolleyball", /\bBig Ten\b/]],
  },
};

const norm = (s: string) => strip(s).toLowerCase();

// Headlines usually give only the surname ("Saka", "Mahomes"), so it counts as the star's name too, unless it is a common
// surname or an everyday word ("Hurts", "Judge", "Love", "Chase"): those need the full name.
const COMMON_SURNAMES = new Set(["allen", "williams", "jackson", "davis", "brown", "smith", "johnson", "james", "thomas", "gray", "hughes", "wilson", "clark", "stewart", "walker", "young", "white", "harris", "martin", "robinson", "jones", "miller", "moore", "taylor", "anderson", "lewis", "rodriguez", "hernandez", "perez", "garcia", "martinez", "gonzalez", "fernandes", "davies", "palmer", "judge", "hurts", "love", "chase", "lamb", "brink", "plum", "boston", "daniels", "henry", "reese", "gibbs", "keys", "marner", "sky", "watt", "paul", "edwards"]);
const lastNameAlias = (full: string): string[] => {
  const last = full.trim().split(/\s+/).pop() ?? "";
  return last.length >= 4 && !COMMON_SURNAMES.has(norm(last)) ? [last] : [];
};

// Matches come back in the order the headline mentions them, so the first tag is the story's lead name.
function starTags(stars: Star[], title: string): [string, number][] {
  const t = norm(title);
  const out: [string, number][] = [];
  for (const s of stars) {
    const [full, ...explicit] = s.split("|");
    const aliases = [...explicit, ...lastNameAlias(full)];
    const idx = Math.min(...[full, ...aliases].map((n) => t.search(new RegExp(`(^|[^a-z])${norm(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`))).filter((i) => i >= 0), Infinity);
    if (idx !== Infinity) out.push([tagOf(full), idx]);
  }
  return out;
}
const inOrder = (hits: [string, number][]) => hits.sort((a, b) => a[1] - b[1]).map(([tag]) => tag);
const patternTags = (list: [string, RegExp][] | undefined, title: string): [string, number][] =>
  (list ?? []).flatMap(([tag, re]) => { const m = re.exec(title); return m ? [[tag, m.index] as [string, number]] : []; });

// The tags a headline earns in its sport: stars first (the most specific), then teams, then events. `sport` is the sport's own
// broad tag (#MLB, #UFC...), offered even when no name is found so a story never falls back to #SportsNews alone.
export function topicTags(title: string, category: string): { specifics: string[]; sport: string | null } {
  const set = SETS[category.split("/")[0]];
  if (!set) return { specifics: [], sport: null };
  const specifics = [...(set.derived?.(title) ?? []), ...(set.rivalries ?? []).filter(([, re]) => re.test(title)).map(([tag]) => tag), ...inOrder(starTags(set.stars ?? [], title)), ...inOrder(patternTags(set.teams, title)), ...inOrder(patternTags(set.events, title))];
  return { specifics: [...new Set(specifics)], sport: set.sport };
}
