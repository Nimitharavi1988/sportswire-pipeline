// Which stories the Instagram reel step should not try again yet (2026-11-10). Each run tries the top few stories of the pool; a story
// skipped for "too old" or "no reel copy" stayed on top, so the same three were tried and skipped every 15 minutes while the rest of the
// pool (hundreds of stories) never got a turn and no reel went out. A story that is too old stays too old; one with no copy may get it
// once the AI is back. Pure, unit-tested.

export interface SkipRow { articleId: string | null; reason: string | null; createdAt: Date }

export const NO_COPY_RETRY_HOURS = 3;
export const TOO_OLD_RETRY_HOURS = 24;

export function reelSkippedIds(rows: SkipRow[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.articleId || !r.reason) continue;
    const hours = (now.getTime() - r.createdAt.getTime()) / 3_600_000;
    if (/^too old/i.test(r.reason) && hours < TOO_OLD_RETRY_HOURS) out.add(r.articleId);
    else if (/^no reel copy/i.test(r.reason) && hours < NO_COPY_RETRY_HOURS) out.add(r.articleId);
  }
  return out;
}
