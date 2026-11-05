// Short-lived shared cache for hot, read-only DB results: the Cloudflare edge
// cache (caches.default, per data centre) plus a per-isolate map, so many
// visitors polling the same thing cost one Neon query per TTL instead of one
// each. Both are absent outside the Worker (scripts, tests), where this is a
// plain pass-through. Values must be JSON-safe.
const memo = new Map<string, { value: unknown; expires: number }>();
const MEMO_MAX = 500;

export async function edgeCached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheReq = new Request(`https://db-cache.internal/v1?k=${encodeURIComponent(key)}`);
  try {
    const cached = await edge?.match(cacheReq);
    if (cached) {
      const value = (await cached.json()) as T;
      remember(key, value, ttlS);
      return value;
    }
  } catch {
    // cache unavailable — fall through to the database
  }

  const value = await load();
  remember(key, value, ttlS);
  try {
    await edge?.put(
      cacheReq,
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlS}` } })
    );
  } catch {
    // best effort
  }
  return value;
}

function remember(key: string, value: unknown, ttlS: number) {
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, { value, expires: Date.now() + ttlS * 1000 });
}
