/**
 * Rate-limit bookkeeping for the AI providers (2026-10-04). Pure functions
 * and a small in-memory pacer, so they are unit-tested with no network and no
 * database; llm/ledgerStore.ts keeps the counts between runs of the job.
 *
 * Free tiers are limits, not prices, so each provider/model slot has a
 * budget: a day's requests and tokens (kept in the ledger, shared by every
 * run of the job) and a per-minute rate (paced in memory). When a slot is
 * out of budget, or the provider says "too many requests", the router moves
 * to the next slot. A provider's own answer always wins over our counts:
 * the free limits are published loosely and change without notice.
 */

export type Priority = "high" | "normal" | "low";

export interface Limits { rpm?: number; rpd?: number; tpm?: number; tpd?: number }

export interface Usage {
  day: string;
  requests: number;
  tokens: number;
  blockedUntil: number;
  strikes: number;
}

// Keyed by budget key ("gemini-free/gemini-flash-lite-latest", "openrouter").
export type Ledger = Record<string, Usage>;

// The share of a daily limit each kind of work may use, so the work that
// matters most (a researched report, a writer's piece) still has room when
// the day's bulk work has used its share.
export const SOFT_CAP: Record<Priority, number> = { high: 0.95, normal: 0.85, low: 0.6 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_TEMPORARY_BLOCK = 3 * HOUR;

// The quota day a time belongs to; providers reset at different hours (UTC).
export function dayKey(now: number, resetHourUtc: number): string {
  return new Date(now - resetHourUtc * HOUR).toISOString().slice(0, 10);
}

export function nextReset(now: number, resetHourUtc: number): number {
  const shifted = now - resetHourUtc * HOUR;
  return Math.floor(shifted / DAY) * DAY + DAY + resetHourUtc * HOUR;
}

// The slot's usage for today, starting a fresh day when the quota day turns.
export function usageFor(ledger: Ledger, key: string, now: number, resetHourUtc: number): Usage {
  const day = dayKey(now, resetHourUtc);
  const current = ledger[key];
  if (current && current.day === day) return current;
  const fresh: Usage = { day, requests: 0, tokens: 0, blockedUntil: 0, strikes: 0 };
  ledger[key] = fresh;
  return fresh;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

// Whether one more request of about `estTokens` fits (pure, unit-tested).
export function checkBudget(u: Usage, limits: Limits, priority: Priority, estTokens: number, now: number): BudgetCheck {
  if (now < u.blockedUntil) return { ok: false, reason: `blocked for another ${Math.ceil((u.blockedUntil - now) / 60_000)} min` };
  if (limits.tpm && estTokens > limits.tpm) return { ok: false, reason: `request (${estTokens} tokens) is over the ${limits.tpm}/min limit` };
  const share = SOFT_CAP[priority];
  if (limits.rpd && u.requests + 1 > Math.floor(limits.rpd * share)) return { ok: false, reason: `daily requests used (${u.requests}/${limits.rpd})` };
  if (limits.tpd && u.tokens + estTokens > limits.tpd * share) return { ok: false, reason: `daily tokens used (${u.tokens}/${limits.tpd})` };
  return { ok: true };
}

export function recordSuccess(u: Usage, tokens: number): void {
  u.requests += 1;
  u.tokens += Math.max(0, Math.round(tokens));
  u.strikes = 0;
}

// The provider said "too many requests". If it named a wait, honour it; if it
// said the day's quota is gone, block until the quota day turns; otherwise
// back off 1, 2, 4... minutes, and treat a fourth strike as the daily quota.
export function recordRateLimit(u: Usage, now: number, resetHourUtc: number, hint: { retryAfterSec?: number; daily?: boolean } = {}): void {
  u.strikes += 1;
  let until: number;
  if (hint.daily && hint.retryAfterSec !== undefined) {
    // The provider named when the allowance returns: believe it (it is often
    // sooner than our guess at the quota day's end), but not past that end.
    until = Math.min(now + hint.retryAfterSec * 1000, nextReset(now, resetHourUtc));
  } else if (hint.daily || u.strikes >= 4) until = nextReset(now, resetHourUtc);
  else {
    const wait = hint.retryAfterSec !== undefined ? hint.retryAfterSec * 1000 : 60_000 * 2 ** (u.strikes - 1);
    until = now + Math.min(Math.max(wait, 5_000), MAX_TEMPORARY_BLOCK);
  }
  u.blockedUntil = Math.max(u.blockedUntil, until);
}

// A temporary failure (server error, timeout, bad output): a short, growing pause.
export function recordTransientFailure(u: Usage, now: number): void {
  u.strikes += 1;
  u.blockedUntil = Math.max(u.blockedUntil, now + Math.min(2 * 60_000 * u.strikes, 30 * 60_000));
}

export function recordBlock(u: Usage, now: number, ms: number): void {
  u.blockedUntil = Math.max(u.blockedUntil, now + ms);
}

// The stored ledger, trusted only as far as its shape: anything damaged or
// hand-edited becomes an empty ledger or loses just the bad entry (pure,
// unit-tested).
export function sanitizeLedger(raw: unknown): Ledger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Ledger = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const u = value as Partial<Usage> | null;
    if (!u || typeof u !== "object" || typeof u.day !== "string") continue;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    out[key] = { day: u.day, requests: n(u.requests), tokens: n(u.tokens), blockedUntil: n(u.blockedUntil), strikes: n(u.strikes) };
  }
  return out;
}

// This process's ledger merged with what another job saved meanwhile (the Reel
// and poster workflows can overlap ingestion): for the same day, the larger
// counts and the later block; the newer day wins; strikes stay this
// process's own (a success resets them, which a "max" would undo) (pure,
// unit-tested).
export function mergeLedgers(local: Ledger, remote: Ledger): Ledger {
  const out: Ledger = { ...local };
  for (const [key, theirs] of Object.entries(remote)) {
    const ours = out[key];
    if (!ours || ours.day < theirs.day) out[key] = theirs;
    else if (ours.day === theirs.day) {
      out[key] = {
        day: ours.day,
        requests: Math.max(ours.requests, theirs.requests),
        tokens: Math.max(ours.tokens, theirs.tokens),
        blockedUntil: Math.max(ours.blockedUntil, theirs.blockedUntil),
        strikes: ours.strikes,
      };
    }
  }
  return out;
}

// Per-minute pacing: how long to wait before a request keeps a slot within
// its requests-per-minute and tokens-per-minute limits (pure given `now`).
export class Pacer {
  private events = new Map<string, { t: number; tokens: number }[]>();

  waitMs(key: string, limits: Limits, estTokens: number, now: number): number {
    const win = (this.events.get(key) ?? []).filter((e) => now - e.t < 60_000);
    this.events.set(key, win);
    let wait = 0;
    if (limits.rpm && win.length >= limits.rpm) wait = Math.max(wait, win[win.length - limits.rpm].t + 60_000 - now);
    if (limits.tpm) {
      const used = win.reduce((n, e) => n + e.tokens, 0);
      let need = used + estTokens - limits.tpm;
      if (need > 0) {
        for (const e of win) {
          need -= e.tokens;
          if (need <= 0) { wait = Math.max(wait, e.t + 60_000 - now); break; }
        }
      }
    }
    return Math.max(0, wait);
  }

  record(key: string, tokens: number, now: number): void {
    const win = (this.events.get(key) ?? []).filter((e) => now - e.t < 60_000);
    win.push({ t: now, tokens });
    this.events.set(key, win);
  }
}

// A rough token count for a prompt plus the reply we expect, for budget
// checks before the real usage is known. A reply is rarely near the maximum
// allowed (a translation is about as long as its source), so it's estimated
// from the prompt and capped by the maximum: assuming 60% of the maximum made
// an 8,192-token translation limit look like 4,900 tokens, five times too
// tight for a per-minute limit like Groq's 8,000.
export function estimateTokens(promptChars: number, maxOutputTokens: number): number {
  const prompt = Math.ceil(promptChars / 3.5);
  return prompt + Math.min(Math.ceil(maxOutputTokens * 0.6), Math.ceil(prompt * 1.2) + 300);
}
