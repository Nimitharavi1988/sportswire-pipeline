import { db } from "@/db";
import { article, articleTag } from "@/db/schema";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { TRACKED_PLAYERS, type TrackedPlayer } from "./players";
import { TRACKED_CLUBS, type TrackedClub } from "./clubs";
import { TRACKED_COUNTRIES, type TrackedCountry } from "./countries";
import { VENUES, type Venue } from "./venues";

// Database side of story tags (ArticleTag) — server only. The tag list
// itself (kinds, options) is lib/tagOptions.ts, which the browser can use.
export { TAG_KINDS, tagOptions, tagGroupLabel, isKnownTag, type TagKind, type TagOption } from "./tagOptions";
import type { TagKind } from "./tagOptions";

// "This story is tagged with it" as a WHERE condition on Article, for the
// player/club/country/venue pages (OR'd with their headline matching).
export function taggedWith(kind: TagKind, slug: string): SQL {
  return inArray(
    article.id,
    db.select({ id: articleTag.articleId }).from(articleTag).where(and(eq(articleTag.kind, kind), eq(articleTag.slug, slug)))
  );
}

export interface StoryTags {
  players: TrackedPlayer[];
  clubs: TrackedClub[];
  countries: TrackedCountry[];
  venues: Venue[];
}

export async function fetchStoryTags(articleId: string): Promise<StoryTags> {
  const rows = await db.select({ kind: articleTag.kind, slug: articleTag.slug }).from(articleTag).where(eq(articleTag.articleId, articleId));
  const has = (kind: TagKind) => new Set(rows.filter((r) => r.kind === kind).map((r) => r.slug));
  const players = has("player");
  const clubs = has("club");
  const countries = has("country");
  const venues = has("venue");
  return {
    players: TRACKED_PLAYERS.filter((p) => players.has(p.slug)),
    clubs: TRACKED_CLUBS.filter((c) => clubs.has(c.slug)),
    countries: TRACKED_COUNTRIES.filter((c) => countries.has(c.slug)),
    venues: VENUES.filter((v) => venues.has(v.slug)),
  };
}
