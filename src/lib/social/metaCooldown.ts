// Instagram answers some accounts' posts with "Application request limit reached". In practice (checked
// 2026-10-13) it hits only the small topic accounts' FEED photo posts, over and over, while the main account
// and every reel never see it. After one such failure, that ONE destination (account + feed/reel) pauses for
// COOLDOWN_MINUTES, then one attempt probes: if it fails, the pause restarts; if it works, posting resumes. A
// skipped attempt records no failed row, so it doesn't use up a Page's daily failure allowance either.
// The pause is per destination: the first version paused ALL Instagram posting on any account's failure, which
// kept the main account's reels switched off (85 a day fell to 15, replaced by feed posts).
export const RATE_LIMIT_MESSAGE = "Application request limit reached";
export const COOLDOWN_MINUTES = 30;

export function cooldownActive(lastLimitFailure: Date | null, now: Date, minutes = COOLDOWN_MINUTES): boolean {
  return lastLimitFailure !== null && now.getTime() - lastLimitFailure.getTime() < minutes * 60_000;
}

// True when an Instagram post to this destination ("main", "reel", "us-sports", "us-sports-reel"...) failed with
// the limit error in the last COOLDOWN_MINUTES.
export async function instagramCoolingDown(destination: string, now: Date = new Date()): Promise<boolean> {
  // Loaded here so the pure rule above can be unit-tested without a database connection.
  const [{ db }, { socialPost }, { and, eq, gte, like }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
  const [row] = await db.select({ at: socialPost.createdAt }).from(socialPost)
    .where(and(
      eq(socialPost.platform, "instagram"),
      eq(socialPost.destination, destination),
      eq(socialPost.status, "failed"),
      like(socialPost.errorMessage, `%${RATE_LIMIT_MESSAGE}%`),
      gte(socialPost.createdAt, new Date(now.getTime() - COOLDOWN_MINUTES * 60_000)),
    ))
    .limit(1);
  return cooldownActive(row?.at ?? null, now);
}
