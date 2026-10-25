/**
 * The reel's opening, as a test (2026-10-17). Viewers leave in the first 2 seconds: average watch time is 4.3 s on
 * Instagram and about 5 s on YouTube for a 12-second reel, and the frames from 0 to 2 s were identical (one photo, one
 * hook line, nothing moving) because the photo's zoom and pan are eased in and out over the whole reel, which makes the
 * first seconds almost still (about 1% zoom at 2 s). The "fast" opening moves at once (the eased curve starts steep, an
 * ease-out), brings the first fact in at 2 s instead of 3 s, and sets the hook a little bigger. Half the stories (by
 * article id) get it; the other half keep the classic opening as the control. The variant goes into the decision log, and
 * the engagement project records each reel's average watch time, so the two groups can be compared.
 */
export type Opening = "fast" | "classic";

export const OPENING_TIMING: Record<Opening, { hook: number; fact: number }> = {
  classic: { hook: 3, fact: 2.3 },
  fast: { hook: 2, fact: 2.1 },
};

// How far the photo layer moves over the reel (reel.tsx): total zoom, and how much of the room the zoom frees up it drifts
// across sideways (panX) and upward (panY). The fast opening starts moving at once, so it zooms less in total and barely
// drifts: a face near an edge must stay in frame (full-height crops with a big zoom and a sideways drift lost faces before).
export const OPENING_MOTION: Record<Opening, { zoom: number; panX: number; panY: number }> = {
  classic: { zoom: 0.18, panX: 0.6, panY: 0.3 },
  fast: { zoom: 0.14, panX: 0.3, panY: 0.15 },
};

// The hook text is set this much bigger in the fast opening.
export const FAST_HOOK_SCALE = 1.1;

// The share of reels that get the fast opening. 1 = every reel (decided 2026-10-17, before the comparison finished, to
// move quicker). Set it to 0.5 to go back to a test split with the classic opening as the control.
export const FAST_OPENING_SHARE = 1;

export function openingFor(articleId: string, share: number = FAST_OPENING_SHARE): Opening {
  let h = 0;
  for (const c of `${articleId}|opening`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 10000) / 10000 < share ? "fast" : "classic";
}

// How far the photo's movement has got (0 to 1) at x, the share of the reel played (0 to 1).
export function motionProgress(opening: Opening, x: number): number {
  return opening === "fast" ? 1 - Math.pow(1 - x, 3) : (1 - Math.cos(Math.PI * x)) / 2;
}

// The same curve as an ffmpeg expression over the frame number `in` (commas escaped for the filter graph).
export function motionExpr(opening: Opening, frames: number): string {
  return opening === "fast" ? `(1-pow(1-in/${frames}\\,3))` : `((1-cos(PI*in/${frames}))/2)`;
}
