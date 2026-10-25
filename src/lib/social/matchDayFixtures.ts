import { db } from "@/db";
import { article } from "@/db/schema";
import { and, gte, isNotNull, lte } from "drizzle-orm";
import { MATCH_DAY_AFTER_MS, MATCH_DAY_BEFORE_MS, type Fixture } from "./matchDay";

// The fixtures in the match-day window, from our match rows (all sports). One query per run; a
// failure just means no boost (never blocks posting).
export async function loadMatchDayFixtures(now: Date): Promise<Fixture[]> {
  try {
    const rows = await db
      .selectDistinct({ home: article.homeTeam, away: article.awayTeam, kickoff: article.kickoffAt })
      .from(article)
      .where(and(
        isNotNull(article.kickoffAt), isNotNull(article.homeTeam), isNotNull(article.awayTeam),
        gte(article.kickoffAt, new Date(now.getTime() - MATCH_DAY_AFTER_MS)),
        lte(article.kickoffAt, new Date(now.getTime() + MATCH_DAY_BEFORE_MS)),
      ))
      .limit(600);
    return rows.filter((r): r is { home: string; away: string; kickoff: Date } => Boolean(r.home && r.away && r.kickoff));
  } catch (err) {
    console.error("Match-day fixtures unavailable (no boost this run):", err);
    return [];
  }
}
