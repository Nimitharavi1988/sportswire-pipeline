// DATA_REELS: "off" (default, nothing happens), "dry" (logs what would go out, posts nothing) or "on" (dataReels.ts). Pure, unit-tested.
export type DataReelMode = "off" | "dry" | "on";
export const dataReelMode = (env: Record<string, string | undefined> = process.env): DataReelMode => {
  const v = env.DATA_REELS?.trim().toLowerCase();
  return v === "on" || v === "dry" ? v : "off";
};
