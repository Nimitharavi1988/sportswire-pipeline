/**
 * A small worker pool for the ingest item loop (2026-10-05). Each item spends
 * most of its time waiting (page fetch, AI write-up, substance check), and the
 * loop handled them one at a time, so a run took 5-10 minutes. This runs up to
 * `limit` items at once, started in the order given (highest priority first).
 *
 * Items that share a key (the same dedupe hash or match key) never run at the
 * same time, so two copies of one story can't both be created, and the later
 * one still sees the first's result. An item whose key is busy is skipped over
 * for now and started as soon as the key frees.
 *
 * The first error stops new items from starting; the ones in flight finish,
 * then the error is thrown (the loop it replaces threw on the first error).
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  keysOf: (item: T) => string[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const pending = [...items];
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  let failure: { error: unknown } | null = null;

  while ((pending.length > 0 && !failure) || running.size > 0) {
    while (!failure && running.size < Math.max(1, limit)) {
      const i = pending.findIndex((it) => keysOf(it).every((k) => !busy.has(k)));
      if (i < 0) break;
      const [item] = pending.splice(i, 1);
      const keys = keysOf(item);
      keys.forEach((k) => busy.add(k));
      const p: Promise<void> = fn(item)
        .catch((error) => { failure ??= { error }; })
        .finally(() => {
          keys.forEach((k) => busy.delete(k));
          running.delete(p);
        });
      running.add(p);
    }
    if (running.size === 0) break;
    await Promise.race(running);
  }
  if (failure) throw (failure as { error: unknown }).error;
}
