// Lightweight phase timing for the ingestion cron, so a slow run's log shows
// where the minutes went (added 2026-10-02 after runs grew from ~10 to 17-27
// min with no visible cause). Wrap a call in `timed(label, () => ...)`;
// calls with the same label are summed. `logTimingSummary()` prints one line
// per label, slowest first. Never throws and never changes the result.

const stats = new Map<string, { n: number; totalMs: number; maxMs: number }>();
const startedAt = Date.now();

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    const s = stats.get(label) ?? { n: 0, totalMs: 0, maxMs: 0 };
    s.n += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    stats.set(label, s);
  }
}

export function logTimingSummary(title: string): void {
  const rows = [...stats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
  const total = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[timing] ${title}: ${total}s since process start; slowest steps (summed per label):`);
  for (const [label, s] of rows.slice(0, 15)) {
    console.log(
      `[timing]   ${label.padEnd(34)} n=${String(s.n).padStart(3)} total=${(s.totalMs / 1000).toFixed(1).padStart(6)}s avg=${Math.round(s.totalMs / s.n)}ms max=${Math.round(s.maxMs)}ms`
    );
  }
}
