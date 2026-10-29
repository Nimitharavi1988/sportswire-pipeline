// YouTube Shorts upload (YouTube Data API v3, resumable upload). A Short is just
// a vertical video of 3 minutes or less, so it's the same MP4 the Instagram and
// Facebook reels use. Off unless YOUTUBE_SHORTS_ENABLED=1 and the OAuth
// credentials are set (scripts/youtubeAuth.ts gets the refresh token once).
// Note: until the Google project passes YouTube's API audit, uploads made
// through the API are locked to private.

// Pacing, not a YouTube limit (uploads cost ~100 units and have their own quota bucket since 2026-06):
// spread the day's Shorts out so each gets its own test audience instead of five landing in one hour.
// Tunable with YOUTUBE_MAX_PER_DAY / YOUTUBE_MIN_GAP_MINUTES (GitHub repository variables).
const envNum = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
export const maxShortsPerDay = () => envNum("YOUTUBE_MAX_PER_DAY", 8);
export const minGapMinutes = () => envNum("YOUTUBE_MIN_GAP_MINUTES", 120);

// YouTube caps how many videos a channel may upload per day (a new channel's cap is low and not published:
// the English channel hit it after about 20 uploads in 24 hours, the Spanish one after about 10). Past it every
// upload fails with this message, so after one such failure that channel pauses YouTube attempts for a few hours
// (rather than rendering and failing every run), then one attempt probes.
export const UPLOAD_LIMIT_MESSAGE = "exceeded the number of videos they may upload";
export const UPLOAD_LIMIT_PAUSE_HOURS = 3;
export function uploadLimitPauseActive(lastLimitFailure: Date | null, now: Date, hours = UPLOAD_LIMIT_PAUSE_HOURS): boolean {
  return lastLimitFailure !== null && now.getTime() - lastLimitFailure.getTime() < hours * 3_600_000;
}

// Whether another Short may go out: under the rolling-24h cap and past the minimum gap since the last one.
export function youtubeSlotOpen(postedLast24h: number, lastPostedAt: Date | null, now: Date, maxPerDay: number, minGapMin: number): boolean {
  if (postedLast24h >= maxPerDay) return false;
  if (lastPostedAt && now.getTime() - lastPostedAt.getTime() < minGapMin * 60_000) return false;
  return true;
}
// A Short's title stays under 60 characters (2026-10-29, YouTube rules): it leads with the names and the comparison, and
// the rest is cut at a word. The older decorated-title test keeps its own 100-character limit (DECORATED_TITLE_MAX).
const TITLE_MAX = 60;
const DECORATED_TITLE_MAX = 100;

// Two channels share one Google Cloud project (and client ID/secret); each has its own refresh token,
// because the token decides which channel a video goes to.
export type YoutubeChannel = "en" | "es";

// Which sports get a Short once the day is nearly full (measured 2026-10-15 over a week of Shorts, median views
// per Short: English WNBA ~1000, college football ~470, baseball ~460, cricket ~310, NFL ~95; Spanish WNBA ~780,
// baseball ~430, tennis ~350, soccer ~320, NFL ~250). The channel's daily slots are limited (YouTube's own cap,
// about 10 a day), so the last YOUTUBE_PRIORITY_RESERVE slots of a rolling 24h go only to these sports and the
// rest wait for a free earlier slot. Samples are small (5-15 Shorts a sport): revisit with scripts/youtubeReport.ts.
const PRIORITY_SPORTS: Record<YoutubeChannel, string[]> = {
  en: ["wnba", "college-football", "baseball", "cricket"],
  es: ["wnba", "baseball", "tennis", "football", "american-football"],
};
// Off by default since 2026-10-15 (every Short the channel allows is sent, none held back for a better sport): 0.
// Set YOUTUBE_PRIORITY_RESERVE to a positive number to hold that many of the day's last slots for the priority sports.
// (envNum treats 0 as unset, so this reads its own variable.)
export const priorityReserve = () => {
  const n = Number(process.env.YOUTUBE_PRIORITY_RESERVE);
  return process.env.YOUTUBE_PRIORITY_RESERVE?.trim() && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};
// category is the article's category ("cricket", "american-football/nfl"...). Pure, unit-tested.
export function youtubeSportAllowed(channel: YoutubeChannel, category: string, postedLast24h: number, maxPerDay: number, reserve: number): boolean {
  if (PRIORITY_SPORTS[channel].includes(category.split("/")[0].toLowerCase())) return true;
  return postedLast24h < maxPerDay - reserve;
}

const refreshTokenFor = (channel: YoutubeChannel) => (channel === "es" ? process.env.YOUTUBE_REFRESH_TOKEN_ES : process.env.YOUTUBE_REFRESH_TOKEN);

export function youtubeConfigured(channel: YoutubeChannel = "en"): boolean {
  return process.env.YOUTUBE_SHORTS_ENABLED === "1"
    && Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && refreshTokenFor(channel));
}

// Title <= 60 chars, trimmed on a word boundary with an ellipsis. No "#Shorts" in it: a hashtag in the
// title replaces the description's hashtags above the video, and #Shorts goes in the description.
export function shortsTitle(headline: string): string {
  const clean = headline.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" ") > TITLE_MAX / 2 ? cut.lastIndexOf(" ") : cut.length);
  return atWord.replace(/[\s,.:;–—-]+$/, "") + "…";
}

// A hook the model wrote in capitals ("ARMY QB RALLIES 38-RUSHES, 223 YARDS...") reads as shouting in a
// title. Put it in sentence case, keeping names and abbreviations: a word keeps the capitals it has in
// the article's headline, a known abbreviation stays upper-case, anything else goes lower-case.
const ACRONYMS = new Set(["NFL", "NBA", "WNBA", "MLB", "NHL", "UFC", "MMA", "QB", "WR", "RB", "TE", "IPL", "ODI", "T20", "T20I", "USA", "US", "UK", "UEFA", "FIFA", "AFC", "NFC", "ESPN", "NCAA", "CFB", "PSG", "FC", "LA", "NY", "DC", "AI", "F1", "MVP", "GOAT", "TV", "UAE", "RCB", "CSK", "MI", "KKR", "BCCI", "ICC", "VAR", "PGA", "LIV", "ACC", "SEC"]);

// Unicode-aware: Spanish letters (Ñ, Ó, É...) count as letters and keep their words whole.
function isShouting(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 8) return false;
  return letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.6;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\u2019']*/gu;

// In Spanish these abbreviations are ordinary words (la, mi, te), so they are not kept upper-case there.
const SPANISH_WORDS = new Set(["LA", "MI", "TE"]);

export function fixShoutedTitle(hook: string, headline: string, language: "en" | "es" = "en"): string {
  if (!isShouting(hook)) return hook;
  const known = new Map<string, string>();
  if (!isShouting(headline)) {
    for (const w of headline.match(WORD) ?? []) if (/\p{Lu}/u.test(w)) known.set(w.toLowerCase(), w);
  }
  const fixed = hook.replace(WORD, (w) => known.get(w.toLowerCase()) ?? (ACRONYMS.has(w.toUpperCase()) && !(language === "es" && SPANISH_WORDS.has(w.toUpperCase())) ? w.toUpperCase() : w.toLowerCase()));
  return fixed.replace(/^([^\p{L}]*)(\p{Ll})/u, (_m, pre: string, c: string) => pre + c.toUpperCase());
}

// Sport phrases people search for, by category (the first part of the article's category).
const SPORT_TAGS: Record<"en" | "es", [string, string[]][]> = {
  en: [
    ["american-football", ["NFL", "NFL news", "NFL highlights", "American football"]],
    ["college-football", ["college football", "college football news", "college football highlights", "CFB", "NCAA football"]],
    ["cricket", ["cricket", "cricket news", "cricket highlights", "T20 cricket"]],
    ["football", ["soccer", "football news", "football highlights", "soccer news"]],
    ["wnba", ["WNBA", "WNBA news", "women's basketball"]],
    ["basketball", ["basketball", "NBA", "NBA news", "basketball highlights"]],
    ["baseball", ["MLB", "baseball", "MLB news", "baseball highlights"]],
    ["hockey", ["NHL", "hockey", "hockey highlights"]],
    ["mma", ["UFC", "MMA", "UFC news", "MMA highlights"]],
    ["boxing", ["boxing", "boxing news", "boxing highlights"]],
    ["formula-1", ["Formula 1", "F1", "F1 news"]],
    ["tennis", ["tennis", "tennis news", "tennis highlights"]],
    ["golf", ["golf", "golf news", "PGA Tour"]],
    ["volleyball", ["volleyball", "volleyball highlights"]],
    ["rugby", ["rugby", "rugby news", "rugby highlights"]],
  ],
  es: [
    ["american-football", ["NFL", "fútbol americano", "resumen NFL"]],
    ["college-football", ["fútbol americano universitario", "NCAA", "college football"]],
    ["cricket", ["críquet", "cricket"]],
    ["football", ["fútbol", "noticias de fútbol", "resumen de fútbol"]],
    ["wnba", ["WNBA", "baloncesto femenino"]],
    ["basketball", ["baloncesto", "NBA", "resumen NBA"]],
    ["baseball", ["béisbol", "MLB", "resumen MLB"]],
    ["hockey", ["NHL", "hockey"]],
    ["mma", ["UFC", "MMA", "resumen UFC"]],
    ["boxing", ["boxeo", "noticias de boxeo"]],
    ["formula-1", ["Fórmula 1", "F1"]],
  ],
};

// The sport a category belongs to. "football/college-football" and "basketball/wnba" must not fall into soccer or the NBA.
function sportKey(category: string | null | undefined): string {
  const c = category ?? "";
  if (c.includes("wnba")) return "wnba";
  if (c.includes("college-football")) return "college-football";
  if (c.includes("nfl") || c.startsWith("american-football")) return "american-football";
  return c.split("/")[0];
}

// The broad sport hashtag the trending Shorts carry (#nfl, #cricket, #football, #futbol on 2026-10-29's charts).
const SPORT_HASHTAG: Record<"en" | "es", Record<string, string>> = {
  en: { "american-football": "#NFL", "college-football": "#CollegeFootball", cricket: "#Cricket", football: "#Football", wnba: "#WNBA", basketball: "#NBA", baseball: "#MLB", hockey: "#NHL", mma: "#UFC", boxing: "#Boxing", "formula-1": "#F1", tennis: "#Tennis", golf: "#Golf", volleyball: "#Volleyball", rugby: "#Rugby" },
  es: { "american-football": "#NFL", "college-football": "#FutbolAmericano", cricket: "#Criquet", football: "#Futbol", wnba: "#WNBA", basketball: "#NBA", baseball: "#Beisbol", hockey: "#NHL", mma: "#UFC", boxing: "#Boxeo", "formula-1": "#F1", tennis: "#Tenis", golf: "#Golf" },
};

// Live events that viewers search and the trending charts carry: a hashtag and the tags for it. Matched on the title.
const EVENTS: { re: RegExp; tag: string; tags: string[] }[] = [
  { re: /india.{0,40}new zealand|new zealand.{0,40}india|\bind vs nz\b|\bindvnz\b/i, tag: "#INDvNZ", tags: ["India vs New Zealand", "ind vs nz", "Team India"] },
  { re: /ballon d.?or|bal[oó]n de oro/i, tag: "#BallonDor", tags: ["Ballon d'Or 2026", "Balón de Oro 2026"] },
  { re: /world series/i, tag: "#WorldSeries", tags: ["World Series 2026", "MLB World Series"] },
  { re: /wnba finals/i, tag: "#WNBAFinals", tags: ["WNBA Finals 2026", "WNBA Finals"] },
  { re: /super bowl/i, tag: "#SuperBowl", tags: ["Super Bowl"] },
  { re: /nba finals/i, tag: "#NBAFinals", tags: ["NBA Finals"] },
  { re: /champions league|liga de campeones/i, tag: "#ChampionsLeague", tags: ["Champions League", "UEFA Champions League"] },
  { re: /cl[aá]sico/i, tag: "#ElClasico", tags: ["El Clásico", "Real Madrid vs Barcelona"] },
  { re: /premier league/i, tag: "#PremierLeague", tags: ["Premier League"] },
  { re: /\bipl\b/i, tag: "#IPL", tags: ["IPL"] },
  { re: /t20 world cup/i, tag: "#T20WorldCup", tags: ["T20 World Cup"] },
  { re: /world cup|mundial/i, tag: "#WorldCup", tags: ["World Cup"] },
];
export const eventFor = (title: string | null | undefined) => EVENTS.find((e) => e.re.test(title ?? ""));

// Other spellings of the same name or team that viewers type.
const ALIASES: Record<string, string> = {
  "stephen curry": "Steph Curry", "steph curry": "Stephen Curry", "76ers": "Sixers", sixers: "76ers", "manchester city": "Man City", "man city": "Manchester City",
  "manchester united": "Man United", "man united": "Manchester United", "patrick mahomes": "Pat Mahomes", "giannis antetokounmpo": "Giannis", "caitlin clark": "Caitlin Clark Fever",
  "real madrid": "Madrid", "barcelona": "Barça", "atlético de madrid": "Atletico Madrid", "bayern munich": "Bayern", "tottenham hotspur": "Spurs", "spurs": "Tottenham",
};

// The two hashtags shown above the video (the third is #Shorts): the event or the story's own specific one first, then the broad sport
// tag, never the brand tags (#SportsWireLive, #SportsNews) unless nothing else exists. Trending Shorts carry #nfl, #cricket, #futbol.
const GENERIC_HASHTAG = /^#(sportswirelive|sportsnews|noticiasdeportivas|deportes|shorts|sports|news|noticias)$/i;
export function descriptionHashtags(hashtags: string[], category: string | null | undefined, title: string | null | undefined, language: "en" | "es" = "en"): string[] {
  const all = Array.from(new Set(hashtags.map((h) => (h.startsWith("#") ? h : "#" + h)).filter((h) => h.toLowerCase() !== "#shorts")));
  const broadSet = new Set(Object.values(SPORT_HASHTAG[language]).map((h) => h.toLowerCase()));
  const specific = all.filter((h) => !GENERIC_HASHTAG.test(h) && !broadSet.has(h.toLowerCase()));
  const broadOwn = all.filter((h) => broadSet.has(h.toLowerCase()));
  const broad = SPORT_HASHTAG[language][sportKey(category)];
  const ordered = [eventFor(title)?.tag, specific[0], broad, ...specific.slice(1), ...broadOwn, ...all.filter((h) => GENERIC_HASHTAG.test(h))].filter((h): h is string => Boolean(h));
  const out: string[] = [];
  for (const h of ordered) if (!out.some((o) => o.toLowerCase() === h.toLowerCase())) out.push(h);
  return out.slice(0, 2);
}

const BRAND_TAGS = new Set(["sportswirelive", "sportsnews", "noticiasdeportivas", "shorts"]);

// Tags for a Short: the story's own names first (people and teams from the hashtags, the teams and series
// the article carries), then the sport phrases people search, then general ones. At most 15 and about
// 400 characters (YouTube's limit is 500 in all), no duplicates.
// Full names in a headline ("Vincent Kompany", "Caitlin Clark"): two or three capitalised words in a row, the first not an
// ordinary sentence starter. People are what viewers search for, and the top Shorts carried the person as a tag.
export function namesInTitle(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/(?:^|[\s(])(\p{Lu}[\p{L}’'.-]+(?: \p{Lu}[\p{L}’'.-]+){1,2})/gu)) {
    const name = m[1].replace(/['’]s$/, "").replace(/[.,]$/, "");
    const words = name.split(" ");
    if (STARTERS.has(words[0].toLowerCase()) || words.some((w) => w === w.toUpperCase() && w.length > 1)) continue;
    if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 2);
}

export function shortsTags(input: { category?: string | null; names?: (string | null | undefined)[]; hashtags?: string[]; language?: "en" | "es"; title?: string | null }): string[] {
  const lang = input.language ?? "en";
  const out: string[] = [];
  const add = (t: string | null | undefined) => {
    const v = (t ?? "").replace(/\s+/g, " ").trim();
    const key = (x: string) => x.toLowerCase().replace(/\s+/g, "");
    if (v.length >= 2 && v.length <= 40 && !out.some((o) => key(o) === key(v))) out.push(v);
  };
  // People first, from the title as written ("LeBron James"): a hashtag split at every capital would give "Le Bron James".
  for (const n of namesInTitle(input.title ?? "")) add(n);
  for (const h of input.hashtags ?? []) {
    const bare = h.replace(/^#/, "");
    if (BRAND_TAGS.has(bare.toLowerCase())) continue;
    add(bare.replace(/([a-z\u00e0-\u00ff])([A-Z])/g, "$1 $2"));
  }
  for (const n of input.names ?? []) add(n);
  for (const t of eventFor(input.title)?.tags ?? []) add(t);
  for (const n of [...namesInTitle(input.title ?? ""), ...(input.names ?? [])]) { const alias = n ? ALIASES[n.toLowerCase()] : undefined; if (alias) add(alias); }
  // The same name without accents (Mbappé / Mbappe): viewers type both.
  for (const t of [...out]) { const plain = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); if (plain !== t && out.length < 15) add(plain); }
  const cat = input.category ?? "";
  const sportTags = SPORT_TAGS[lang].find(([c]) => c === sportKey(cat))?.[1] ?? [];
  for (const t of sportTags) add(t);
  // Shorts with fewer than 7 tags got about half the views of those with 7 to 9 (2026-10-29): top up from the sport's main phrase.
  if (sportTags[0] && out.length < 6) { add(lang === "es" ? sportTags[0] + " hoy" : sportTags[0] + " today"); add(lang === "es" ? sportTags[0] + " última hora" : sportTags[0] + " latest"); }
  if (lang === "es") { add("noticias deportivas"); add("deportes"); add("Shorts"); }
  else { add("sports news"); add("sports shorts"); add("Shorts"); }
  const kept: string[] = [];
  let chars = 0;
  for (const t of out) {
    if (kept.length >= 15 || chars + t.length + 2 > 400) break;
    kept.push(t);
    chars += t.length + 2;
  }
  return kept;
}


// The reel's hook (written from the article under strict no-invented-facts rules) makes a better
// Shorts title than the news headline; the headline is the fallback.
// A hook is only a good title when it says who or what: "18-Year-old signed through 2030" says neither.
// It needs at least one capitalised word that is not an ordinary sentence starter (a person, team, place or
// abbreviation: "Bills edge Rams", "Caitlin Clark's 1s hit the NBA floor", "Georgia takes number one").
const STARTERS = new Set([
  "the", "a", "an", "in", "on", "at", "after", "before", "why", "how", "what", "when", "where", "who", "can", "will", "is", "are", "did", "do", "does",
  "this", "that", "these", "those", "it", "he", "she", "they", "we", "you", "our", "his", "her", "their", "all", "one", "two", "three", "first", "new", "no", "not",
  "el", "la", "los", "las", "un", "una", "por", "para", "en", "con", "sin", "qué", "cómo", "cuándo", "quién", "es", "son", "este", "esta", "ya", "su", "sus", "al", "del", "de", "y", "se",
]);
// A capitalised word at the start of a later sentence ("80-69. Séptimo juego confirmado.") is only a name when the next word is
// capitalised too ("Caleb Williams") or the story headline names it: otherwise it is just the first word of a sentence.
export function hookNamesSomeone(hook: string, headline = ""): boolean {
  const word = (token: string) => token.match(/^[^\p{L}\p{N}]*([\p{L}\p{N}][\p{L}\p{N}’'-]*)/u)?.[1];
  const isName = (w: string | undefined) => Boolean(w) && /^\p{Lu}/u.test(w!) && !STARTERS.has(w!.toLowerCase());
  const inHeadline = new Set(headline.split(/\s+/).map(word).filter((w) => isName(w)).map((w) => w!.toLowerCase()));
  const tokens = hook.split(/\s+/);
  // Whole space-separated words, so "18-Year-old" (a number first) is not mistaken for a name.
  return tokens.some((token, i) => {
    const w = word(token);
    if (!isName(w)) return false;
    const firstSentence = !tokens.slice(0, i).some((t) => /[.!?]["”)]*$/.test(t));
    return firstSentence || isName(word(tokens[i + 1] ?? "")) || inHeadline.has(w!.toLowerCase());
  });
}


// Title test (2026-10-15): of the 50 most-viewed sports Shorts of the week, 54% carried hashtags in the title and 36%
// an emoji. Half of our Shorts (by story id, so it can be recomputed later and is independent of the caption test)
// get the sport emoji and up to two of the story's own hashtags after the title; the rest keep the plain title.
export type TitleVariant = "decorated" | "plain";
export function titleVariantFor(articleId: string): TitleVariant {
  let h = 7;
  for (const c of articleId) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "decorated" : "plain";
}
// Sport emoji first, then the title, then up to two hashtags, all within the 100-character limit. The story's own
// hashtags come before the generic ones (#Deportes, #SportsWireLive...). If the whole title does not fit with the extras
// it takes fewer hashtags, then none (emoji only), and a title too long even for the emoji stays plain: an ellipsis in the middle of a
// word before the hashtags looked worse than no extras. A title that already has an emoji, or a #tag, gets no second one.
const GENERIC_TAG = /^#(sportswirelive|deportes|deporte|sports|sportsnews|noticias|news|viral|trending)$/i;
export function decorateShortsTitle(title: string, emoji: string | null | undefined, hashtags: string[], max = DECORATED_TITLE_MAX): string {
  const all = Array.from(new Set(hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).filter((h) => h.length > 2 && h.toLowerCase() !== "#shorts")));
  const tags = [...all.filter((h) => !GENERIC_TAG.test(h)), ...all.filter((h) => GENERIC_TAG.test(h))].slice(0, 2);
  const lead = emoji && !/\p{Extended_Pictographic}/u.test(title) ? `${emoji} ` : "";
  const canTag = !title.includes("#");
  for (let n = canTag ? tags.length : 0; n >= 0; n--) {
    const tail = n ? " " + tags.slice(0, n).join(" ") : "";
    const out = lead + title + tail;
    if (out.length <= max) return out;
  }
  return title;
}

export function shortsTitleFor(hook: string | null | undefined, headline: string, language: "en" | "es" = "en"): string {
  const h = fixShoutedTitle((hook ?? "").replace(/\s+/g, " ").trim(), headline, language);
  // A hook that names nobody (or is tiny) is replaced by the headline, which always does.
  return shortsTitle(h.length >= 12 && hookNamesSomeone(h, headline) ? h : headline);
}

// YouTube rules (2026-10-29): no link in the description (YouTube holds back Shorts that link off the platform), and at most
// three hashtags, the story's two most specific plus #Shorts. A photo credit stays (the licence needs it): it has no link in it.
export function shortsDescription(summary: string, hashtags: string[], language: "en" | "es" = "en", photoCredit?: string | null, story?: { category?: string | null; title?: string | null }): string {
  const own = story ? descriptionHashtags(hashtags, story.category, story.title, language) : Array.from(new Set(hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).filter((h) => h.toLowerCase() !== "#shorts"))).slice(0, 2);
  const tags = [...own, "#Shorts"];
  const ask = language === "es" ? "¿Qué opinas? Cuéntanos en los comentarios." : "What's your take? Tell us in the comments.";
  const follow = language === "es" ? "Suscríbete a Sports Wire Live en Español para noticias deportivas diarias." : "Follow The Sports Live Wire for daily sports news.";
  const credit = photoCredit && !/https?:\/\//i.test(photoCredit) ? `📷 ${photoCredit}\n\n` : "";
  return `${summary.trim()}\n\n${ask}\n\n${credit}${follow}\n\n${tags.join(" ")}`;
}

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`YouTube token refresh failed: ${data.error_description ?? data.error ?? res.status}`);
  return data.access_token as string;
}

// Uploads the MP4 as a public Short. Returns the YouTube video id.
export async function uploadShort(mp4: Buffer, title: string, description: string, tags: string[], privacy: "public" | "unlisted" | "private" = "public", language = "en", channel: YoutubeChannel = "en"): Promise<string> {
  const refresh = refreshTokenFor(channel);
  if (!refresh) throw new Error(`No YouTube refresh token for the ${channel} channel`);
  const token = await accessToken(refresh);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(mp4.length),
    },
    body: JSON.stringify({
      snippet: { title, description, tags: tags.slice(0, 15), categoryId: "17", defaultLanguage: language }, // 17 = Sports
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, embeddable: true },
    }),
  });
  if (!init.ok) throw new Error(`YouTube upload start failed (${init.status}): ${(await init.text()).slice(0, 300)}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube returned no upload URL");

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(mp4.length) },
    body: new Uint8Array(mp4),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(`YouTube upload failed (${res.status}): ${data?.error?.message ?? ""}`);
  return data.id as string;
}
