// How much more (or less) a sport's stories are preferred for the main Instagram reel (2026-11-11). Measured over 526 main-account reels in
// 12 days: a typical Formula 1 reel got 789 views against 140 overall (33 reels, 6% of the volume), WNBA 170, football 130. The weight
// multiplies a story's selection score for ORDERING reel candidates only: the stored trending score, the link posts and every other
// ranking are untouched, and a much bigger story in another sport can still win. REEL_SPORT_WEIGHTS ("formula-1:1.8,wnba:1.2") overrides
// the defaults; "off" turns the weighting off. Pure, unit-tested.

// College football and basketball added 2026-11-13 for YouTube (English Shorts, 45 days, 48+ hours old: college football averaged 331 views with 48% reaching
// 200, basketball 271, against 139 for cricket and 82 for baseball). A story is posted to Instagram, Facebook and YouTube together, so this one ordering
// serves all three; Instagram is flat for these two sports (a typical 140), so the boost is small and costs it nothing.
export const DEFAULT_REEL_SPORT_WEIGHTS: Record<string, number> = { "formula-1": 1.8, wnba: 1.2, "college-football": 1.2, basketball: 1.1 };

export function reelSportWeights(raw: string | undefined): Record<string, number> {
  const text = raw?.trim();
  if (text === undefined || text === "") return DEFAULT_REEL_SPORT_WEIGHTS;
  if (text.toLowerCase() === "off") return {};
  const out: Record<string, number> = {};
  for (const part of text.split(",")) {
    const [sport, value] = part.split(":").map((s) => s.trim());
    const n = Number(value);
    if (sport && Number.isFinite(n) && n > 0 && n <= 5) out[sport] = n;
  }
  return out;
}

export function reelSportWeight(category: string, weights: Record<string, number>): number {
  return weights[category.split("/")[0]] ?? 1;
}
