/**
 * Story Ideas (admin): pieces worth writing now, suggested from data the
 * site already has — big matches just finished (match report), big matches
 * coming up (preview), and players/teams many sources are covering today
 * (analysis). Nothing is published automatically: an idea opens the story
 * editor prefilled (sport, kind, series, tags, a brief for the optional AI
 * draft), and the writer does the rest under their own name. The ingest
 * workflow also turns open ideas into unpublished drafts (stories/autoDraft.ts)
 * that wait in admin for a writer.
 *
 * This file is pure (unit-tested); the database side is storyIdeasData.ts.
 */
import { TRACKED_CLUBS } from "./clubs";
import { TRACKED_COUNTRIES } from "./countries";
import { TRACKED_PLAYERS } from "./players";
import { VENUES } from "./venues";
import { slugifyTeam } from "./scores/matchKey";

export const IDEA_SPORTS = ["cricket", "football", "american-football", "college-football"] as const;
export type IdeaSport = (typeof IDEA_SPORTS)[number];

export type IdeaKind = "report" | "preview" | "trend";

export interface StoryIdea {
  // Stable id: "report:<articleId>", "preview:<articleId>", "trend:player:<slug>".
  key: string;
  kind: IdeaKind;
  sport: IdeaSport;
  headline: string;
  reason: string;
  // Prefills for the story editor.
  storyKind: "report" | "preview" | "analysis";
  seriesKey: string | null;
  tags: { kind: string; slug: string }[];
  brief: string;
  // Recent coverage shown on the idea (and as background for the writer).
  sources: { title: string; slug: string; sourceName: string }[];
  // When it happened / happens — for sorting.
  at: Date;
}

export interface MatchRow {
  id: string;
  category: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  matchStatus: string | null;
  leagueLabel: string | null;
  venue: string | null;
  homeScoreText: string | null;
  awayScoreText: string | null;
  homeScore: number | null;
  awayScore: number | null;
  matchNote: string | null;
  seriesKey?: string | null;
}

export function ideaSport(category: string): IdeaSport | null {
  const top = category.split("/")[0];
  return (IDEA_SPORTS as readonly string[]).includes(top) ? (top as IdeaSport) : null;
}

const wordRe = (terms: string[]) =>
  new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

const clubsFor = (sport: IdeaSport) => TRACKED_CLUBS.filter((c) => (c.sport ?? "football") === sport);

// A tracked club named by this team name ("Arsenal FC", "Ohio State Buckeyes").
export function clubForTeam(team: string, sport: IdeaSport) {
  return clubsFor(sport).find((c) => wordRe(c.searchTerms).test(team)) ?? null;
}

// "Big" enough for an idea: India's men's side; Premier League, Champions
// League and tracked clubs' games (not MLS — every MLS club is tracked, and
// it isn't this site's football audience); every NFL game; tracked college
// programmes.
export function isBigMatch(m: Pick<MatchRow, "category" | "homeTeam" | "awayTeam" | "leagueLabel">): boolean {
  const sport = ideaSport(m.category);
  if (!sport) return false;
  if (sport === "cricket") return m.homeTeam === "India" || m.awayTeam === "India";
  if (sport === "american-football") return true;
  if (sport === "football") {
    if (/premier league|champions league/i.test(m.leagueLabel ?? "")) return true;
    if (/\bMLS\b/.test(m.leagueLabel ?? "")) return false;
  }
  return Boolean(clubForTeam(m.homeTeam, sport) || clubForTeam(m.awayTeam, sport));
}

// Tags for a match: the two sides (country for cricket, club otherwise) and
// the ground when it's one of ours.
export function matchTags(m: Pick<MatchRow, "category" | "homeTeam" | "awayTeam" | "venue">): { kind: string; slug: string }[] {
  const sport = ideaSport(m.category);
  const tags: { kind: string; slug: string }[] = [];
  for (const team of [m.homeTeam, m.awayTeam]) {
    if (sport === "cricket") {
      const country = TRACKED_COUNTRIES.find((c) => c.name.toLowerCase() === team.toLowerCase());
      if (country) tags.push({ kind: "country", slug: country.slug });
    } else if (sport) {
      const club = clubForTeam(team, sport);
      if (club) tags.push({ kind: "club", slug: club.slug });
    }
  }
  const venue = m.venue ? VENUES.find((v) => wordRe(v.matchTerms).test(m.venue!)) : undefined;
  if (venue) tags.push({ kind: "venue", slug: venue.slug });
  return tags;
}

// The editor's series for a match: its own when the row has one (Asian
// Games), else for cricket the most recent series between
// the two sides ("india-vs-west-indies-odi"); options come newest first.
export function seriesForMatch(m: Pick<MatchRow, "category" | "homeTeam" | "awayTeam" | "seriesKey">, options: { key: string }[]): string | null {
  if (m.seriesKey) return m.seriesKey;
  if (ideaSport(m.category) !== "cricket") return null;
  const [a, b] = [slugifyTeam(m.homeTeam), slugifyTeam(m.awayTeam)].sort();
  return options.find((o) => o.key.startsWith(`${a}-vs-${b}-`))?.key ?? null;
}

const TIME_ZONE: Record<IdeaSport, string> = {
  cricket: "Asia/Kolkata",
  football: "Europe/London",
  "american-football": "America/New_York",
  "college-football": "America/New_York",
};

export function matchDay(m: Pick<MatchRow, "category" | "kickoffAt">): string {
  const sport = ideaSport(m.category) ?? "football";
  return m.kickoffAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE[sport] });
}

function scoreLine(m: MatchRow): string | null {
  if (m.homeScoreText || m.awayScoreText) return `${m.homeTeam} ${m.homeScoreText ?? "-"}, ${m.awayTeam} ${m.awayScoreText ?? "-"}`;
  if (m.homeScore != null && m.awayScore != null) return `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`;
  return null;
}

// A finished big match -> a match report idea (pure, unit-tested).
export function reportIdea(m: MatchRow, seriesKey: string | null): StoryIdea {
  const sport = ideaSport(m.category)!;
  const score = scoreLine(m);
  const where = [m.leagueLabel, m.venue].filter(Boolean).join(", ");
  // Cricket's note is the result ("India won by 8 wickets"); elsewhere it's
  // side information (team rankings), so the score leads.
  const result = sport === "cricket" ? m.matchNote : null;
  return {
    key: `report:${m.id}`,
    kind: "report",
    sport,
    headline: `${m.homeTeam} v ${m.awayTeam}`,
    reason: [result ?? score ?? "Finished", matchDay(m)].join(" · "),
    storyKind: "report",
    seriesKey,
    tags: matchTags(m),
    brief: [
      `Match report: ${m.homeTeam} v ${m.awayTeam}, ${matchDay(m)}${where ? ` (${where})` : ""}.`,
      result ? `Result: ${result}.` : null,
      score ? `Score: ${score}.` : null,
      "Lead with the result, then how the match turned, the standout performances and what it means for what comes next.",
    ].filter(Boolean).join(" "),
    sources: [],
    at: m.kickoffAt,
  };
}

// An upcoming big match -> a preview idea (pure, unit-tested).
export function previewIdea(m: MatchRow, seriesKey: string | null): StoryIdea {
  const sport = ideaSport(m.category)!;
  const where = [m.leagueLabel, m.venue].filter(Boolean).join(", ");
  return {
    key: `preview:${m.id}`,
    kind: "preview",
    sport,
    headline: `${m.homeTeam} v ${m.awayTeam}`,
    reason: [matchDay(m), where].filter(Boolean).join(" · "),
    storyKind: "preview",
    seriesKey,
    tags: matchTags(m),
    brief: `Preview: ${m.homeTeam} v ${m.awayTeam}, ${matchDay(m)}${where ? ` (${where})` : ""}. What's at stake, recent form and results, selection questions and what to watch for.`,
    sources: [],
    at: m.kickoffAt,
  };
}

export interface TrendEntity {
  kind: "player" | "club";
  slug: string;
  name: string;
  sport: IdeaSport;
  pattern: RegExp;
}

// Players and teams of the idea sports, with a whole-word title matcher.
export function trendEntities(): TrendEntity[] {
  const players = TRACKED_PLAYERS.flatMap((p) => {
    const sport = ideaSport(p.sport);
    return sport && p.role !== "official" ? [{ kind: "player" as const, slug: p.slug, name: p.name, sport, pattern: wordRe(p.searchTerms) }] : [];
  });
  const clubs = TRACKED_CLUBS.flatMap((c) => {
    const sport = ideaSport(c.sport ?? "football");
    return sport ? [{ kind: "club" as const, slug: c.slug, name: c.name, sport, pattern: wordRe(c.searchTerms) }] : [];
  });
  return [...players, ...clubs];
}

export const TREND_MIN_STORIES = 4;
// One outlet's many posts about a team (Yahoo's college pages) aren't a trend.
export const TREND_MIN_SOURCES = 2;
const TRENDS_PER_SPORT = 3;

// Players/teams in at least TREND_MIN_STORIES of the day's headlines from
// TREND_MIN_SOURCES outlets -> analysis ideas, most-covered first, a few
// per sport so one busy sport can't fill the list (pure, unit-tested).
export function trendIdeas(
  stories: { title: string; slug: string; sourceName: string; category: string; publishedAt: Date }[],
  entities: TrendEntity[],
  limit = 12
): StoryIdea[] {
  const ideas: { idea: StoryIdea; count: number }[] = [];
  for (const e of entities) {
    const hits = stories.filter((s) => ideaSport(s.category) === e.sport && e.pattern.test(s.title));
    if (hits.length < TREND_MIN_STORIES) continue;
    const sources = new Set(hits.map((h) => h.sourceName)).size;
    if (sources < TREND_MIN_SOURCES) continue;
    const latest = hits.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
    ideas.push({ count: hits.length, idea: {
      key: `trend:${e.kind}:${e.slug}`,
      kind: "trend",
      sport: e.sport,
      headline: e.name,
      reason: `${hits.length} stories from ${sources} source${sources === 1 ? "" : "s"} in the last day`,
      storyKind: "analysis",
      seriesKey: null,
      tags: [{ kind: e.kind, slug: e.slug }],
      brief: `Analysis: why ${e.name} is in the news today, and what it means. Today's headlines: ${hits.slice(0, 5).map((h) => `"${h.title}"`).join("; ")}. Add our own view — don't retell the reports.`,
      sources: hits.slice(0, 3).map(({ title, slug, sourceName }) => ({ title, slug, sourceName })),
      at: latest.publishedAt,
    } });
  }
  const perSport = new Map<string, number>();
  return ideas
    .sort((a, b) => b.count - a.count)
    .filter(({ idea }) => {
      const n = perSport.get(idea.sport) ?? 0;
      perSport.set(idea.sport, n + 1);
      return n < TRENDS_PER_SPORT;
    })
    .slice(0, limit)
    .map((i) => i.idea);
}

// Whether an original story already covers a match idea: it names both
// sides and is the same kind, written after (report) or shortly before
// (preview) kickoff.
export function coversMatch(
  story: { title: string; storyKind: string | null; createdAt: Date },
  idea: Pick<StoryIdea, "storyKind" | "at" | "headline">
): boolean {
  const [home, away] = idea.headline.split(" v ");
  const names = (team: string) => wordRe([team, team.split(" ")[0]]);
  if (!names(home).test(story.title) || !names(away).test(story.title)) return false;
  if (story.storyKind !== idea.storyKind) return false;
  const ms = story.createdAt.getTime() - idea.at.getTime();
  return idea.storyKind === "report" ? ms > 0 : ms > -4 * 24 * 60 * 60 * 1000 && ms < 6 * 60 * 60 * 1000;
}
