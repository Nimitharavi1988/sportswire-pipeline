// Ordering for the Instagram Reel candidates. The picker (autoApprove.ts)
// gave cricket, hockey and F1 a reserved slot ahead of everything else, so
// with one attempt per run the reel was always one of those (2026-09-28: 14
// reels in a row were hockey roster news, plus minor domestic cricket match
// rows). Reels are now ordered by trending score with two demotions, each a
// move to the back of the queue rather than an exclusion:
//   - a sport that already made maxRecent of the last reels
//   - a templated match-result row (a scoreline, little to say in a reel)
export function orderForVariety<T extends { category: string; sourceName: string }>(
  candidates: T[],
  recentCategories: string[],
  isMatchSource: (sourceName: string) => boolean,
  maxRecent = 3
): T[] {
  const sportOf = (category: string) => category.split("/")[0];
  const counts = new Map<string, number>();
  for (const c of recentCategories) counts.set(sportOf(c), (counts.get(sportOf(c)) ?? 0) + 1);
  const tier = (a: T) => ((counts.get(sportOf(a.category)) ?? 0) >= maxRecent ? 1 : 0) + (isMatchSource(a.sourceName) ? 1 : 0);
  return candidates
    .map((a, i) => ({ a, i, t: tier(a) }))
    .sort((x, y) => x.t - y.t || x.i - y.i)
    .map((x) => x.a);
}
