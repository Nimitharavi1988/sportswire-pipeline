/**
 * Facebook Pages the site posts to. "main" is the Sports Wire Live Page
 * (all sports; its selection and pacing live in autoApprove.ts). Other
 * destinations are topic Pages: each has its own topic rule, daily limit,
 * posting hours and token, and its own posting history
 * (SocialPost.destination) — so one Page's posts never count against, or
 * block a story for, another. Added 2026-09-26 for an India cricket Page.
 *
 * Tokens come from GitHub Actions secrets (never stored here); Page ids
 * are public. A destination whose token isn't set is simply skipped.
 */
import { selectFightHashtags, selectIndiaCricketHashtags, selectSpanishHashtags, selectTopicFacebookHashtags } from "./hashtagRepertoire";
import { LOCALES } from "../i18n/locales";
import { STAR_TERMS } from "./freshness";

export interface FacebookDestination {
  key: string;
  label: string;
  pageId: string;
  // Name of the env var / GitHub secret holding the Page (or System User)
  // token — exchanged for a Page token before posting (resolvePageAccessToken).
  tokenEnv: string;
  dailyCap: number;
  // Most posts in one ingestion run (runs are every ~15 min).
  perRunCap: number;
  // Posts are spread over these local hours (the Page's audience's day).
  activeHours: { timeZone: string; start: number; end: number };
  // The sport this Page covers (category prefix) — candidates are chosen
  // within it, so busier sports can't crowd its stories out.
  sport: string;
  // Several sports at once (category prefixes), for a Page that covers more than
  // one: used instead of `sport` when set.
  categories?: string[];
  // A language edition's Page: only stories with a live translation are posted,
  // with the translated text and the edition's own article address (see
  // postArticleToFacebook).
  locale?: string;
  // Also draw candidates from other categories whose title contains one of
  // these phrases (case-insensitive) — e.g. Asian Games stories filed under
  // athletics.
  alsoTitleLike?: string[];
  // Oldest story (hours since it was published) this Page posts, links and reels.
  // Default: 48 hours. Without a limit, a slow stretch drops to day-old stories
  // (a quarter of Greenfield's reels used stories over 24 hours old).
  maxAgeHours?: number;
  // Key of a sibling Page (its post history key): stories already posted there are
  // skipped here, so two Pages under one owner don't carry the same stories and
  // videos (repeated content gets less reach). The sibling should run first.
  notAlsoOn?: string;
  // Post format. Default: a link post. "photo-question": the story's photo with
  // a caption that ends in a question, and the article link in the first comment
  // (postArticleToFacebook) — a test of whether that earns more reach than a link.
  style?: "photo-question";
  // A/B test of hook-first captions on link posts: half the stories (by id) get the hook-first
  // caption, half the current one, and each link is tagged utm_content=hook|control
  // (captionVariant.ts). Not applied to photo-question posts.
  captionTest?: boolean;
  // The same idea for this Page's reels: half the stories get a reel description that ends in a
  // question (the other half the usual one), by the same story split; link tagged question|control.
  reelCaptionTest?: boolean;
  // Breaking news (breakingNews.ts): stories under an hour old that several outlets cover can
  // go past the pacing and the daily cap — `allowance` more posts a day, `reelAllowance` more
  // reels, and those reels skip the minimum score and the reel hours. `slot` splits breaking
  // stories between Pages that share them (each takes its own half, by story id).
  breaking?: { allowance: number; reelAllowance: number; slot: 0 | 1; minOutlets?: number };
  // Automatic Reels for this Page (topicReels.ts): own daily limit, daytime only.
  // minTrending: skip stories scoring below this (Article.trendingScore) — the bottom of
  // the queue made weak reels (Greenfield's average score was 38 vs 55 on the main Page).
  // activeHours: reels only go out in these local hours (default: the Page's own).
  // instagram: also post each reel to the Page's own Instagram (instagramId).
  reels?: { dailyCap: number; perRunCap: number; minTrending?: number; activeHours?: { timeZone: string; start: number; end: number }; instagram?: boolean; youtube?: boolean };
  // The Instagram account linked to this Page: each story posted to the Page
  // also goes there as a photo post (topicPosting.ts). Unset = Facebook only.
  instagramId?: string;
  // That account's @name, shown on the reels' end card ("Follow @...").
  instagramHandle?: string;
  // Stories to put at the front of this Page's queue until a date (a big story
  // the Page should lead with), matched on the headline. Ends by itself.
  focus?: { terms: RegExp; until: Date };
  matches: (a: DestinationCandidate) => boolean;
  // The post's hashtags, when this Page wants its own (default: the main
  // Page's topic tags + #SportsWireLive — hashtagRepertoire.ts).
  hashtags?: (title: string, category: string) => string[];
}

export interface DestinationCandidate {
  category: string;
  title: string;
  homeTeam: string | null;
  awayTeam: string | null;
  seriesLabel: string | null;
  leagueLabel: string | null;
  venue: string | null;
}

// India cricket: India's own teams (men, women, A, U19) in a match; India-
// specific competitions (IPL, WPL, Ranji, Duleep, Vijay Hazare, Syed
// Mushtaq Ali) and venues named in the story or its series/league; or
// India / BCCI / Team India in the headline. Deliberately not "any story
// mentioning a player": a player list with nationality comes with the
// tagging redesign (see project plan), not a hand-kept list here.
const INDIA_TEAM = /^india(n)?\b/i;
const INDIA_TERMS =
  /\b(india|indian|bcci|team india|ipl|wpl|ranji|duleep|vijay hazare|syed mushtaq ali|irani cup|greenfield|thiruvananthapuram|eden gardens|wankhede|chinnaswamy|chepauk|narendra modi stadium)\b/i;

const ASIAN_GAMES = /\basian games\b/i;

export function isIndiaCricket(a: DestinationCandidate): boolean {
  // Asian Games stories in any sport — the Page's audience follows India's
  // whole Games campaign, not only its cricket.
  if (!a.category.startsWith("cricket")) return [a.title, a.seriesLabel].some((t) => t && ASIAN_GAMES.test(t));
  if ((a.homeTeam && INDIA_TEAM.test(a.homeTeam)) || (a.awayTeam && INDIA_TEAM.test(a.awayTeam))) return true;
  return [a.title, a.seriesLabel, a.leagueLabel, a.venue].some((t) => t && INDIA_TERMS.test(t));
}

// The Page's topic rule: all cricket (not only India's) plus Asian Games
// stories in any sport.
export function isCricketOrAsianGames(a: DestinationCandidate): boolean {
  return a.category.startsWith("cricket") || [a.title, a.seriesLabel].some((t) => t && ASIAN_GAMES.test(t));
}

const FRESH_MS = 12 * 3600_000;
const FIRST_HOUR_MS = 3600_000;

// Queue order for a Page: focus stories first, then stories published in the
// last hour (breaking news is worth most while it is breaking), then stories
// under 12 hours
// old, then the rest — each group keeps its incoming (trending) order.
export function prioritise<T extends DestinationCandidate & { publishedAt: Date | null }>(pool: T[], now: Date, focus?: FacebookDestination["focus"]): T[] {
  const age = (a: T) => (a.publishedAt ? now.getTime() - a.publishedAt.getTime() : Infinity);
  const focused = (a: T) => Boolean(focus && now < focus.until && focus.terms.test(a.title));
  const tier = (a: T) => (focused(a) ? 0 : age(a) >= 0 && age(a) < FIRST_HOUR_MS ? 1 : age(a) < FRESH_MS ? 2 : 3);
  return pool.map((a, i) => ({ a, i, t: tier(a) })).sort((x, y) => x.t - y.t || x.i - y.i).map((x) => x.a);
}

// What the two cricket Pages share. Each Page below lists its own settings in full, so a
// setting added to one never reaches the other by copying.
const CRICKET_BASE = {
  activeHours: { timeZone: "Asia/Kolkata", start: 7, end: 23 },
  sport: "cricket",
  alsoTitleLike: ["asian games"],
  // News only: nothing older than a day.
  maxAgeHours: 24,
  matches: isCricketOrAsianGames,
  // #INDvWI, the player, #TeamIndia — not the main Page's brand tag.
  hashtags: (title: string) => selectIndiaCricketHashtags(title),
} satisfies Partial<FacebookDestination>;

export const INDIA_CRICKET_PAGE: FacebookDestination = {
  ...CRICKET_BASE,
  key: "india-cricket",
  label: "India cricket Page",
  pageId: "359420874511841",
  tokenEnv: "FACEBOOK_PAGE_2_ACCESS_TOKEN",
  dailyCap: 50,
  perRunCap: 3,
  captionTest: true,
  reelCaptionTest: true,
  breaking: { allowance: 4, reelAllowance: 2, slot: 0 },
  reels: { dailyCap: 24, perRunCap: 1, minTrending: 35, youtube: true },
};

// Sportswirecricketlive: the test Page for the new approach (2026-10). It posts with the main
// FACEBOOK_PAGE_ACCESS_TOKEN (exchanged for its own Page token) and has its own posting history.
// Far fewer posts than Greenfield (10 a day, 10 reels), the photo + question + link-in-comment
// format, its own stories (never one Greenfield took), and reels at midday IST only.
// Greenfield stays the control.
export const CRICKETLIVE_PAGE: FacebookDestination = {
  ...CRICKET_BASE,
  key: "cricketlive",
  label: "Sportswirecricketlive Page",
  pageId: "1389324964254541",
  tokenEnv: "FACEBOOK_PAGE_ACCESS_TOKEN",
  dailyCap: 25,
  perRunCap: 2,
  style: "photo-question",
  breaking: { allowance: 4, reelAllowance: 2, slot: 1 },
  // Own stories, not Greenfield's; reels at midday IST only (11:00-16:00) — its
  // reels got 72-179 plays at 12-15h IST against 1-48 early morning and evening.
  notAlsoOn: "india-cricket",
  // minTrending 25 (Greenfield: 35): it gets the stories Greenfield left, so a floor keeps
  // the weakest of them out of its reels. Supply swings with the news: 112 cricket stories
  // scored 30+ on 3 Oct, 3 on 5 Oct (a quiet day) — so 25, not 30, to keep a few a day.
  // Reel volume test from 2026-10-15: 10 a day (was 20), best-ranked stories first (topicReels.ts ranks by trending, drama
  // and match day). Median plays per reel had fallen from 40 at 10 a day to 2 at 20 a day with total plays flat. Greenfield
  // stays at 24 a day as the comparison; compare median and total plays per Page after about a week, then decide.
  // Raised 10 -> 16 -> 20 on 2026-10-31 (user asked, with the voice pilot needing more voiced reels to compare): Instagram's publishing quota was 12 of 100 and the free AI quota had room.
  reels: { dailyCap: 20, perRunCap: 1, minTrending: 25, activeHours: { timeZone: "Asia/Kolkata", start: 11, end: 24 }, instagram: true, youtube: true },
  instagramId: "17841422405517404", // @sportswirecricketlive
  instagramHandle: "sportswirecricketlive",
};

// ---- Sport Pages (2026-10-07) -------------------------------------------
// One Page (+ its Instagram) per audience, all under the main Business, so
// they post with the main FACEBOOK_PAGE_ACCESS_TOKEN exchanged for each Page's
// own token. Categories are the stored Article.category values: soccer is
// "football"; American football is "american-football" and "college-football".
// Plain link posts, no reels yet. Ids checked live against the token.
const SPORT_PAGE_DEFAULTS = { tokenEnv: "FACEBOOK_PAGE_ACCESS_TOKEN", maxAgeHours: 24, matches: () => true } as const;


export const FOOTBALL_PAGE: FacebookDestination = {
  ...SPORT_PAGE_DEFAULTS,
  key: "football",
  label: "SportsWire Football Live Page",
  pageId: "1344971308703586",
  instagramId: "17841462310314966", // @sportswirefootballlive
  instagramHandle: "sportswirefootballlive",
  // Reels (2026-10-08): 8 a day on Facebook and Instagram, strongest stories only.
  // Reel cap raised 8 -> 12 on 2026-10-15 (facebook reels median 18-152 here against 2 on the big Pages; the topic Instagram photo posts were cut to free the Meta request budget).
  reels: { dailyCap: 12, perRunCap: 1, minTrending: 30, instagram: true },
  // Team, star and event tags for the sport (topicHashtags.ts), the sport's own tag, then the usual ones.
  hashtags: selectTopicFacebookHashtags,
  dailyCap: 25,
  perRunCap: 2,
  // UK/Europe evening is the peak; still awake for the Americas' afternoon.
  activeHours: { timeZone: "Europe/London", start: 7, end: 23 },
  sport: "football",
  // Messi and Ronaldo stories lead the queue (Messi's farewell, 6-7 Oct 2026, was the first such push;
  // from 11 Oct both players, with no end date) for the Page's posts and its reels.
  focus: { terms: STAR_TERMS, until: new Date("2030-01-01T00:00:00Z") },
};

export const US_SPORTS_PAGE: FacebookDestination = {
  ...SPORT_PAGE_DEFAULTS,
  key: "us-sports",
  label: "SportsWire US Live Page",
  pageId: "1456000910921996",
  instagramId: "17841424699143294", // @sportswireuslive
  instagramHandle: "sportswireuslive",
  // Reel cap raised 10 -> 14 on 2026-10-15: the Page was at its cap every day and its Instagram account had 4 of 100 daily posts used.
  reels: { dailyCap: 14, perRunCap: 1, minTrending: 30, instagram: true },
  // Team, star and event tags for the sport (topicHashtags.ts), the sport's own tag, then the usual ones.
  hashtags: selectTopicFacebookHashtags,
  dailyCap: 100,
  perRunCap: 3,
  activeHours: { timeZone: "America/New_York", start: 8, end: 24 },
  sport: "american-football",
  categories: ["american-football", "college-football", "basketball", "wnba", "baseball", "hockey"],
};

export const FIGHT_PAGE: FacebookDestination = {
  ...SPORT_PAGE_DEFAULTS,
  key: "fight",
  label: "SportsWire Fight Live Page",
  pageId: "1423517120834814",
  // No Instagram linked to this Page yet (checked 2026-10-08): reels on Facebook only.
  // Reel cap raised 4 -> 8 on 2026-10-15 (see the Football Page), 8 -> 12 on 2026-10-22 (user asked; watch plays per reel).
  reels: { dailyCap: 12, perRunCap: 1, minTrending: 20 },
  // Fewer stories exist (about 30 MMA + boxing a day), so a smaller cap.
  dailyCap: 14,
  perRunCap: 1,
  activeHours: { timeZone: "America/New_York", start: 10, end: 24 },
  sport: "mma",
  categories: ["mma", "boxing"],
  hashtags: (title, category) => selectFightHashtags(title, category),
};

// ---- Spanish Page (language edition "es") -------------------------------
// Posts translated stories, in Spanish, linking to es.sportswirelive.com.
// The Page exists (2026-10-07, under the main Business): ON by default, posting
// with the main token. FACEBOOK_ES_ENABLED=0 turns it off; FACEBOOK_PAGE_ES_ID and
// FACEBOOK_PAGE_ES_ACCESS_TOKEN, when set, override the Page and token.
// Its Instagram posts the same translated stories with Spanish captions (instagram.ts).
// Audience: US Hispanic, Latin America and Spain — so the posting day runs 8:00-23:00
// Mexico City time (mid-day for the Americas; late evening in Spain).
const SPANISH_PAGE_ID = "1343775455488735";

export function spanishPageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FACEBOOK_ES_ENABLED !== "0";
}

export const SPANISH_PAGE: FacebookDestination = {
  key: "es",
  label: "Spanish Page",
  pageId: process.env.FACEBOOK_PAGE_ES_ID || SPANISH_PAGE_ID,
  tokenEnv: process.env.FACEBOOK_PAGE_ES_ACCESS_TOKEN ? "FACEBOOK_PAGE_ES_ACCESS_TOKEN" : "FACEBOOK_PAGE_ACCESS_TOKEN",
  dailyCap: 30,
  perRunCap: 2,
  activeHours: { timeZone: "America/Mexico_City", start: 8, end: 23 },
  sport: "football",
  categories: LOCALES.es.categories,
  locale: "es",
  matches: () => true,
  hashtags: (title, category) => selectSpanishHashtags(title, category),
  instagramId: "17841471180978125", // @sportswireliveinspanish
  instagramHandle: "sportswireliveinspanish",
  // Its own Spanish reels (Spanish text, caption and link) on Facebook and Instagram
  // (postReel.ts): 12 a day (raised from 6 on 2026-10-11 to feed the Spanish YouTube channel), one per run, all day (0-24 on the Mexico City clock: Spanish speakers span Spain in the early morning to the US west coast late at night).
  // Reel cap raised 12 -> 16 on 2026-10-15 (see the Football Page).
  reels: { dailyCap: 16, perRunCap: 1, instagram: true, youtube: true, activeHours: { timeZone: "America/Mexico_City", start: 0, end: 24 } },
};

export const TOPIC_DESTINATIONS: FacebookDestination[] = [INDIA_CRICKET_PAGE, CRICKETLIVE_PAGE, FOOTBALL_PAGE, US_SPORTS_PAGE, FIGHT_PAGE, ...(spanishPageEnabled() ? [SPANISH_PAGE] : [])];

// The hour (fractional) in a time zone, e.g. 13.5 for 1:30 PM.
function localHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") + get("minute") / 60;
}

// Start of the destination's local day, as a UTC instant — "posted today"
// is counted per the Page's own day, not UTC's.
export function localDayStart(now: Date, timeZone: string): Date {
  return new Date(now.getTime() - localHour(now, timeZone) * 3600_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

// How many posts this run may make: the daily limit spread evenly over the
// active hours, minus what's already gone out today, within the per-run
// cap. 0 outside the active hours (pure, unit-tested).
export function destinationRunCap(d: Pick<FacebookDestination, "dailyCap" | "perRunCap" | "activeHours"> & { overnight?: boolean }, postedToday: number, now: Date): number {
  const { timeZone, start, end } = d.activeHours;
  const hour = localHour(now, timeZone);
  if (hour < start || hour >= end) {
    // Overnight: low intensity — at most one post, only in the first run of
    // every second hour (~4 over the night), and still within the daily cap.
    if (d.overnight === false) return 0;
    return hour % 2 < 0.25 ? Math.max(0, Math.min(1, d.dailyCap - postedToday)) : 0;
  }
  // 25% head start so the Page isn't silent through the morning.
  const elapsed = Math.min(1, (hour - start) / (end - start) + 0.25);
  const expected = Math.ceil(d.dailyCap * elapsed) || 1;
  return Math.max(0, Math.min(d.perRunCap, expected - postedToday, d.dailyCap - postedToday));
}

// Post-history keys of the topic Pages' Instagram accounts. The main Instagram's
// own checks (already posted, daily limit, similar titles: autoApprove.ts,
// socialPoster.ts) leave these out, so a sport account's posts never block or
// count against the main account.
export const TOPIC_INSTAGRAM_KEYS: string[] = TOPIC_DESTINATIONS.filter((d) => d.instagramId).flatMap((d) => [d.key, `${d.key}-reel`]);
