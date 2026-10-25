import crypto from "crypto";

/**
 * Deduplication rule (from the plan's pre-development checklist):
 * hash on normalized headline + date window, so the same story pulled
 * from two different sources (e.g. football-data.org fixture + an RSS
 * recap of the same match) doesn't get stored/posted twice.
 *
 * This is intentionally simple for MVP — normalize the title, strip
 * punctuation/casing, and bucket by day. Tighten this later (e.g. add
 * team-name extraction) if near-duplicate headlines slip through.
 */
export function computeDedupeHash(title: string, publishedAt: Date): string {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const dayBucket = publishedAt.toISOString().slice(0, 10); // YYYY-MM-DD

  return crypto
    .createHash("sha256")
    .update(`${normalizedTitle}|${dayBucket}`)
    .digest("hex");
}

// For sources with a stable per-event identifier (e.g. ESPN's NFL game id).
// The title+date hash above breaks for preview articles whose title embeds
// a human-readable kickoff date: if the upstream API revises a not-yet-played
// game's scheduled time (real, observed ESPN behavior as broadcast slots get
// finalized close to game week), the title and day-bucket both change, and
// the same game gets ingested a second time as a "new" article instead of
// being recognized as the one already stored. Hashing the stable id instead
// sidesteps that entirely.
export function computeStableDedupeHash(stableId: string): string {
  return crypto.createHash("sha256").update(stableId).digest("hex");
}
