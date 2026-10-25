import { TRACKED_PLAYERS } from "../players";
import { TRACKED_CLUBS } from "../clubs";

// Shared by reel tags (reelTags.ts) and caption hashtags (hashtagRepertoire.ts):
// finds the tracked players and clubs a headline is about.

// slug -> Instagram handle, checked 2026-09-28 by web search: top result for
// the name, matching display name/bio, plausible follower count, own content.
// Not API-verified (Business Discovery isn't enabled for our Meta app). Add a
// handle only after the same check; scripts/exportSportsLists.ts lists who
// is still missing one.
export const ENTITY_HANDLES: Record<string, string> = {
  // Teams
  "manchester-united": "manchesterunited",
  "manchester-city": "mancity",
  arsenal: "arsenal",
  chelsea: "chelseafc",
  liverpool: "liverpoolfc",
  "bayern-munich": "fcbayern",
  "real-madrid": "realmadrid",
  barcelona: "fcbarcelona",
  "lsu-tigers": "lsufootball",
  "ohio-state": "ohiostatefb",
  "west-ham-united": "westham",
  everton: "everton",
  sunderland: "sunderlandafc",
  "penn-state": "pennstatefball",
  "notre-dame": "ndfootball",
  "miami-dolphins": "miamidolphins",
  "chicago-bears": "chicagobears",
  "detroit-lions": "detroitlionsnfl",
  "new-york-jets": "nyjets",
  "buffalo-bills": "buffalobills",
  // Players
  "josh-allen": "joshallenqb",
  "vaibhav-sooryavanshi": "vaibhav_sooryavanshi09",
  "virat-kohli": "virat.kohli",
  "patrick-mahomes": "patrickmahomes",
  haaland: "erling",
  "harry-kane": "harrykane",
  "sanju-samson": "imsanjusamson",
  "joe-burrow": "joeyb_9",
  "rohit-sharma": "rohitsharma45",
  mbappe: "k.mbappe",
  "lamar-jackson": "new_era8",
  "travis-kelce": "killatrav",
  "lebron-james": "kingjames",
  "caitlin-clark": "caitlinclark22",
  "jaxson-dart": "jaxsondart",
  "aaron-rodgers": "aaronrodgers12",
  "caleb-williams": "ayeeecaleb",
  "jalen-hurts": "jalenhurts",
  "shreyas-iyer": "shreyasiyer96",
  messi: "leomessi",
  ronaldo: "cristiano",
  "sachin-tendulkar": "sachintendulkar",
  "phil-foden": "philfoden",
  "aaron-judge": "thejudge44",
  "joey-porter-jr": "joeyporterjr",
  "justin-jefferson": "jjettas2",
  "luka-doncic": "lukadoncic",
  "tom-brady": "tombrady",
  neymar: "neymarjr",
  "gautam-gambhir": "gautamgambhir55",
  "babar-azam": "babarazam",
  "justin-herbert": "justinherbert",
  "jasprit-bumrah": "jaspritb1",
  "angel-reese": "angel.reese",
  "kyler-murray": "k1",
  "abhishek-sharma": "abhisheksharma_4", // confirmed by the site owner 2026-09-29
};

export interface MatchedEntity {
  slug: string;
  name: string;
  handle: string | null;
}

interface Entity {
  slug: string;
  name: string;
  sport: string;
  terms: string[];
}

const ENTITIES: Entity[] = [
  ...TRACKED_PLAYERS.map((p) => ({ slug: p.slug, name: p.name, sport: p.sport, terms: [p.name, ...p.searchTerms] })),
  ...TRACKED_CLUBS.map((c) => ({ slug: c.slug, name: c.name, sport: c.sport ?? "football", terms: [c.name, ...c.searchTerms] })),
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A short bare surname ("Kane", which is also Kane Williamson) is fine for a
// hashtag but too risky to @-tag: only full names, terms of 5+ letters
// ("Kohli", "Mbapp") and acronyms ("LSU") are precise enough to point at one
// account. Only entities with a hand-checked handle can be tagged at all, so
// when adding one, check its bare surname isn't shared with someone else in
// the same sport.
const isPreciseTerm = (t: string) => t.includes(" ") || t.length >= 5 || /^[A-Z]{3,}$/.test(t);

// Matches at a word start only, so "Kane" doesn't match inside "Kaneria".
const patterns = new Map<Entity, { loose: RegExp; precise: RegExp | null }>(
  ENTITIES.map((e) => {
    const build = (terms: string[]) => (terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRe).join("|")})`, "iu") : null);
    return [e, { loose: build(e.terms)!, precise: build(e.terms.filter(isPreciseTerm)) }];
  })
);

// Tracked players/clubs named in the headline, earliest mention first (the
// story's lead subject). An entity only counts when its sport matches the
// article's top-level category, which is what keeps a cricketer named Kane
// out of Harry Kane's tags.
export function entitiesInTitle(title: string, category: string, opts: { precise: boolean }): MatchedEntity[] {
  const sport = category.split("/")[0];
  const found: { entity: Entity; at: number }[] = [];
  for (const e of ENTITIES) {
    if (e.sport !== sport) continue;
    const re = opts.precise ? patterns.get(e)!.precise : patterns.get(e)!.loose;
    const at = re ? title.search(re) : -1;
    if (at >= 0) found.push({ entity: e, at });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ entity }) => ({ slug: entity.slug, name: entity.name, handle: ENTITY_HANDLES[entity.slug] ?? null }));
}
