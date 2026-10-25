/**
 * Daily cap on AI write-ups of other outlets' news (2026-10-04).
 *
 * Every ingested news story got a Gemini write-up plus a second substance
 * check: 1,850 stories a day (3,700+ calls), and almost all of them end up
 * noindex (thinContent.ts) because a write-up can only be as long as the
 * source snippet. Until the site earns from ads, the spend is capped.
 *
 * Paced by the hour, not counted over a rolling day: on the day this went
 * in, the last 24 hours already held 1,850 write-ups, so a rolling-day count
 * would have stopped all publishing for ~17 hours. An hourly allowance
 * (dailyCap / 24) has at most a one-hour pause on the first run, then a
 * steady flow, highest-trending first. Stories past the allowance stay
 * unwritten (pending) exactly as when the per-run budget used to run out.
 * Raised from 400 to 700 on 2026-10-05, once the free-tier router (src/lib/llm)
 * took the AI work: about 1,300 good free calls a day is roughly 650 write-ups
 * at two calls each. The original 1,850 is not possible on free tiers. Raise
 * DAILY_NEWS_COMMENTARY_CAP (env) to change it.
 */

export const DEFAULT_DAILY_NEWS_COMMENTARY_CAP = 700;

// Write-ups this run may make: what's left of the hour's allowance, and no
// more than half the allowance in one run so the four runs in an hour share
// it (pure, unit-tested).
export function commentaryRunBudget(dailyCap: number, usedLastHour: number, perRunMax: number): number {
  const hourly = Math.ceil(dailyCap / 24);
  return Math.min(perRunMax, Math.max(0, hourly - usedLastHour), Math.ceil(hourly / 2));
}

// The reserved floors (cricket, the newer minor sports) scaled to this run's
// budget, keeping their share of the old 150-per-run budget (35 and 25)
// (pure, unit-tested).
export function scaledReserve(reserve: number, oldTotal: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.max(1, Math.round((reserve / oldTotal) * budget));
}

// The daily cap from the DAILY_NEWS_COMMENTARY_CAP setting. An unset or empty
// GitHub variable arrives as "" (Number("") is 0, which would stop all
// publishing), so anything that isn't a positive number falls back to the
// default (pure, unit-tested).
export function dailyCommentaryCapFrom(raw: string | undefined): number {
  const n = Number(raw?.trim());
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_NEWS_COMMENTARY_CAP;
}
