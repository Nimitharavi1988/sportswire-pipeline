/**
 * Reads match rows for the standard scoreboard (/scores) and turns them
 * into ScoreMatch cards (scoreboardModel.ts). One query for every sport and
 * provider — which sources count as match data comes from
 * matchDataSources.ts, not a per-sport list here.
 */
import { db } from "@/db";
import { article, video } from "@/db/schema";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, like, lte, ne, or, sql } from "drizzle-orm";
import { MATCH_DATA_SOURCE_NAMES } from "../matchDataSources";
import { findNewsBasedCricketMatches } from "../liveCricket";
import { byPriority } from "./priority";
import { dayWindow, type MatchQuery } from "./matchQuery";
import { CRICKET_STALE_MS, toScoreMatch, type MatchRow, type ScoreMatch } from "./scoreboardModel";

// Enough for a busy weekend window across every sport, while keeping the
// query and page payload bounded.
const MAX_ROWS = 800;
const NEWS_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const MATCH_COLUMNS = {
  id: article.id,
  slug: article.slug,
  title: article.title,
  summary: article.summary,
  category: article.category,
  sourceName: article.sourceName,
  scoreSource: article.scoreSource,
  homeTeam: article.homeTeam,
  awayTeam: article.awayTeam,
  homeCrestUrl: article.homeCrestUrl,
  awayCrestUrl: article.awayCrestUrl,
  homeScore: article.homeScore,
  awayScore: article.awayScore,
  homeScoreText: article.homeScoreText,
  awayScoreText: article.awayScoreText,
  matchStatus: article.matchStatus,
  kickoffAt: article.kickoffAt,
  updatedAt: article.updatedAt,
  venue: article.venue,
  seriesLabel: article.seriesLabel,
  leagueLabel: article.leagueLabel,
  matchClock: article.matchClock,
  matchNote: article.matchNote,
  homeRecord: article.homeRecord,
  awayRecord: article.awayRecord,
  broadcast: article.broadcast,
  matchKey: article.matchKey,
};

// Links each finished match to its official highlights video, if any
// (video.matchArticleId, set by youtubeSync). One query for the whole list;
// a failed lookup just leaves the cards without highlights.
async function withHighlights(matches: ScoreMatch[]): Promise<ScoreMatch[]> {
  const ids = matches.filter((m) => m.state === "final").map((m) => m.id);
  if (ids.length === 0) return matches;
  try {
    const rows = await db
      .select({ articleId: video.matchArticleId, youtubeId: video.youtubeId, title: video.title })
      .from(video)
      .where(inArray(video.matchArticleId, ids))
      .orderBy(asc(video.publishedAt));
    const byArticle = new Map(rows.map((r) => [r.articleId, { youtubeId: r.youtubeId, title: r.title }]));
    return matches.map((m) => (byArticle.has(m.id) ? { ...m, highlight: byArticle.get(m.id) } : m));
  } catch (err) {
    console.error("score highlights lookup failed:", err);
    return matches;
  }
}

// The match header on a story page: the same card data, as of now.
export function currentScoreMatch(row: MatchRow): ScoreMatch | null {
  return toScoreMatch(row, new Date());
}

// Fresh cards for specific matches (in-place live updates, see
// liveUpdates.ts). Ids that aren't match rows simply don't come back.
export async function fetchScoreMatchesByIds(ids: string[]): Promise<ScoreMatch[]> {
  if (ids.length === 0) return [];
  const now = new Date();
  const rows = await db
    .select(MATCH_COLUMNS)
    .from(article)
    .where(and(eq(article.status, "published"), inArray(article.id, ids)));
  return withHighlights(rows.flatMap((r) => {
    const m = toScoreMatch(r, now);
    return m ? [m] : [];
  }));
}

// Games kicking off within `windowMs` either side of now, plus any cricket match still
// being updated right now even if it started earlier (a Test runs for days).
// `sport` is a top-level category ("football" also covers "football/...").
export async function fetchScoreboard(opts: { windowMs: number; sport?: string }): Promise<ScoreMatch[]> {
  const now = new Date();
  const from = new Date(now.getTime() - opts.windowMs);
  const to = new Date(now.getTime() + opts.windowMs);
  const sportFilter = opts.sport ? [like(article.category, `${opts.sport}%`)] : [];

  const rows = await db
    .select(MATCH_COLUMNS)
    .from(article)
    .where(and(
      eq(article.status, "published"),
      inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      isNotNull(article.homeTeam),
      isNotNull(article.awayTeam),
      ...sportFilter,
      or(
        and(gte(article.kickoffAt, from), lte(article.kickoffAt, to)),
        and(
          like(article.category, "cricket%"),
          ne(article.matchStatus, "finished"),
          gt(article.updatedAt, new Date(now.getTime() - CRICKET_STALE_MS))
        )
      )
    ))
    .orderBy(asc(article.kickoffAt))
    .limit(MAX_ROWS);

  const matches = rows.flatMap((r) => {
    const m = toScoreMatch(r, now);
    return m ? [m] : [];
  });

  const wantsCricket = !opts.sport || opts.sport === "cricket";
  return withHighlights(wantsCricket ? [...(await newsDerivedCricket(matches, now)), ...matches] : matches);
}

// Big internationals the free CricketData feed doesn't carry still get a
// live card, built from publishers' "LIVE score" headlines (liveCricket.ts)
// — teams and status only, never an invented score.
async function newsDerivedCricket(existing: ScoreMatch[], now: Date): Promise<ScoreMatch[]> {
  const pool = await db
    .select({ id: article.id, slug: article.slug, title: article.title, createdAt: article.createdAt })
    .from(article)
    .where(and(
      eq(article.status, "published"),
      like(article.category, "cricket%"),
      gt(article.createdAt, new Date(now.getTime() - NEWS_LOOKBACK_MS))
    ))
    .orderBy(desc(article.createdAt))
    .limit(200);

  const covered = new Set(
    existing.filter((m) => m.sport === "cricket").map((m) => [m.home.name, m.away.name].sort().join("|"))
  );
  // Live only while "live score" headlines keep arriving: the newest one
  // for the pair must be within CRICKET_STALE_MS, same limit as a
  // CricketData match going quiet. Without this a morning "LIVE score"
  // headline kept the card LIVE for the whole 24h lookback (seen
  // 2026-09-25: England v Sri Lanka still LIVE at 1 AM US time).
  const createdAt = new Map(pool.map((p) => [p.id, p.createdAt]));
  const liveSince = now.getTime() - CRICKET_STALE_MS;
  return findNewsBasedCricketMatches(pool, 10, covered)
    .filter((m) => m.matchState === "live" && (createdAt.get(m.id)?.getTime() ?? 0) >= liveSince)
    .map((m) => ({
      id: m.id,
      slug: m.slug,
      sport: "cricket",
      leagueLabel: "International cricket",
      state: "live" as const,
      clock: null,
      note: "Live — follow the latest coverage",
      kickoffAt: null,
      venue: null,
      broadcast: null,
      matchKey: null,
      source: "News reports",
      updatedAt: (createdAt.get(m.id) ?? now).toISOString(),
      home: { name: m.homeTeam, crestUrl: null, score: null, record: null, winner: false },
      away: { name: m.awayTeam, crestUrl: null, score: null, record: null, winner: false },
    }));
}

// Four days either side: wide enough for a marquee fixture (an India Test
// three days out) to be ranked into the strip. priority.ts penalises minor
// games beyond 36 hours, so they do not crowd it.
const LIVE_NOW_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;


// Homepage panel and the site-wide score strip: most important first
// (priority.ts — live games and big competitions lead, then games starting
// soon, then recent results), same cards and rules as /scores.
export async function fetchLiveNow(opts: { take: number; sport?: string }): Promise<ScoreMatch[]> {
  const matches = await fetchScoreboard({ windowMs: LIVE_NOW_WINDOW_MS, sport: opts.sport });
  // Headline-only live cards (no score feed for that match) trail the rest.
  const detail = (m: ScoreMatch) => (m.state === "live" && m.home.score === null && !m.clock ? 1 : 0);
  const rank = byPriority(Date.now());
  return matches.sort((a, b) => detail(a) - detail(b) || rank(a, b)).slice(0, opts.take);
}

// Matches at one ground (lib/venues.ts matchTerms against Article.venue,
// whole words, not its secondary "B Ground"): the next fixtures and the
// latest results, for the venue page.
export async function fetchVenueMatches(matchTerms: string[], limit = 8): Promise<{ upcoming: ScoreMatch[]; recent: ScoreMatch[] }> {
  const now = new Date();
  // Postgres regex: \y is a word boundary.
  const pattern = "\\y(" + matchTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\y";
  const atVenue = and(
    eq(article.status, "published"),
    inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
    isNotNull(article.kickoffAt),
    sql`${article.venue} ~* ${pattern}`,
    sql`${article.venue} !~* ${"\\yB Ground\\y"}`
  );
  const [upcomingRows, recentRows] = await Promise.all([
    db.select(MATCH_COLUMNS).from(article).where(and(atVenue, gte(article.kickoffAt, now))).orderBy(asc(article.kickoffAt)).limit(limit),
    db.select(MATCH_COLUMNS).from(article).where(and(atVenue, lte(article.kickoffAt, now))).orderBy(desc(article.kickoffAt)).limit(limit),
  ]);
  const cards = (rows: typeof upcomingRows) => rows.flatMap((r) => {
    const m = toScoreMatch(r, now);
    return m ? [m] : [];
  });
  return { upcoming: cards(upcomingRows), recent: cards(recentRows) };
}

// A series' matches (fixtures and results), in date order — background for
// the story editor's AI draft (lib/aiDraft.ts).
export async function fetchSeriesMatches(seriesKey: string, limit = 12): Promise<ScoreMatch[]> {
  const now = new Date();
  const rows = await db
    .select(MATCH_COLUMNS)
    .from(article)
    .where(and(eq(article.status, "published"), eq(article.seriesKey, seriesKey), inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES), isNotNull(article.kickoffAt)))
    .orderBy(asc(article.kickoffAt))
    .limit(limit);
  return rows.flatMap((r) => {
    const m = toScoreMatch(r, now);
    return m ? [m] : [];
  });
}

// Matches for a search (matchQuery.ts): teams or competitions by name, narrowed
// by state, day or sport, most important first. Looks a week back and two weeks
// ahead unless a day word sets the window — wide enough for "India fixtures",
// narrow enough to stay current.
const SEARCH_BACK_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const likeEscape = (w: string) => w.replace(/[\\%_]/g, "\\$&");

export async function searchMatches(query: MatchQuery, take = 8): Promise<ScoreMatch[]> {
  const nowDate = new Date();
  const now = nowDate.getTime();
  const win = query.day ? dayWindow(query.day, now) : { from: now - SEARCH_BACK_MS, to: now + SEARCH_AHEAD_MS };
  // Each word must start a word in the home team, away team or competition:
  // "man" finds Manchester, not Romania.
  const wordMatches = query.words.map((w) => {
    const esc = likeEscape(w);
    const cols = [article.homeTeam, article.awayTeam, article.leagueLabel, article.seriesLabel];
    return or(...cols.flatMap((c) => [ilike(c, `${esc}%`), ilike(c, `% ${esc}%`)]));
  });

  const rows = await db
    .select(MATCH_COLUMNS)
    .from(article)
    .where(and(
      eq(article.status, "published"),
      inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      isNotNull(article.homeTeam),
      isNotNull(article.awayTeam),
      ...(query.sport ? [like(article.category, `${query.sport}%`)] : []),
      ...wordMatches,
      or(
        and(gte(article.kickoffAt, new Date(win.from)), lte(article.kickoffAt, new Date(win.to))),
        // A multi-day cricket match still being updated is on today whatever its start.
        query.day === "today" || query.state === "live"
          ? and(like(article.category, "cricket%"), ne(article.matchStatus, "finished"), gt(article.updatedAt, new Date(now - CRICKET_STALE_MS)))
          : undefined
      )
    ))
    .orderBy(asc(article.kickoffAt))
    .limit(200);

  const inPlay = (m: ScoreMatch) => m.state === "live" || m.state === "paused" || m.state === "started";
  const wanted = (m: ScoreMatch) =>
    !query.state || (query.state === "live" ? inPlay(m) : query.state === "upcoming" ? m.state === "upcoming" : m.state === "final");
  const matches = rows.flatMap((r) => {
    const m = toScoreMatch(r, nowDate);
    return m && wanted(m) ? [m] : [];
  });
  return withHighlights(matches.sort(byPriority(now)).slice(0, take));
}

// A series or event's matches for its hub page: live first, then the rest by
// importance (priority.ts), with highlights where a video is linked.
export async function fetchSeriesScoreboard(seriesKey: string, limit = 24): Promise<ScoreMatch[]> {
  const matches = await fetchSeriesMatches(seriesKey, 80);
  return withHighlights(matches.sort(byPriority(Date.now())).slice(0, limit));
}

// Matches between the given teams (either as home or away) within `days`
// of now — the draft's fixtures when a story is tagged with teams rather
// than a series (the providers don't file every match under a series).
export async function fetchTeamMatches(teamNames: string[], days = 21, limit = 12): Promise<ScoreMatch[]> {
  if (teamNames.length === 0) return [];
  const now = new Date();
  const span = days * 24 * 60 * 60 * 1000;
  const involves = or(inArray(article.homeTeam, teamNames), inArray(article.awayTeam, teamNames));
  const rows = await db
    .select(MATCH_COLUMNS)
    .from(article)
    .where(and(
      eq(article.status, "published"),
      inArray(article.sourceName, MATCH_DATA_SOURCE_NAMES),
      involves,
      gte(article.kickoffAt, new Date(now.getTime() - span)),
      lte(article.kickoffAt, new Date(now.getTime() + span))
    ))
    .orderBy(asc(article.kickoffAt))
    .limit(limit * 3);
  const cards = rows.flatMap((r) => {
    const m = toScoreMatch(r, now);
    return m ? [m] : [];
  });
  // With two or more teams, only their meetings; with one, all its games.
  const both = teamNames.length > 1 ? cards.filter((m) => teamNames.includes(m.home.name) && teamNames.includes(m.away.name)) : cards;
  return both.slice(0, limit);
}
