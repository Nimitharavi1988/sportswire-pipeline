/**
 * The facts a story draft is grounded in: the series' fixtures and results,
 * the ground's details, the tagged players and teams, and recent coverage.
 * Shared by the editor's "Draft with AI" (admin/stories/actions.ts) and the
 * automatic drafts (stories/autoDraft.ts) so both are held to the same facts.
 * No Next.js imports: it also runs on the GitHub Actions runner.
 */
import { db } from "@/db";
import { article } from "@/db/schema";
import { and, desc, eq, gte, isNotNull, notInArray, or } from "drizzle-orm";
import { isKnownTag } from "./tags";
import { STORY_KINDS } from "./stories";
import { fetchSeriesMatches, fetchTeamMatches } from "./scores/scoreboard";
import { readSnapshot, SNAPSHOT_KEYS } from "./snapshots/read";
import { titleMatchesAnyTerm } from "./titleMatch";
import { categoryChipStyle } from "./categoryDisplay";
import { MATCH_DATA_SOURCE_NAMES } from "./matchDataSources";
import { TRACKED_PLAYERS } from "./players";
import { TRACKED_CLUBS } from "./clubs";
import { TRACKED_COUNTRIES } from "./countries";
import { VENUES, type VenueDetails } from "./venues";
import type { DraftFacts } from "./aiDraft";

export interface DraftRequest {
  brief: string;
  category: string;
  storyKind: string;
  seriesKey: string | null;
  tags: { kind: string; slug: string }[];
}

// The series/event label for a key, from the stories already filed under it.
export async function seriesLabelFor(key: string): Promise<string | null> {
  const [row] = await db.select({ label: article.seriesLabel }).from(article)
    .where(and(eq(article.seriesKey, key), isNotNull(article.seriesLabel))).limit(1);
  return row?.label ?? null;
}

export async function gatherDraftFacts(req: DraftRequest): Promise<DraftFacts> {
  const tags = req.tags.filter(isKnownTag);
  const has = (kind: string) => new Set(tags.filter((t) => t.kind === kind).map((t) => t.slug));
  const players = TRACKED_PLAYERS.filter((p) => has("player").has(p.slug));
  const clubs = TRACKED_CLUBS.filter((c) => has("club").has(c.slug));
  const countries = TRACKED_COUNTRIES.filter((c) => has("country").has(c.slug));
  const venues = VENUES.filter((v) => has("venue").has(v.slug));

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "date tbc");
  const [seriesLabel, seriesMatches, venueDetails, recent] = await Promise.all([
    req.seriesKey ? seriesLabelFor(req.seriesKey) : Promise.resolve(null),
    (async () => {
      // The series' matches; else meetings of the tagged teams.
      const bySeries = req.seriesKey ? await fetchSeriesMatches(req.seriesKey) : [];
      return bySeries.length > 0 ? bySeries : fetchTeamMatches([...countries, ...clubs].map((t) => t.name));
    })(),
    Promise.all(venues.map(async (v) => ({ v, d: await readSnapshot<VenueDetails>(SNAPSHOT_KEYS.venue(v.slug)) }))),
    (async () => {
      const terms = [...players, ...clubs, ...countries].flatMap((t) => t.searchTerms).concat(venues.flatMap((v) => v.matchTerms));
      const about = [...(terms.length ? [titleMatchesAnyTerm(terms)] : []), ...(req.seriesKey ? [eq(article.seriesKey, req.seriesKey)] : [])];
      if (about.length === 0) return [];
      return db.select({ title: article.title, summary: article.summary, publishedAt: article.publishedAt }).from(article)
        .where(and(eq(article.status, "published"), notInArray(article.sourceName, MATCH_DATA_SOURCE_NAMES), gte(article.publishedAt, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)), or(...about)))
        .orderBy(desc(article.publishedAt)).limit(8);
    })(),
  ]);

  const fixtures = seriesMatches.map((m) => {
    const where = m.venue ? ` at ${m.venue}` : "";
    const result = m.state === "final" ? `: ${m.home.name} ${m.home.score ?? ""} / ${m.away.name} ${m.away.score ?? ""}${m.note ? ` — ${m.note}` : ""}` : m.state === "upcoming" ? " (upcoming)" : ` (in progress${m.note ? `: ${m.note}` : ""})`;
    return `${fmtDate(m.kickoffAt)}: ${m.home.name} vs ${m.away.name}${where}${result}`;
  });

  return {
    brief: req.brief,
    kindLabel: STORY_KINDS[req.storyKind as keyof typeof STORY_KINDS] ?? "Analysis",
    sportLabel: categoryChipStyle(req.category).label,
    seriesLabel,
    fixtures,
    venues: venueDetails.map(({ v, d }) => ({ name: `${v.name}, ${v.city}`, about: d?.extract ?? "" })),
    people: [...countries.map((c) => `${c.name} (team)`), ...clubs.map((c) => `${c.name} (team)`), ...players.map((p) => `${p.name} (player)`)],
    recentStories: recent.map((r) => ({ title: r.title, summary: r.summary.slice(0, 280), date: r.publishedAt ? fmtDate(r.publishedAt.toISOString()) : "" })),
  };
}

// Whether there's real material to write from — a piece with none would be
// all [ADD: …] notes, which isn't worth a writer's time.
export function hasGroundingFacts(f: DraftFacts): boolean {
  return f.fixtures.length > 0 || f.recentStories.length > 0;
}
