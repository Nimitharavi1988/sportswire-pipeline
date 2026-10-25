// Sources whose content should never reach pending_review at all, no
// matter how it scores on the usual quality checks (real body length, real
// image, etc.) — a real editorial-judgment call about the source itself,
// not a content-quality gap the normal pipeline can catch. Living config —
// add a source's exact sourceName here when one's flagged.
const EXCLUDED_SOURCES = new Set([
  // Confirmed live (2026-09-16): consistently gossip/reaction-toned pieces
  // ("Justin Herbert's Fiancée Madison Beer Steals Spotlight...", "Gerrit
  // Cole's ABS Excuse Falls Flat") rather than straight sports reporting,
  // reached via the per-player Google News search (playerNewsFeeds.ts) —
  // not a fixed RSS feed, so excluding it here (checked against every
  // source, not just one ingestion pathway) is the only place that
  // actually stops it.
  "Sports Illustrated",
]);

export function isExcludedSource(sourceName: string): boolean {
  return EXCLUDED_SOURCES.has(sourceName);
}
