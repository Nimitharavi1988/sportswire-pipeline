// Cricket hashtags for the cricket Pages and their Instagram accounts (2026-10-31). Before this, the India cricket Pages put
// #TeamIndia on every story, including Afghanistan v Oman and Scotland v Sri Lanka, and named no team, franchise or
// tournament (#MumbaiIndians, #HongKongSixes). Each tag is added only when the headline shows it; nothing is padded.
// Pure and unit-tested. Used by selectIndiaCricketHashtags (Facebook, 3 tags) and the topic Instagram accounts (topicHashtags.ts).
import { TRACKED_PLAYERS } from "../players";

const tagOf = (name: string) => "#" + name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");

interface Nation {
  code: string;
  tag: string;
  // Full names match in any case; abbreviations only in capitals ("BAN" the team, not "ban" the punishment).
  name: RegExp;
  abbr: RegExp | null;
}

// India's senior men's side only: India A, Under-19 and the women's team are different teams.
const NATIONS: Nation[] = [
  { code: "IND", tag: "#TeamIndia", name: /\bindia\b(?!\s+(a|u19|under-19s?|women)\b)/i, abbr: /\bIND\b/ },
  { code: "PAK", tag: "#PakistanCricket", name: /\bpakistan\b/i, abbr: /\bPAK\b/ },
  { code: "AUS", tag: "#CricketAustralia", name: /\baustralia\b/i, abbr: /\bAUS\b/ },
  { code: "ENG", tag: "#EnglandCricket", name: /\bengland\b/i, abbr: /\bENG\b/ },
  { code: "SA", tag: "#Proteas", name: /\bsouth africa\b/i, abbr: /\bSA\b/ },
  { code: "NZ", tag: "#Blackcaps", name: /\bnew zealand\b/i, abbr: /\bNZ\b/ },
  { code: "WI", tag: "#WindiesCricket", name: /\b(west indies|windies)\b/i, abbr: /\bWI\b/ },
  { code: "SL", tag: "#SriLankaCricket", name: /\bsri lanka\b/i, abbr: /\bSL\b/ },
  { code: "BAN", tag: "#BangladeshCricket", name: /\bbangladesh\b/i, abbr: /\bBAN\b/ },
  { code: "AFG", tag: "#AfghanistanCricket", name: /\bafghanistan\b/i, abbr: /\bAFG\b/ },
  { code: "ZIM", tag: "#ZimbabweCricket", name: /\bzimbabwe\b/i, abbr: /\bZIM\b/ },
  { code: "IRE", tag: "#IrelandCricket", name: /\bireland\b/i, abbr: /\bIRE\b/ },
  { code: "SCO", tag: "#ScotlandCricket", name: /\bscotland\b/i, abbr: null },
];

// The nations a headline names, in the order it names them.
export function cricketNations(title: string): Nation[] {
  const hits: { n: Nation; at: number }[] = [];
  for (const n of NATIONS) {
    const at = [title.search(n.name), n.abbr ? title.search(n.abbr) : -1].filter((i) => i >= 0);
    if (at.length) hits.push({ n, at: Math.min(...at) });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.n);
}

// "#INDvWI" (India first, the way fans write it) or "#PAKvSL" (headline order) when the headline names exactly two nations.
export function cricketMatchupTag(title: string): string | null {
  // Fans' own spelling, glued: "INDvNZ", "AUSvsIND".
  const glued = /\b([A-Z]{2,3})v(?:s)?([A-Z]{2,3})\b/.exec(title);
  if (glued && NATIONS.some((n) => n.code === glued[1]) && NATIONS.some((n) => n.code === glued[2])) return `#${glued[1]}v${glued[2]}`;
  const nations = cricketNations(title);
  if (nations.length !== 2) return null;
  const [a, b] = nations[0].code === "IND" || nations[1].code !== "IND" ? nations : [nations[1], nations[0]];
  return `#${a.code}v${b.code}`;
}

// IPL franchises, leagues and tournaments. A franchise also earns #IPL.
const FRANCHISES: [string, RegExp][] = [
  ["#MumbaiIndians", /\bMumbai Indians\b|\bMI\b/],
  ["#CSK", /\bChennai Super Kings\b|\bCSK\b/],
  ["#RCB", /\bRoyal Challengers\b|\bRCB\b/],
  ["#KKR", /\bKolkata Knight Riders\b|\bKKR\b/],
  ["#SRH", /\bSunrisers Hyderabad\b|\bSRH\b/],
  ["#DelhiCapitals", /\bDelhi Capitals\b/],
  ["#PunjabKings", /\bPunjab Kings\b/],
  ["#RajasthanRoyals", /\bRajasthan Royals\b/],
  ["#LSG", /\bLucknow Super Giants\b|\bLSG\b/],
  ["#GujaratTitans", /\bGujarat Titans\b/],
];
const EVENTS: [string, RegExp][] = [
  ["#IPL", /\bIPL\b|\bIndian Premier League\b/],
  ["#WPL", /\bWPL\b|\bWomen'?s Premier League\b/],
  ["#T20WorldCup", /\bT20 World Cup\b/i],
  ["#ChampionsTrophy", /\bChampions Trophy\b/],
  ["#AsiaCup", /\bAsia Cup\b/],
  ["#Ashes", /\bAshes\b/],
  ["#BorderGavaskarTrophy", /\bBorder[- ]Gavaskar\b/],
  ["#HongKongSixes", /\bHong Kong (International )?(Cricket )?Sixes\b/i],
  ["#BBL", /\bBig Bash\b|\bBBL\b/],
  ["#PSL", /\bPakistan Super League\b|\bPSL\b/],
  ["#SA20", /\bSA20\b/],
  ["#TheHundred", /\bThe Hundred\b/],
  ["#CPL", /\bCaribbean Premier League\b|\bCPL\b/],
  ["#RanjiTrophy", /\bRanji\b/],
  ["#CricketWorldCup", /\b(ODI|Cricket|Women'?s) World Cup\b/],
];

// Franchise tags, then #IPL when one is named, then the other events, each in headline order.
export function cricketEventTags(title: string): string[] {
  const tags: string[] = [];
  for (const [tag, re] of FRANCHISES) if (re.test(title)) tags.push(tag);
  if (tags.length && !tags.includes("#IPL")) tags.push("#IPL");
  for (const [tag, re] of EVENTS) if (re.test(title) && !tags.includes(tag)) tags.push(tag);
  return tags;
}

// Indian cricketers on the tracked list: a story about one is an India story even when the headline never says "India".
// The women's team gets its own tag (#WomenInBlue), not #TeamIndia.
const INDIAN_MEN = new Set([
  "virat-kohli", "rohit-sharma", "sanju-samson", "jasprit-bumrah", "rishabh-pant", "shubman-gill", "kl-rahul", "abhishek-sharma",
  "hardik-pandya", "suryakumar-yadav", "ishan-kishan", "vaibhav-sooryavanshi", "ajinkya-rahane", "shreyas-iyer", "yashasvi-jaiswal",
  "sachin-tendulkar", "ms-dhoni", "sunil-gavaskar", "kapil-dev", "ravindra-jadeja", "kuldeep-yadav", "mohammed-siraj", "ruturaj-gaikwad",
  "nitish-kumar-reddy", "prasidh-krishna", "arshdeep-singh", "axar-patel", "tilak-varma", "shivam-dube", "washington-sundar", "naman-dhir",
  "dhruv-jurel", "zaheer-khan", "irfan-pathan", "mohammad-kaif", "gautam-gambhir", "ajit-agarkar",
]);
const INDIAN_WOMEN = new Set(["smriti-mandhana", "harmanpreet-kaur", "shafali-verma", "jemimah-rodrigues"]);

// The tracked cricketer the headline names first (earliest mention).
export function cricketPlayer(title: string): { slug: string; name: string } | null {
  const lower = title.toLowerCase();
  let best: { slug: string; name: string; at: number } | null = null;
  for (const p of TRACKED_PLAYERS) {
    if (p.sport !== "cricket") continue;
    for (const t of p.searchTerms) {
      const at = lower.indexOf(t.toLowerCase());
      if (at >= 0 && (!best || at < best.at)) best = { slug: p.slug, name: p.name, at };
    }
  }
  return best ? { slug: best.slug, name: best.name } : null;
}

// The tags a cricket headline earns, most specific first: the matchup, the franchise or tournament, the player, then the teams.
// #TeamIndia only when the story is about India (named, an Indian player, or the BCCI); other teams get their own tag.
export function cricketSpecifics(title: string): string[] {
  const tags: string[] = [];
  const matchup = cricketMatchupTag(title);
  if (matchup) tags.push(matchup);
  tags.push(...cricketEventTags(title));
  const player = cricketPlayer(title);
  if (player) tags.push(tagOf(player.name));
  const nations = cricketNations(title);
  const indiaStory = nations.some((n) => n.code === "IND") || INDIAN_WOMEN.has(player?.slug ?? "") || /\bBCCI\b/.test(title) || Boolean(player && INDIAN_MEN.has(player.slug));
  if (/\bBCCI\b/.test(title)) tags.push("#BCCI");
  // #TeamIndia is the men's side: an India story about the women's team gets #WomenInBlue instead.
  const womens = /\bwomen/i.test(title) || Boolean(player && INDIAN_WOMEN.has(player.slug));
  if (indiaStory && womens) tags.push("#WomenInBlue");
  else if (indiaStory) tags.push("#TeamIndia");
  // With a matchup the opponent adds nothing the matchup tag has not said; without one, name the teams.
  if (!matchup) for (const n of nations) if (n.code !== "IND") tags.push(n.tag);
  return [...new Set(tags)];
}
