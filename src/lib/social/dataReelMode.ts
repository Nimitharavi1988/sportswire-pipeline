// DATA_REELS: "off" (default, nothing happens), "dry" (logs what would go out, posts nothing) or "on" (dataReels.ts). Pure, unit-tested.
export type DataReelMode = "off" | "dry" | "on";
export const dataReelMode = (env: Record<string, string | undefined> = process.env): DataReelMode => {
  const v = env.DATA_REELS?.trim().toLowerCase();
  return v === "on" || v === "dry" ? v : "off";
};

// Stats and chart reels together, per UTC day, counted on the main Page (2026-11-14, user's choice): in their first 11 hours they posted
// 14, on top of the normal reels, and the feed read as "too many graph reels". At most one per sport (matchStats.ts STATS_DAILY_CAP).
export const DATA_REELS_DAILY_CAP = 4;
// How many more may go out today (pure, unit-tested).
export const dataReelRoom = (usedToday: number, cap: number = DATA_REELS_DAILY_CAP): number => Math.max(0, cap - usedToday);
