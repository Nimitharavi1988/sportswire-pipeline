// Instagram answers some accounts' posts with "Application request limit reached". In practice (checked
// 2026-10-13) it hits only the small topic accounts' FEED photo posts, over and over, while the main account
// and every reel never see it. After one such failure, that ONE destination (account + feed/reel) pauses for
// COOLDOWN_MINUTES, then one attempt probes: if it fails, the pause restarts; if it works, posting resumes. A
// skipped attempt records no failed row, so it doesn't use up a Page's daily failure allowance either.
// The pause is per destination: the first version paused ALL Instagram posting on any account's failure, which
// kept the main account's reels switched off (85 a day fell to 15, replaced by feed posts).
export const RATE_LIMIT_MESSAGE = "Application request limit reached";
// Instagram's account-level action block (2026-11-14: four main reels in a row between 11:57 and 12:13 UTC, two of them US reels at the
// start of the US morning) is the same kind of limit and gets the same pause; it was not matched, so every run tried again and failed.
export const LIMIT_MESSAGES = [RATE_LIMIT_MESSAGE, "User is performing too many actions"];
export const COOLDOWN_MINUTES = 30;

// True for an error message that is one of Meta's limits (pure, unit-tested).
export const isLimitError = (message: string | null | undefined): boolean => LIMIT_MESSAGES.some((m) => (message ?? "").includes(m));

export function cooldownActive(lastLimitFailure: Date | null, now: Date, minutes = COOLDOWN_MINUTES): boolean {
  return lastLimitFailure !== null && now.getTime() - lastLimitFailure.getTime() < minutes * 60_000;
}

// True when an Instagram post to this destination ("main", "reel", "us-sports", "us-sports-reel"...) failed with
// the limit error in the last COOLDOWN_MINUTES.
export async function instagramCoolingDown(destination: string, now: Date = new Date()): Promise<boolean> {
  // Loaded here so the pure rule above can be unit-tested without a database connection.
  const [{ db }, { socialPost }, { and, eq, gte, like, or }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
  const [row] = await db.select({ at: socialPost.createdAt }).from(socialPost)
    .where(and(
      eq(socialPost.platform, "instagram"),
      eq(socialPost.destination, destination),
      eq(socialPost.status, "failed"),
      or(...LIMIT_MESSAGES.map((m) => like(socialPost.errorMessage, `%${m}%`))),
      gte(socialPost.createdAt, new Date(now.getTime() - COOLDOWN_MINUTES * 60_000)),
    ))
    .limit(1);
  return cooldownActive(row?.at ?? null, now);
}
