import { db } from "@/db";
import { article } from "@/db/schema";
import { and, eq, like, gt, desc } from "drizzle-orm";
import { isInternationalFormat } from "./ingestion/cricketCountries";

// Cricket's ingestion (cricketData.ts) pulls "currentMatches" — matches
// already underway, not fixed-future fixtures like football/NFL. Their
// kickoffAt is in the past (the match already started) but matchStatus
// isn't "finished" either (no result yet). Football/NFL never fetch an
// in-play state at all, so a past kickoffAt there just means the FINISHED
// poll hasn't landed yet, not a genuine in-progress match — this is
// deliberately cricket-only.
// Real fan interest skews heavily toward international cricket (England vs
// Pakistan, India vs Australia) over the many concurrent domestic franchise
// matches (CPL, BBL, various T20 leagues) that otherwise flood this list and
// bury the international game further down the carousel. Uses
// isInternationalFormat (title terminology: T20I/ODI/Test) rather than
// matchCountry (cricketCountries.ts) — matchCountry is deliberately curated
// for flag-display safety and excludes Afghanistan (politically contested
// flag) and West Indies (no single national flag), which would silently
// misclassify a real India vs Afghanistan international as "domestic" and
// bury it. Format terminology has no such gap: only genuine internationals
// are ever labeled T20I/ODI/Test.
function isInternationalMatch(title: string): boolean {
  return isInternationalFormat(title);
}

// A match still genuinely live in CricketData.org's currentMatches feed gets
// touched every ~15-min poll (see runIngest.ts's duplicate-handling branch).
// Once a match actually finishes, CricketData.org typically stops returning
// it as "current" at all — so its row here just stops being touched forever,
// with no explicit "finished" signal we can rely on. Without this cutoff, a
// long-finished match sat stuck showing a score hours (in one confirmed
// case, 8+) out of date. 90 minutes is a generous multiple of the 15-min
// poll interval — enough to absorb a missed cron tick or two without
// mistaking a genuinely live match (which should update every cycle, even
// during a lunch/rain break) for a stale one.
const LIVE_STALENESS_CUTOFF_MS = 90 * 60 * 1000;

// International-first, stable within each half (not a re-sort by date) —
// international matches keep their existing order, just moved ahead of every
// domestic match rather than interleaved with them.
function internationalFirst<T extends { title: string }>(matches: T[]): T[] {
  const international = matches.filter((m) => isInternationalMatch(m.title));
  const domestic = matches.filter((m) => !isInternationalMatch(m.title));
  return [...international, ...domestic];
}

// Recent finished results stay useful (a Test's result is worth showing for
// a while after it ends) without accumulating forever — 3 days of
// post-finish relevance. Deliberately measured from updatedAt (when we last
// touched the row, i.e. roughly when it was detected as finished), not
// kickoffAt (when it started) — a multi-day Test can easily run 4-5 days
// past its kickoff, so a kickoffAt-based cutoff was excluding exactly the
// international Tests it's meant to highlight right at the moment they
// finished. Confirmed live: an England vs Pakistan 3rd Test correctly
// flipped to "finished" but had already aged out of a kickoffAt-based
// window by the time it did.
const RESULT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

const SELECT = {
  id: article.id, slug: article.slug, title: article.title, summary: article.summary,
  homeTeam: article.homeTeam, awayTeam: article.awayTeam,
  homeCrestUrl: article.homeCrestUrl, awayCrestUrl: article.awayCrestUrl,
  homeScoreText: article.homeScoreText, awayScoreText: article.awayScoreText,
  kickoffAt: article.kickoffAt,
};

export type CricketMatchStatus = "live" | "upcoming" | "finished";

// CricketData.org's free API tier doesn't carry every bilateral series (the
// India vs Afghanistan T20Is, confirmed live via a direct DB check, never
// appeared in it at all) — so structured scores above can be entirely
// missing for a real, currently-live international. Rather than showing
// nothing, this derives a lightweight scoreboard entry straight from the
// RSS headlines themselves: publishers like Hindustan Times re-publish a
// fresh "LIVE Score" title as the match progresses, so the latest headline
// IS a genuine live update even with no numeric score field. Deliberately
// restricted to full-member country names (not club/franchise names) to
// avoid false-positive pairings from domestic league headlines.
const TEAM_CODES: Record<string, string> = {
  IND: "India", AUS: "Australia", ENG: "England", PAK: "Pakistan", SA: "South Africa",
  NZ: "New Zealand", SL: "Sri Lanka", BAN: "Bangladesh", AFG: "Afghanistan", ZIM: "Zimbabwe",
  IRE: "Ireland", SCO: "Scotland", NED: "Netherlands", NEP: "Nepal", UAE: "UAE", USA: "USA",
};
const FULL_NAMES = new Set(Object.values(TEAM_CODES));

function resolveTeamToken(token: string): string | null {
  const t = token.trim();
  if (TEAM_CODES[t.toUpperCase()]) return TEAM_CODES[t.toUpperCase()];
  if (FULL_NAMES.has(t)) return t;
  // extractInternationalPair's regex captures up to the first comma/colon —
  // when that's not immediately after the team token, it swallows the next
  // word(s) too (e.g. "SL Highlights," from "IND vs SL Highlights, Women's
  // Asia Cup Final..."). Confirmed live: this silently dropped a genuine
  // finished-match article (no team pair recognized) and left an OLDER
  // still-"LIVE" article as the pair's latest classified result — a real
  // finished match stuck showing live. Falling back to just the first word
  // (or first two, for "South Africa"/"New Zealand"-style names) recovers
  // the real team without loosening the exact-match check itself.
  const words = t.split(/\s+/);
  if (words.length > 1) {
    const twoWord = words.slice(0, 2).join(" ");
    if (FULL_NAMES.has(twoWord)) return twoWord;
    const first = words[0];
    if (TEAM_CODES[first.toUpperCase()]) return TEAM_CODES[first.toUpperCase()];
    if (FULL_NAMES.has(first)) return first;
  }
  return null;
}

// Matches "IND vs AFG LIVE Score, ..." / "India vs Afghanistan, 1st T20I" —
// team tokens sit between the start of the title and the first comma/colon/
// status word, so both plain names and abbreviations resolve the same way.
function extractInternationalPair(title: string): { home: string; away: string } | null {
  const m = title.match(/^\s*([A-Za-z .]{2,20}?)\s+v(?:s\.?)?\s+([A-Za-z .]{2,20}?)(?:\s*[,:]|\s+LIVE\b|\s+Live\b|$)/);
  if (!m) return null;
  const home = resolveTeamToken(m[1]);
  const away = resolveTeamToken(m[2]);
  if (!home || !away || home === away) return null;
  return { home, away };
}

function classifyNewsStatus(title: string): CricketMatchStatus | null {
  const lower = title.toLowerCase();
  // Checked before "live" — confirmed live: a real post-match wrap-up
  // ("IND vs AFG Highlights... India cruise to seven-wicket win") matched
  // none of the original finished-keywords (no "won by"/"win by" — real
  // headlines say "seven-wicket win", "cruise to a win", etc., not that
  // exact phrasing), so it fell through as unclassified and got skipped by
  // the caller, leaving an OLDER still-"LIVE"-titled article as the latest
  // classified result — a real finished match stuck showing "LIVE" with no
  // staleness cutoff at all, unlike the structured-data path above.
  // "Highlights"/"recap" are unambiguous post-match-only words no preview
  // or in-progress headline would ever use.
  if (/\b(highlights|recap|beat|beats|won by|win by|wins by|clinch|seal|as it happened)\b/.test(lower)) return "finished";
  if (/\blive\b/.test(lower)) return "live";
  if (/\b(preview|set to face|will face|squad announced|series begins|to begin)\b/.test(lower)) return "upcoming";
  return null;
}

const NEWS_MATCH_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type NewsPoolRow = { id: string; slug: string; title: string };

// Every other headline about a match's two teams from the same recent pool
// used for match detection above — the "more news around this match" list.
// Substring match on team name (not the strict "starts with Team vs Team"
// pattern extractInternationalPair needs) deliberately catches real
// coverage that pattern misses, e.g. "Abhishek's zen mode destroys
// Afghanistan" or "Abhishek Sharma hits fastest T20I century by an Indian"
// — neither starts with "India vs Afghanistan", but both are clearly about
// that match and should surface as related reading once the match itself
// is found some other way (structured score data, or a differently-worded
// headline that does match the strict pattern). Newest first — during a
// live/just-finished match, what just happened is more relevant than an
// older pre-match story.
function relatedNewsFor(home: string, away: string, excludeId: string, pool: NewsPoolRow[], take = 3): NewsPoolRow[] {
  return pool
    .filter((r) => r.id !== excludeId && (r.title.includes(home) || r.title.includes(away)))
    .slice(0, take);
}

export function findNewsBasedCricketMatches(
  pool: NewsPoolRow[],
  take: number,
  excludePairs: Set<string>
): Array<{ id: string; slug: string; summary: string; homeTeam: string; awayTeam: string; homeCrestUrl: null; awayCrestUrl: null; homeScoreText: null; awayScoreText: null; kickoffAt: null; matchState: CricketMatchStatus; isNewsDerived: true; relatedArticles: NewsPoolRow[] }> {
  const byPair = new Map<string, { id: string; slug: string; home: string; away: string; state: CricketMatchStatus; title: string }>();
  for (const r of pool) {
    const pair = extractInternationalPair(r.title);
    if (!pair) continue;
    const key = [pair.home, pair.away].sort().join("|");
    if (excludePairs.has(key) || byPair.has(key)) continue; // rows already sorted newest-first — first hit per pair wins
    const state = classifyNewsStatus(r.title);
    if (!state) continue;
    byPair.set(key, { id: r.id, slug: r.slug, home: pair.home, away: pair.away, state, title: r.title });
  }

  return Array.from(byPair.values())
    .slice(0, take)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      summary: r.title,
      homeTeam: r.home,
      awayTeam: r.away,
      homeCrestUrl: null,
      awayCrestUrl: null,
      homeScoreText: null,
      awayScoreText: null,
      kickoffAt: null,
      matchState: r.state,
      isNewsDerived: true,
      relatedArticles: relatedNewsFor(r.home, r.away, r.id, pool),
    }));
}

// A Google/ESPN-style scoreboard: matches already underway (status: "live"),
// matches CricketData.org's currentMatches feed already knows about but
// hasn't started yet (status: "upcoming" — that feed isn't a full fixtures
// list days out, just whatever it's currently tracking, but a match it
// already knows about pre-kickoff is worth showing), and recently concluded
// matches with a real result (status: "finished"). Ordered live, then
// finished, then upcoming — most time-sensitive/interesting first.
export async function fetchLiveCricketMatches(take: number) {
  const now = new Date();
  const [scheduled, finishedRaw, pool] = await Promise.all([
    db.select(SELECT).from(article).where(and(
      eq(article.status, "published"),
      like(article.category, "cricket%"),
      eq(article.matchStatus, "scheduled"),
      gt(article.updatedAt, new Date(now.getTime() - LIVE_STALENESS_CUTOFF_MS))
    )).orderBy(desc(article.kickoffAt)).limit(take),
    db.select(SELECT).from(article).where(and(
      eq(article.status, "published"),
      like(article.category, "cricket%"),
      eq(article.matchStatus, "finished"),
      gt(article.updatedAt, new Date(now.getTime() - RESULT_LOOKBACK_MS))
    )).orderBy(desc(article.kickoffAt)).limit(take),
    // One shared pool of recent cricket headlines, reused both to detect
    // news-only matches (findNewsBasedCricketMatches) and to attach a
    // "more on this match" list to EVERY match below, structured or not —
    // a single query instead of one per match card.
    db.select({ id: article.id, slug: article.slug, title: article.title }).from(article).where(and(
      eq(article.status, "published"),
      like(article.category, "cricket%"),
      gt(article.createdAt, new Date(Date.now() - NEWS_MATCH_LOOKBACK_MS))
    )).orderBy(desc(article.createdAt)).limit(200),
  ]);

  const live = internationalFirst(scheduled.filter((m) => m.kickoffAt !== null && m.kickoffAt <= now));
  const upcomingSorted = scheduled
    .filter((m) => m.kickoffAt !== null && m.kickoffAt > now)
    .sort((a, b) => a.kickoffAt!.getTime() - b.kickoffAt!.getTime());
  const upcoming = internationalFirst(upcomingSorted);
  const finished = internationalFirst(finishedRaw);

  const coveredPairs = new Set(
    [...scheduled, ...finishedRaw]
      .filter((m) => m.homeTeam && m.awayTeam)
      .map((m) => [m.homeTeam, m.awayTeam].sort().join("|"))
  );
  const newsBased = findNewsBasedCricketMatches(pool, take, coveredPairs);
  const newsLive = newsBased.filter((m) => m.matchState === "live");
  const newsFinished = newsBased.filter((m) => m.matchState === "finished");
  const newsUpcoming = newsBased.filter((m) => m.matchState === "upcoming");

  // Related news attached for live/finished matches only — an upcoming
  // fixture usually has no real coverage of ITS play yet (nothing has
  // happened), so a related-news list there would mostly be noise from
  // either team's unrelated recent stories rather than genuine buildup.
  const withRelated = <T extends { homeTeam: string | null; awayTeam: string | null; id: string }>(m: T) => ({
    ...m,
    relatedArticles: m.homeTeam && m.awayTeam ? relatedNewsFor(m.homeTeam, m.awayTeam, m.id, pool) : [],
  });

  return [
    ...newsLive,
    ...live.map((m) => ({ ...withRelated(m), matchState: "live" as const })),
    ...newsFinished,
    ...finished.slice(0, take).map((m) => ({ ...withRelated(m), matchState: "finished" as const })),
    ...newsUpcoming,
    ...upcoming.map((m) => ({ ...m, matchState: "upcoming" as const, relatedArticles: [] })),
  ];
}
