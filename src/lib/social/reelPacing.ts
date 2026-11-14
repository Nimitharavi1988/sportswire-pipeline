// How many reels each platform may have out by a given time of day (2026-11-11). The old pacing curve (autoApprove.ts HOURLY_ENGAGEMENT_WEIGHT)
// is built around US evenings and is still what link posts and Instagram use. Reels measured differently on each platform over 45 days:
//   Facebook, main Page: 32-37% of reels posted 06:00-15:00 UTC reached 50 plays, 0-8% of those at 18:00-06:00 UTC (the Page's followers
//     are 92% in India, awake 01:30-18:00 UTC); under the old curve 48% of its reels went out in the dead hours.
//   YouTube, English: reels published 00:00-09:00 UTC had a median of 149-204 views, 15:00-24:00 UTC only 12-41; 40% went out late.
// Each curve is 24 hourly weights (UTC). The daily cap is spread across the day in proportion to them: the expected count by a given time is the
// cap times the share of the day's weight that has passed. The cap itself does not change, a quiet hour is not zero, so a run that is short
// of stories simply catches up later. REEL_PACING=off restores the old curve for Facebook and the flat pacing for YouTube. Pure, unit-tested.

//                                    00   01   02   03   04   05   06  07  08  09  10  11  12  13  14   15   16   17   18   19   20   21   22   23
// 00-04 UTC raised 0.08 -> 0.5 / 0.3 (2026-11-14, user's request): the US evening (6-10 pm Central) gets main-Page reels too, about 4 a day, so the US
// audience can grow; with the cap unchanged, the 06-15 UTC window keeps about 16 of the 24.
export const FACEBOOK_REEL_CURVE = [0.5, 0.5, 0.5, 0.5, 0.3, 0.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.4, 0.4, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08];
export const YOUTUBE_EN_CURVE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06];

export function reelPacingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.REEL_PACING?.trim().toLowerCase() !== "off";
}

// How many of `cap` reels should be out by `now` (fractional): the weight of the hours already gone plus the part of this hour.
export function curveTarget(curve: number[], cap: number, now: Date): number {
  const total = curve.reduce((a, b) => a + b, 0);
  if (total <= 0) return cap;
  const h = now.getUTCHours();
  const done = curve.slice(0, h).reduce((a, b) => a + b, 0) + curve[h] * ((now.getUTCMinutes() + now.getUTCSeconds() / 60) / 60);
  return (cap * done) / total;
}

// Whether one more reel may go out now: fewer already out today than the curve expects by now, plus one so a day can start.
export function curveAllows(curve: number[], cap: number, postedToday: number, now: Date): boolean {
  return postedToday < Math.round(curveTarget(curve, cap, now)) + 1;
}
