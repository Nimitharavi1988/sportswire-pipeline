import Parser from "rss-parser";
import type { RawMatchItem } from "./footballData";
import { decodeHtmlEntities } from "../htmlEntities";
import { englishifyForeignItems } from "./foreignHeadlines";

// Each publisher includes a real, story-specific photo directly in their own
// RSS feed — media:thumbnail (BBC) or media:content, sometimes with a
// nested media:credit (Guardian), sometimes as a plain <coverImages> string
// (ESPN Cricinfo). This is the RSS spec's own mechanism for exactly this —
// letting an aggregator show a preview image next to the headline — so it's
// extracted the same way the headline/link/date already are: displayed with
// credit and a link back to the original, never re-hosted as if it were our
// own photography. Confirmed via raw feed inspection, not assumed.
const parser = new Parser({
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail"],
      ["media:content", "mediaContent", { keepArray: true }],
      ["coverImages", "coverImages"],
    ],
  },
});

interface RssImage {
  url: string;
  credit?: string;
}

function firstOrOnly<T>(value: T | T[] | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// Some publishers (ESPN Cricinfo's coverImages field in particular) still
// serve image URLs over plain http:// — loaded on our https:// pages, that's
// mixed content. Browsers auto-upgrade it, but it still logs a console
// warning and isn't guaranteed everywhere, so normalize at extraction time.
function toHttps(url: string): string {
  return url.startsWith("http://") ? `https://${url.slice(7)}` : url;
}

// BBC's own media:thumbnail is a small 240px-wide crop by default — the
// same source image is available at full resolution from the identical
// ichef.bbci.co.uk URL, just with a different width segment in the path
// (confirmed live: swapping /standard/240/ for /standard/976/ on a real
// article's image URL served an 11x larger file, genuinely higher
// resolution, not just a bigger byte size for the same pixels). Only
// rewrites BBC's own CDN URLs — leaves every other publisher's image
// exactly as given, since only ichef's URL shape is confirmed predictable
// this way.
function upscaleBbcImage(url: string): string {
  if (!url.includes("ichef.bbci.co.uk")) return url;
  return url.replace(/\/standard\/\d+\//, "/standard/976/");
}

// media:content can appear once (ESPN Cricinfo) or multiple times as
// different size variants of the same photo (Guardian) — when there are
// several, the largest is the best fit for a hero-style display.
export function extractRssImage(entry: any): RssImage | null {
  const contents: any[] = Array.isArray(entry.mediaContent)
    ? entry.mediaContent
    : entry.mediaContent
      ? [entry.mediaContent]
      : [];

  if (contents.length > 0) {
    const largest = contents.reduce((best, c) => {
      const width = Number(c?.$?.width) || 0;
      const bestWidth = Number(best?.$?.width) || 0;
      return width > bestWidth ? c : best;
    });
    const url: string | undefined = largest?.$?.url;
    if (url) {
      const credit = firstOrOnly(largest["media:credit"])?._;
      return { url: toHttps(url), credit: typeof credit === "string" ? credit.trim() : undefined };
    }
  }

  const thumbnailUrl: string | undefined = entry.mediaThumbnail?.$?.url;
  if (thumbnailUrl) return { url: toHttps(upscaleBbcImage(thumbnailUrl)) };

  if (typeof entry.coverImages === "string" && entry.coverImages.trim()) {
    return { url: toHttps(entry.coverImages.trim()) };
  }

  // Standard RSS 2.0 <enclosure> — a core field rss-parser already parses
  // without any customFields config (unlike the Media RSS extensions
  // above). Sky Sports uses this instead of media:thumbnail/media:content.
  const enclosureUrl: string | undefined =
    typeof entry.enclosure?.url === "string" && entry.enclosure.type?.startsWith("image")
      ? entry.enclosure.url
      : undefined;
  if (enclosureUrl) return { url: toHttps(enclosureUrl) };

  return null;
}

export interface RssFeed {
  url: string;
  category: string;
  sourceName: string;
  // Per-feed topic filter, on the headline: a general sports feed can feed
  // one sport's section (`include`), and a feed's off-brand content can be
  // kept out (`exclude`). Without `include`, every item takes the feed's
  // category — right for a sport-specific feed, wrong for a mixed one.
  include?: RegExp;
  exclude?: RegExp;
  // The feed is not in English ("es"): headlines are translated to English and the
  // source text is flagged as Spanish before the article is written (foreignHeadlines.ts).
  language?: "es";
}

// Whether a feed item belongs in the site under that feed (pure, tested).
export function acceptsItem(feed: Pick<RssFeed, "include" | "exclude">, title: string): boolean {
  if (feed.include && !feed.include.test(title)) return false;
  if (feed.exclude && feed.exclude.test(title)) return false;
  return true;
}

// The article's full text when the feed carries it (content:encoded) —
// enough to write from without fetching the page. undefined for feeds that
// only give a short description (pure, tested).
export function feedFullText(entry: object): string | undefined {
  const html = (entry as Record<string, unknown>)["content:encoded"];
  if (typeof html !== "string") return undefined;
  if (!html) return undefined;
  const text = decodeHtmlEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text.length >= 400 ? text : undefined;
}

// First real photo inside the feed's article HTML, for feeds that don't use
// media:/enclosure tags. Skips avatars, emoji and tracking pixels (pure, tested).
export function feedContentImage(entry: object): RssImage | null {
  const fields = entry as Record<string, unknown>;
  const raw = fields["content:encoded"] ?? fields.content;
  const html = typeof raw === "string" ? raw : "";
  for (const m of html.matchAll(/<img\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi)) {
    // Attribute values keep "&" encoded ("&#038;") — FIVB's photo URLs were
    // stored that way and never loaded.
    const url = decodeHtmlEntities(m[1]);
    if (/gravatar|emoji|pixel|1x1|\.gif(\?|$)|\.svg(\?|$)/i.test(url)) continue;
    return { url };
  }
  return null;
}

// Cricket stories in a general sports feed (Indian outlets, 2026-09-26).
const CRICKET_HEADLINE =
  /\b(cricket|odis?|t20is?|t20|test match|ipl|wpl|bcci|icc|ranji|duleep|wicket|innings|kohli|rohit|gill|bumrah|samson|pant|jadeja|kuldeep|hardik|west indies|windies)\b/i;
// Fantasy/betting/prediction pieces some cricket sites publish daily — not news.
const FANTASY_OR_BETTING = /\b(dream11|fantasy|predictions?|predicted xi|betting|odds|who will win|today'?s match)\b/i;

// MotoGP stories in a general motorsport feed (Crash.net, 2026-10-15): the class names, the
// current riders and the factory teams. Kept to MotoGP-specific names so F1, rally and
// superbike items do not land in the MotoGP section.
export const MOTOGP_HEADLINE =
  /\b(moto ?gp|moto2|moto3|bagnaia|m[aá]rquez|acosta|bezzecchi|quartararo|vi[nñ]ales|jorge mart[ií]n|pramac|trackhouse|gresini|vr46|tech3|dorna|aprilia|ducati lenovo|di giannantonio|diggia|zarco|joan mir|bastianini|morbidelli|aldeguer|ogura|raul fern[aá]ndez|miguel oliveira|jack miller|brad binder|holgado|mandalika)\b/i;
// Formula 1 stories in a general motorsport feed (Crash.net): the series, the current drivers, the teams.
export const F1_HEADLINE =
  /\b(f1|formula 1|formula one|verstappen|hamilton|russell|leclerc|norris|piastri|alonso|sainz|antonelli|albon|hadjar|bearman|lawson|gasly|ocon|stroll|hulkenberg|bortoleto|colapinto|red bull|ferrari|mercedes|mclaren|aston martin|williams|alpine|haas|cadillac|horner|wolff|mekies|vasseur|fia)\b/i;
// ...and what is not Formula 1: MotoGP names, plus the other series Crash.net covers.
export const F1_EXCLUDE = new RegExp(`${MOTOGP_HEADLINE.source}|\\b(indycar|gt world challenge|gt3|gt4|nascar|dtm|wec|le mans|wrc|rally|formula e|f2|f3)\\b`, "i");
export const MOTOGP_NOT_GP =/\b(wsbk|world superbike|superbike|isle of man|tt races|speedway|motocross|supercross)\b/i;

// US-sport headline filters for mixed-sport feeds (league name or a team).
const NFL_HEADLINE =
  /\b(nfl|super bowl|quarterbacks?|touchdown|chiefs|eagles|cowboys|packers|patriots|bills|ravens|bengals|steelers|browns|texans|colts|jaguars|titans|broncos|raiders|chargers|dolphins|jets|commanders|lions|bears|vikings|saints|falcons|panthers|buccaneers|49ers|seahawks|rams|mahomes|hurts|burrow|lamar jackson|josh allen)\b/i;
const NBA_HEADLINE =
  /\b(nba|lakers|celtics|knicks|warriors|bucks|sixers|76ers|bulls|cavaliers|pistons|pacers|hawks|hornets|wizards|raptors|clippers|nuggets|timberwolves|thunder|spurs|mavericks|mavs|grizzlies|pelicans|trail blazers|wembanyama|lebron|curry|doncic|jokic)\b/i;
const MLB_HEADLINE =
  /\b(mlb|world series|yankees|red sox|dodgers|phillies|braves|mets|cubs|astros|padres|white sox|guardians|orioles|rays|blue jays|mariners|royals|brewers|pirates|nationals|marlins|diamondbacks|rockies|angels|aaron judge|ohtani)\b/i;
const CFB_HEADLINE =
  /\b(college football|cfp|ncaa football|ohio state|alabama|notre dame|usc|lsu|clemson|penn state|oklahoma|florida state|tennessee|auburn|saban|lincoln riley|deion sanders)\b/i;

// Sportsbook promos, odds and picks (Fox Sports runs several a day) — not news.
const BETTING_PROMO = /\b(promo codes?|bonus(es)?|odds|parlays?|best bets?|betting|sportsbook|kalshi|polymarket|prediction markets?|picks?)\b/i;

export const FEEDS: RssFeed[] = [
  // No structured race-data source exists on any free tier (confirmed live:
  // api-sports.io's Formula-1 API free plan rejects the current season
  // entirely — "try from 2022 to 2024"), so F1 is RSS-only editorial
  // content, same as this file's other sources, rather than the
  // RawMatchItem match-data pattern the other new sports use.
  { url: "https://www.autosport.com/rss/f1/news/", category: "formula-1", sourceName: "Autosport" },
  // Added 2026-09-20 (explicit request) after Autosport alone went ~33h
  // with no new item, which read as a real gap even though it wasn't an
  // ingestion bug (confirmed live by comparing the DB directly against
  // Autosport's own feed — every item present, feed itself just quiet).
  // Motorsport.com is a sister publication under the same Motorsport
  // Network as Autosport (identical feed shape, confirmed live), but
  // publishes independently and was meaningfully fresher when checked
  // (items from within the hour vs. Autosport's 33h-old latest) — a real,
  // different update cadence despite the shared parent company, not a
  // near-duplicate source. BBC Sport F1 adds a genuinely different
  // publisher/voice, same domain pattern already proven reliable for this
  // pipeline's football/cricket feeds below.
  { url: "https://www.motorsport.com/rss/f1/news/", category: "formula-1", sourceName: "Motorsport.com" },
  { url: "http://feeds.bbci.co.uk/sport/formula1/rss.xml", category: "formula-1", sourceName: "BBC Sport" },
  // 2026-10-15: Motorsport.com and Autosport answer our article fetch with http 403, so 191 of 259
  // Formula 1 stories in 10 days were rejected and only 30 published. These three read fine
  // (checked with the site's own reader): The Race carries the whole article in its feed (median 4,865
  // characters, so a blocked page fetch cannot hurt it); RaceFans and Crash.net need the page.
  { url: "https://www.the-race.com/feed/", category: "formula-1", sourceName: "The Race" },
  { url: "https://www.racefans.net/feed/", category: "formula-1", sourceName: "RaceFans" },
  // Crash.net's feed is general (F1, MotoGP, IndyCar, GT): F1 headlines only, never the MotoGP ones.
  { url: "https://www.crash.net/rss", category: "formula-1", sourceName: "Crash.net", include: F1_HEADLINE, exclude: F1_EXCLUDE },
  { url: "http://feeds.bbci.co.uk/sport/football/rss.xml", category: "football", sourceName: "BBC Sport" },
  { url: "http://feeds.bbci.co.uk/sport/cricket/rss.xml", category: "cricket", sourceName: "BBC Sport" },
  // Feed 11095 is Sky's football-only feed — confirmed by inspecting its
  // actual content (25/25 items football, no darts/golf/F1). The previously
  // used feed 12040 is a mixed all-sports feed, which combined with the
  // narrow "auto" keyword filter below was silently dropping real football
  // transfer news (e.g. Man City/Man Utd stories with no literal "football"
  // or "premier league" in the title).
  { url: "https://www.skysports.com/rss/11095", category: "football", sourceName: "Sky Sports" },
  { url: "http://www.espncricinfo.com/rss/content/story/feeds/0.xml", category: "cricket", sourceName: "ESPN Cricinfo" },
  // Cricinfo's India-specific country feed — overlaps with the general
  // cricket feed above for stories that make the global cut (the existing
  // title+publishedAt dedupe handles that safely), but surfaces a lot of
  // India-specific coverage (domestic cricket, IPL-adjacent news, player
  // stories) that doesn't make the global feed's limited item count.
  // Confirmed live and working directly (2026-09-10) — the country feed
  // numbering is Cricinfo's own (6 = India), not something documented
  // publicly beyond their RSS index page.
  { url: "https://www.cricinfo.com/rss/content/story/feeds/6.xml", category: "cricket", sourceName: "ESPN Cricinfo" },
  { url: "https://www.theguardian.com/sport/cricket/rss", category: "cricket", sourceName: "The Guardian" },
  // Added specifically to close the "same repeated photo" gap for Indian
  // cricket player coverage: confirmed live (2026-09-12) that stories like
  // the Samson/Sooryavanshi selection debate are largely NOT covered by
  // Cricinfo's own editorial desk (their per-player feed hadn't published
  // anything about Samson in over two months, despite heavy coverage
  // elsewhere) — they're covered by outlets like this one instead. Direct
  // feed, real media:content images (1600x900, confirmed), real article
  // URLs — same legitimate syndication pattern as every other feed here,
  // and it sidesteps Google News search's unresolvable-redirect problem
  // entirely for whatever this outlet covers.
  { url: "https://www.hindustantimes.com/feeds/rss/cricket/rssfeed.xml", category: "cricket", sourceName: "Hindustan Times" },
  // Added 2026-09-23 (explicit request to increase real cricket volume,
  // specifically during Asia daytime hours) after confirming two real gaps:
  // CricketData.org's free-tier match API doesn't surface domestic/A-team
  // cricket (Ranji Trophy, India A, U19), and most of cricket's Google News
  // search volume was structurally unable to produce a real article body
  // (see runIngest.ts's resolveGrounding — those links can never be
  // extracted). Both feeds checked live: direct article URLs (not Google
  // News redirects), robots.txt allows crawling, and real extraction
  // succeeded at 2100-3000 chars on every sampled item, including genuine
  // domestic coverage (Ranji Trophy) and Asian Games content Google News
  // search alone was missing.
  { url: "https://timesofindia.indiatimes.com/rssfeeds/54829575.cms", category: "cricket", sourceName: "The Times of India" },
  { url: "https://www.wisden.com/feed", category: "cricket", sourceName: "Wisden" },
  // Indian cricket coverage read directly (added 2026-09-26). The India v
  // West Indies ODI build-up (squads, injuries, Greenfield/Thiruvananthapuram
  // venue and pitch stories) was all arriving via Google News search, whose
  // links can't be read — so almost every one was rejected. Each feed below
  // checked live: current items, readable pages, real photos, robots.txt
  // allows. General sports feeds take cricket headlines only (include);
  // CricTracker/CricketAddictor carry daily pitch reports and venue stats
  // but also fantasy/betting predictions, which are excluded.
  { url: "https://sportstar.thehindu.com/cricket/feeder/default.rss", category: "cricket", sourceName: "Sportstar" },
  { url: "https://www.thehindu.com/sport/cricket/feeder/default.rss", category: "cricket", sourceName: "The Hindu" },
  { url: "https://indianexpress.com/section/sports/cricket/feed/", category: "cricket", sourceName: "The Indian Express" },
  { url: "https://www.indiatoday.in/rss/1206550", category: "cricket", sourceName: "India Today", include: CRICKET_HEADLINE },
  { url: "https://www.onmanorama.com/sports.feeds.rss.xml", category: "cricket", sourceName: "Onmanorama", include: CRICKET_HEADLINE },
  { url: "https://english.mathrubhumi.com/rss/sports", category: "cricket", sourceName: "Mathrubhumi", include: CRICKET_HEADLINE },
  { url: "https://www.crictracker.com/feed/", category: "cricket", sourceName: "CricTracker", exclude: FANTASY_OR_BETTING },
  { url: "https://cricketaddictor.com/feed/", category: "cricket", sourceName: "CricketAddictor", exclude: FANTASY_OR_BETTING },
  // ESPN's general soccer feed — broader global coverage than the UK-focused
  // feeds above, more likely to pick up MLS (Messi/Inter Miami) and Saudi
  // Pro League (Ronaldo/Al-Nassr) news, which football-data.org's structured
  // match data doesn't cover for either league (checked: football-data.org
  // has no Saudi Pro League at any pricing tier, and MLS only on a paid
  // tier) — a real coverage gap this at least partially closes for free.
  { url: "https://www.espn.com/espn/rss/soccer/news", category: "football", sourceName: "ESPN" },
  // NFL editorial news (injuries, roster moves, storylines) — the American
  // football section previously had only nflData.ts's game previews/results,
  // no news coverage at all, unlike football and cricket which both have
  // structured match data AND RSS news side by side. Confirmed live and
  // working directly (2026-09-10).
  { url: "https://www.espn.com/espn/rss/nfl/news", category: "american-football", sourceName: "ESPN" },
  // NFL previously had only this one feed (vs football's 3 / cricket's 4) —
  // confirmed real, thin coverage as a result. Both checked live and
  // working directly (2026-09-11).
  { url: "https://www.cbssports.com/rss/headlines/nfl/", category: "american-football", sourceName: "CBS Sports" },
  // Yahoo's feed embeds its image inside <content:encoded> as an <img> tag
  // rather than media:thumbnail/media:content/enclosure like every other
  // feed here — extractRssImage doesn't parse that, so these items fall
  // back to the category stock photo. Not worth a bespoke HTML-parsing path
  // for one feed; same stock-photo fallback plenty of other items already
  // use.
  { url: "https://sports.yahoo.com/nfl/rss/", category: "american-football", sourceName: "Yahoo Sports" },
  // MLB/NBA editorial news (injuries, roster moves, storylines) — mlbData.ts/
  // nbaData.ts only ever provide game previews/results, no news coverage,
  // the exact same gap NFL originally had (see ESPN NFL feed comment above).
  // This is also what populates the homepage's "Also in the News" sidebar
  // for these categories — that module only ever draws from RSS-sourced
  // articles, so without a feed here it stayed completely empty for these
  // two categories even with real match-data content in the main column.
  // Confirmed live and working directly (2026-09-12).
  { url: "https://www.espn.com/espn/rss/mlb/news", category: "baseball", sourceName: "ESPN" },
  { url: "https://www.espn.com/espn/rss/nba/news", category: "basketball", sourceName: "ESPN" },
  // Hockey editorial news — same gap NFL/MLB/NBA originally had:
  // nhlData.ts only ever provides structured match data (scores/standings)
  // via ESPN's scoreboard API, no news coverage. Added 2026-09-20 — real
  // audience relevance for the confirmed Sweden secondary audience too,
  // since Swedish NHL players are frequent subjects in NHL editorial
  // coverage even without a dedicated Swedish Hockey League feed (checked;
  // no confirmed-working free SHL-specific source found). Confirmed live
  // and working directly (2026-09-20).
  { url: "https://www.espn.com/espn/rss/nhl/news", category: "hockey", sourceName: "ESPN" },
  // MLB/NBA/NHL news that actually publishes (added 2026-09-26). The ESPN
  // feeds above (and CBS's) were producing zero published stories: their
  // article pages can't be extracted, so commentary fails and every item
  // is rejected on its first run (7-day check: MLB 0 published, NBA 0,
  // NHL 0 — leaving those pages with no news and no hero at all). Yahoo's
  // NFL feed is the one US source that works end to end, and its MLB/NBA/
  // NHL feeds have the identical shape: ~50 items a day, short snippets
  // (<200 chars, so grounding extracts the page — which is where the photo
  // comes from, since these feeds carry none). Checked live on sampled
  // items: page text + a hero-quality photo extracted for MLB 3/3, NBA 2/3,
  // NHL 3/3. MLB.com is the league's own newsroom (~25 a day, no feed
  // description, page photo 3/3). The Guardian adds low-volume (a few a
  // week) but well-photographed features, with photos in the feed itself.
  { url: "https://www.mlb.com/feeds/news/rss.xml", category: "baseball", sourceName: "MLB.com" },
  { url: "https://sports.yahoo.com/mlb/rss/", category: "baseball", sourceName: "Yahoo Sports" },
  { url: "https://sports.yahoo.com/nba/rss/", category: "basketball", sourceName: "Yahoo Sports" },
  { url: "https://sports.yahoo.com/nhl/rss/", category: "hockey", sourceName: "Yahoo Sports" },
  { url: "https://www.theguardian.com/sport/mlb/rss", category: "baseball", sourceName: "The Guardian" },
  { url: "https://www.theguardian.com/sport/nba/rss", category: "basketball", sourceName: "The Guardian" },
  { url: "https://www.theguardian.com/sport/nhl/rss", category: "hockey", sourceName: "The Guardian" },
  // Volleyball had match results only (espnVolleyballData.ts/
  // volleyballData.ts), no news. Checked live 2026-09-26 (Volleyball
  // World's own feeds 404): Volleyball Magazine (~1/day), FIVB — the
  // international federation (~10/week), NCAA.com D1 women's (~4/week, the
  // same college game the ESPN scores cover). None carry images in the
  // feed; the page photo is extracted during grounding (runIngest.ts),
  // found on 2-3 of 3 sampled items per feed.
  { url: "https://volleyballmag.com/feed/", category: "volleyball", sourceName: "Volleyball Magazine" },
  { url: "https://www.fivb.com/feed/", category: "volleyball", sourceName: "FIVB" },
  { url: "https://www.ncaa.com/news/volleyball-women/d1/rss.xml", category: "volleyball", sourceName: "NCAA.com" },
  // Arkansas volleyball match coverage (2026-10-13, after the Razorbacks beat Texas A&M and the site had
  // almost no college volleyball news): two Arkansas outlets whose feeds mix every sport, so only the
  // volleyball headlines are taken. Checked live: Arkansas Democrat-Gazette 4 of 150 items, Hit That Line
  // (ESPN Arkansas) 1 of 10. The Razorbacks' own feed had none in its 10 latest items, so it is left out.
  { url: "https://www.arkansasonline.com/rss/headlines/sports/", category: "volleyball", sourceName: "Arkansas Democrat-Gazette", include: /volleyball/i },
  { url: "https://hitthatline.com/feed/", category: "volleyball", sourceName: "Hit That Line", include: /volleyball/i },
  // College volleyball, league-wide (2026-10-13): the conferences' own volleyball feeds, checked live that day
  // (10 items each, the newest from that morning: weekly awards, match previews and recaps, tournament news).
  // The SEC has no public feed; its teams are covered through the team and Arkansas feeds above. Big 12's
  // feed mixes every sport, so only volleyball headlines are taken.
  { url: "https://bigten.org/rss.aspx?path=wvball", category: "volleyball", sourceName: "Big Ten Conference" },
  { url: "https://theacc.com/rss.aspx?path=wvball", category: "volleyball", sourceName: "ACC" },
  { url: "https://bigeast.com/rss.aspx?path=wvball", category: "volleyball", sourceName: "BIG EAST" },
  { url: "https://theamerican.org/rss.aspx?path=wvball", category: "volleyball", sourceName: "American Athletic Conference" },
  { url: "https://themw.com/rss.aspx?path=wvball", category: "volleyball", sourceName: "Mountain West" },
  { url: "https://sunbeltsports.org/rss.aspx?path=wvball", category: "volleyball", sourceName: "Sun Belt Conference" },
  { url: "https://wccsports.com/rss.aspx?path=wvball", category: "volleyball", sourceName: "West Coast Conference" },
  { url: "https://bigwest.org/rss.aspx?path=wvball", category: "volleyball", sourceName: "Big West" },
  { url: "https://asunsports.org/rss.aspx?path=wvball", category: "volleyball", sourceName: "ASUN Conference" },
  { url: "https://ivyleague.com/rss.aspx?path=wvball", category: "volleyball", sourceName: "Ivy League" },
  { url: "https://big12sports.com/rss.aspx", category: "volleyball", sourceName: "Big 12 Conference", include: /volleyball/i },
  // College football and WNBA news (added 2026-09-26 with the sections
  // themselves) — same Yahoo feed shape as NFL/MLB/NBA/NHL above. Checked
  // live: 50 items in the last 24h each; sampled pages readable 3/3, with a
  // hero-quality photo on WNBA 3/3 and college football 1/3 (the rest keep
  // the team-crest/stock fallback like any photo-less item).
  { url: "https://sports.yahoo.com/college-football/rss/", category: "college-football", sourceName: "Yahoo Sports" },
  { url: "https://sports.yahoo.com/wnba/rss/", category: "wnba", sourceName: "Yahoo Sports" },
  // Opinion/insider/what-they-said sources (added 2026-10-01, US reach).
  // Checked live: all four fresh within 36h with photos in the feed. The two
  // general feeds (Awful Announcing, Fox Sports) are mixed-sport, so each
  // sport's section takes only its own headlines via the include filters.
  { url: "https://profootballtalk.nbcsports.com/feed/", category: "american-football", sourceName: "Pro Football Talk" },
  { url: "https://www.cbssports.com/rss/headlines/college-football/", category: "college-football", sourceName: "CBS Sports" },
  { url: "https://awfulannouncing.com/feed", category: "american-football", sourceName: "Awful Announcing", include: NFL_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://awfulannouncing.com/feed", category: "basketball", sourceName: "Awful Announcing", include: NBA_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://awfulannouncing.com/feed", category: "baseball", sourceName: "Awful Announcing", include: MLB_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://awfulannouncing.com/feed", category: "college-football", sourceName: "Awful Announcing", include: CFB_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://www.foxsports.com/feedout/syndicatedContent?categoryId=0", category: "american-football", sourceName: "Fox Sports", include: NFL_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://www.foxsports.com/feedout/syndicatedContent?categoryId=0", category: "basketball", sourceName: "Fox Sports", include: NBA_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://www.foxsports.com/feedout/syndicatedContent?categoryId=0", category: "baseball", sourceName: "Fox Sports", include: MLB_HEADLINE, exclude: BETTING_PROMO },
  { url: "https://www.foxsports.com/feedout/syndicatedContent?categoryId=0", category: "college-football", sourceName: "Fox Sports", include: CFB_HEADLINE, exclude: BETTING_PROMO },
  // Athletics/track and field — news-only section (no structured match-data
  // source exists the way football-data.org/CricketData.org/ESPN NFL do for
  // the others; athletics is start-list/results based, not "matches"), per
  // explicit request. Confirmed live and working directly (2026-09-12) —
  // real current items (e.g. Ingebrigtsen/Kerr 1500m), real media:thumbnail
  // images.
  { url: "https://feeds.bbci.co.uk/sport/athletics/rss.xml", category: "athletics", sourceName: "BBC Sport" },
  // Second athletics source — BBC alone was too thin (only 6 published
  // items even after several days), most of which get consumed by the
  // hero carousel/highlight picks before "Also in the News" has anything
  // left. Confirmed live and working directly (2026-09-13): real current
  // items (Ultimate Championship coverage), no native RSS image tags (no
  // media:thumbnail/content/enclosure) — falls back to og:image extraction
  // during commentary grounding, same as any other image-less feed.
  { url: "https://athleticsweekly.com/feed/", category: "athletics", sourceName: "Athletics Weekly" },
  // Third athletics source — ESPN's Olympic-sports desk, added 2026-09-20
  // (explicit request for multi-sport-games coverage like the Asian Games).
  // Confirmed live: current items (Sept 18-20 2026), and its very first
  // item on check was real Asian Games coverage. Deliberately picked ESPN's
  // own take on these games over a foreign wire/official source — this
  // site's confirmed real audience is US-majority, so a US outlet's
  // framing of an event like the Asian Games is a better fit than a
  // dedicated Asian-Games-specific feed would be. Broader than pure track
  // and field (Olympic sports generally), but "athletics" is the closest
  // existing category and every other athletics source here is already
  // similarly broad (start-list/results news, not a fixed sport list).
  { url: "https://www.espn.com/espn/rss/oly/news", category: "athletics", sourceName: "ESPN" },
  // Rugby — news-only, same reasoning as Athletics: no single clean
  // structured-data source exists. Specifically no ESPN scoreboard-style
  // endpoint either, unlike NBA/MLB/NFL — rugby is fragmented across many
  // separate competitions (Six Nations, Rugby Championship, Premiership,
  // Top 14, World Cup...), each its own ESPN tournament ID with no unified
  // "rugby" feed, and most are out of season most of the year (checked:
  // Six Nations' own endpoint returns its already-finished Jan-Mar season,
  // nothing current in September). Confirmed live and working directly
  // (2026-09-12).
  { url: "https://feeds.bbci.co.uk/sport/rugby-union/rss.xml", category: "rugby", sourceName: "BBC Sport" },
  // 2026-10-15: Rugby had one source (BBC). Both of these read fine and update daily (checked with the site's own reader).
  { url: "https://www.theguardian.com/sport/rugby-union/rss", category: "rugby", sourceName: "The Guardian" },
  { url: "https://www.rugbyworld.com/feed", category: "rugby", sourceName: "Rugby World" },
  // Individual / global sports (2026-10-03) — popular with Spanish-speaking readers
  // (Alcaraz, Canelo, Marc Márquez, the Vuelta, Rahm) and added for every edition. All
  // feeds checked live that day (200, current items). The Spanish edition opts in via
  // LOCALES.es.categories.
  { url: "http://feeds.bbci.co.uk/sport/tennis/rss.xml", category: "tennis", sourceName: "BBC Sport" },
  { url: "https://www.espn.com/espn/rss/tennis/news", category: "tennis", sourceName: "ESPN" },
  { url: "https://www.theguardian.com/sport/tennis/rss", category: "tennis", sourceName: "The Guardian" },
  { url: "https://sports.yahoo.com/tennis/rss/", category: "tennis", sourceName: "Yahoo Sports" },
  { url: "http://feeds.bbci.co.uk/sport/boxing/rss.xml", category: "boxing", sourceName: "BBC Sport" },
  { url: "https://www.espn.com/espn/rss/boxing/news", category: "boxing", sourceName: "ESPN" },
  { url: "https://www.theguardian.com/sport/boxing/rss", category: "boxing", sourceName: "The Guardian" },
  { url: "https://www.espn.com/espn/rss/mma/news", category: "mma", sourceName: "ESPN" },
  { url: "https://sports.yahoo.com/mma/rss/", category: "mma", sourceName: "Yahoo Sports" },
  { url: "https://www.cbssports.com/rss/headlines/mma/", category: "mma", sourceName: "CBS Sports" },
  // 2026-10-15: direct feeds for publishers whose stories arrived only as Google News links. Those links cannot be
  // read (a 74-character headline is all we get), so 92-99% of the "source text too thin" rejections in football
  // (1,104 of 1,203 in 7 days), basketball, NFL and cricket were Google News links. These four read fine from
  // their own feeds (checked with the site's own reader). Not added: Heavy.com (clickbait/reaction tone, like the
  // excluded Sports Illustrated); Cricbuzz, NDTV Sports, News18 and Basketball Network refuse our fetch (403).
  { url: "https://www.cbssports.com/rss/headlines/soccer/", category: "football", sourceName: "CBS Sports", exclude: BETTING_PROMO },
  { url: "https://www.cbssports.com/rss/headlines/nba/", category: "basketball", sourceName: "CBS Sports", exclude: BETTING_PROMO },
  { url: "https://www.cbssports.com/rss/headlines/mlb/", category: "baseball", sourceName: "CBS Sports", exclude: BETTING_PROMO },
  { url: "https://www.rediff.com/rss/cricketrss.xml", category: "cricket", sourceName: "Rediff", exclude: FANTASY_OR_BETTING },
  { url: "https://www.motorsport.com/rss/motogp/news/", category: "motogp", sourceName: "Motorsport.com" },
  { url: "https://www.autosport.com/rss/motogp/news/", category: "motogp", sourceName: "Autosport" },
  // Motorsport.com and Autosport refuse our page fetch (http 403), so every story from them is rejected
  // (60 of 68 MotoGP stories in 10 days) and the MotoGP section had almost nothing and no hero. Crash.net's
  // articles read fine (2,000-3,000 characters each). Its feed is general (the /motogp path returns the
  // same feed), hence the headline filter.
  { url: "https://www.crash.net/rss", category: "motogp", sourceName: "Crash.net", include: MOTOGP_HEADLINE, exclude: MOTOGP_NOT_GP },
  { url: "http://feeds.bbci.co.uk/sport/cycling/rss.xml", category: "cycling", sourceName: "BBC Sport" },
  { url: "https://www.theguardian.com/sport/cycling/rss", category: "cycling", sourceName: "The Guardian" },
  { url: "https://www.cyclingnews.com/rss/", category: "cycling", sourceName: "Cyclingnews" },
  { url: "http://feeds.bbci.co.uk/sport/golf/rss.xml", category: "golf", sourceName: "BBC Sport" },
  { url: "https://www.theguardian.com/sport/golf/rss", category: "golf", sourceName: "The Guardian" },
  { url: "https://sports.yahoo.com/golf/rss/", category: "golf", sourceName: "Yahoo Sports" },
  // Padel (2026-10-03): no English feed covers it, and the audience is Spanish-speaking
  // (Spain, Argentina, Mexico). Spanish sources, written up in English like every feed,
  // then translated back by the Spanish edition.
  { url: "https://e00-marca.uecdn.es/rss/padel.xml", category: "padel", sourceName: "Marca", language: "es" },
  { url: "https://www.mundodeportivo.com/feed/rss/padel", category: "padel", sourceName: "Mundo Deportivo", language: "es" },
  { url: "https://www.padelspain.net/feed/", category: "padel", sourceName: "PadelSpain", language: "es" },
];

export async function fetchRssNews(): Promise<RawMatchItem[]> {
  const items: RawMatchItem[] = [];
  const foreign: RawMatchItem[] = [];

  for (const feed of FEEDS) {
    // Per-feed item count, logged unconditionally (not just on error) —
    // added 2026-09-23 after discovering the ESPN Olympic-sports feed
    // (sourceName "ESPN", category "athletics") had silently produced
    // zero articles for 3 full days despite the feed itself being live,
    // current, and passing every check when tested directly (real items,
    // real snippets, no dedupe collisions, not excluded). The existing
    // catch block below only logs when parseURL itself throws — it can't
    // explain a feed that "succeeds" from outside this exact runtime (this
    // repo's own dev machine, this sandbox) but silently returns nothing,
    // times out, or gets rate-limited/blocked specifically from GitHub
    // Actions' shared IP range in production, which is the leading
    // suspect here and can't be confirmed without this line existing in
    // the actual run logs. A one-line count per feed, every run, is cheap
    // and makes a repeat of this exact 3-day blind spot impossible.
    const startCount = items.length;
    const feedStart = Date.now();
    try {
      const parsed = await parser.parseURL(feed.url);

      for (const entry of parsed.items ?? []) {
        if (!entry.title || !entry.link) continue;
        if (!acceptsItem(feed, decodeHtmlEntities(entry.title))) continue;

        // Feeds that carry the whole article in content:encoded (CricTracker,
        // CricketAddictor and most WordPress sites) are grounded from it and
        // take its first photo, so no page fetch is needed — page fetches from
        // the ingestion runner can be refused by these sites (2026-09-26: the
        // short description alone was too thin, and the page fetch failed).
        const fullText = feedFullText(entry);
        const image = extractRssImage(entry) ?? feedContentImage(entry);

        (feed.language ? foreign : items).push({
          // Decoded: some feeds (Yahoo Sports) encode titles twice — see htmlEntities.ts.
          title: decodeHtmlEntities(entry.title).trim(),
          // Deliberately NOT reusing entry.contentSnippet (the source's own
          // article text) as our summary — that would republish the
          // publisher's copyrighted prose as if it were our own content.
          // Standard aggregator pattern instead: headline + attribution +
          // link out to the original for the full story.
          summary: `Full coverage from ${feed.sourceName}. Read the original report at the source link below.`,
          // Carried through the pipeline only as grounding input for the
          // optional LLM commentary step (commentary.ts) — never stored or
          // displayed as-is, so it never republishes the source's own prose.
          sourceSnippet: (fullText ?? (entry.contentSnippet ? decodeHtmlEntities(entry.contentSnippet) : undefined))?.slice(0, 3000),
          sourceUrl: entry.link,
          sourceName: feed.sourceName,
          category: feed.category,
          publishedAt: entry.isoDate ? new Date(entry.isoDate) : new Date(),
          heroImageUrl: image?.url,
          heroImageCredit: image?.credit,
          // Stable dedupe key, same mechanism match-data sources already
          // use (see footballData.ts) — confirmed live that a live-
          // updating blog post (same URL, headline changing as the story
          // develops) was creating a fresh duplicate article every time
          // its title changed, since the title+day-bucket hash
          // (dedupe.ts's computeDedupeHash, the fallback when no
          // dedupeKey is set) has no way to recognize it as the same
          // underlying story. The URL itself doesn't change.
          dedupeKey: entry.link,
        });
      }
      console.log(`[rssFeeds] ${feed.sourceName} (${feed.category}, ${feed.url}): ${items.length + foreign.length - startCount} items in ${Date.now() - feedStart}ms`);
    } catch (err) {
      console.error(`RSS fetch failed for ${feed.url}:`, err);
    }
  }

  if (foreign.length > 0) items.push(...(await englishifyForeignItems(foreign)));
  return items;
}