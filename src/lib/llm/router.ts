/**
 * The AI router (2026-10-04): one call, answered by the first provider that
 * has room, so the site's AI work runs on free tiers and costs next to
 * nothing. For each request it walks an ordered chain of provider/model slots
 * (providers.ts), skipping any that are out of daily budget, blocked after an
 * error, or would need a long wait for the per-minute limit; calls the first
 * that is free; checks the answer against the request's schema; and moves on
 * to the next slot on a rate limit, an error or an answer that doesn't fit.
 *
 * Built so it cannot make things worse than not having it: every failure
 * ends in "no answer" (which callers already treat as "try again later"),
 * never an exception; waiting is capped per run; a damaged or slow store
 * only costs the counts; and a paid slot exists only when asked for.
 *
 * Everything outside the network is injected (fetch, clock, sleep, the store
 * that keeps counts between runs) so the whole thing is unit-tested.
 */
import {
  Pacer, checkBudget, estimateTokens, recordBlock, recordRateLimit, recordTransientFailure, usageFor,
  type Ledger, type Priority, type Usage,
} from "./ledger";
import { chainFor, type Slot, type Tier } from "./providers";
import { extractJson, jsonInstruction, validateAgainstSchema, type GeminiSchema } from "./schema";

export interface LedgerStore {
  load(): Promise<Ledger>;
  /** Saves, merging with what another job saved meanwhile; returns the merged ledger. */
  save(ledger: Ledger): Promise<Ledger | void>;
}

export interface RouteRequest {
  prompt: string;
  schema: GeminiSchema;
  tier: Tier;
  priority?: Priority;
  temperature?: number;
  maxOutputTokens?: number;
}

// "rate-limited": every slot was out of room or refused; "invalid": a
// provider answered but not with usable JSON; "none": no slot for this tier.
export type RouteFailure = "rate-limited" | "invalid" | "none";

export interface RouteResult {
  data: unknown | null;
  via?: string;
  failure?: RouteFailure;
  attempts: string[];
}

export interface GroundedRequest {
  prompt: string;
  priority?: Priority;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GroundedResult {
  text: string;
  /** Gemini's groundingMetadata.groundingChunks, for the caller to read sources from. */
  chunks: unknown[] | undefined;
  via: string;
}

type Outcome =
  | { kind: "ok"; text: string; tokens: number; chunks?: unknown[] }
  | { kind: "rate-limit"; retryAfterSec?: number; daily: boolean; detail: string }
  | { kind: "blocked"; ms: number; detail: string }
  | { kind: "transient"; detail: string };

const HOUR = 3_600_000;
const REQUEST_TIMEOUT_MS = 90_000;
// Longest one request will wait for a per-minute limit before trying the next slot.
const MAX_PACING_WAIT_MS = 25_000;
// Longest a whole run (one process) will spend waiting on per-minute limits;
// after that a slot that would need a wait is skipped, so a run's length can't
// be stretched by free-tier pacing.
const DEFAULT_MAX_TOTAL_WAIT_MS = 8 * 60_000;

export interface RouterDeps {
  store?: LedgerStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  maxTotalWaitMs?: number;
  /** Let web research try the free Gemini slots too (LLM_GROUNDED_FREE=1). */
  groundedFree?: boolean;
}

// "Please retry in 1h29m28.163s" in an error message, as seconds (pure, unit-tested).
export function retryInSeconds(text: string): number | undefined {
  const m = text.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Math.ceil(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

// What a failed HTTP answer means (pure, unit-tested).
export function classifyHttpError(status: number, headers: { get(name: string): string | null }, body: string): Outcome {
  const detail = `HTTP ${status}${body ? `: ${body.replace(/\s+/g, " ").slice(0, 140)}` : ""}`;
  if (status === 429) {
    const header = Number(headers.get("retry-after"));
    const fromBody = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const retryAfterSec = Number.isFinite(header) && header > 0 ? header : fromBody ? Math.ceil(Number(fromBody[1])) : retryInSeconds(body);
    return {
      kind: "rate-limit",
      // A wait of a quarter hour or more is a used-up daily allowance, whatever
      // the message calls it (Google's free-tier daily limits say only
      // "limit: 20 ... Please retry in 1h29m").
      daily: /per[- ]?day|daily|\bRPD\b|\bTPD\b/i.test(body) || (retryAfterSec !== undefined && retryAfterSec >= 900),
      retryAfterSec,
      detail,
    };
  }
  if (status === 402) return { kind: "blocked", ms: 6 * HOUR, detail };
  if (status === 401 || status === 403) return { kind: "blocked", ms: 12 * HOUR, detail };
  if (status === 404) return { kind: "blocked", ms: 24 * HOUR, detail };
  return { kind: "transient", detail };
}

export class LlmRouter {
  private ledger: Ledger | null = null;
  private pacer = new Pacer();
  private store?: LedgerStore;
  private fetchFn: typeof fetch;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private log: (message: string) => void;
  private maxTotalWaitMs: number;
  private groundedFree: boolean;
  private waited = 0;
  readonly stats: Record<string, { ok: number; failed: number }> = {};

  constructor(private slots: Slot[], deps: RouterDeps = {}) {
    this.store = deps.store;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = deps.log ?? ((m) => console.log(m));
    this.maxTotalWaitMs = deps.maxTotalWaitMs ?? DEFAULT_MAX_TOTAL_WAIT_MS;
    this.groundedFree = deps.groundedFree ?? false;
  }

  /** Whether any free slot is configured (a paid slot alone doesn't count). */
  hasFreeSlots(): boolean {
    return this.slots.some((s) => !s.paid);
  }

  private async ensureLedger(): Promise<Ledger> {
    if (!this.ledger) {
      try { this.ledger = (await this.store?.load()) ?? {}; } catch { this.ledger = {}; }
    }
    return this.ledger;
  }

  private async persist(): Promise<void> {
    if (!this.ledger || !this.store) return;
    try {
      const merged = await this.store.save(this.ledger);
      // Adopt what another job added, keeping this ledger object (callers hold it).
      if (merged) for (const key of Object.keys(merged)) this.ledger[key] = merged[key];
    } catch { /* the counts are best-effort; the run goes on */ }
  }

  /**
   * Whether `slot` can take this request now: inside its daily budget, not
   * blocked, and (after a short wait if needed) inside its per-minute limits.
   * Returns the slot's counters, or why not.
   */
  private async acquire(slot: Slot, priority: Priority, est: number, blockKind = ""): Promise<{ budget: Usage; block: Usage } | { reason: string }> {
    const ledger = await this.ensureLedger();
    const now = this.now();
    const budget = usageFor(ledger, slot.budgetKey, now, slot.resetHourUtc);
    // Web research has its own block record: a refused search must not block
    // the same model's ordinary answers.
    const block = usageFor(ledger, `block:${slot.id}${blockKind}`, now, slot.resetHourUtc);
    const check = checkBudget(budget, slot.limits, priority, est, now);
    if (!check.ok) return { reason: check.reason };
    const blocked = checkBudget(block, {}, priority, est, now);
    if (!blocked.ok) return { reason: blocked.reason };

    const wait = this.pacer.waitMs(slot.budgetKey, slot.limits, est, now);
    if (wait > MAX_PACING_WAIT_MS || this.waited + wait > this.maxTotalWaitMs) return { reason: `busy for ${Math.ceil(wait / 1000)}s` };
    if (wait > 0) {
      this.waited += wait;
      await this.sleep(wait);
    }
    this.pacer.record(slot.budgetKey, est, this.now());
    return { budget, block };
  }

  /** Writes the outcome of a call that did not produce a usable answer into the counters. */
  private noteFailure(slot: Slot, outcome: Exclude<Outcome, { kind: "ok" }>, budget: Usage, block: Usage): string {
    const stat = (this.stats[slot.id] ??= { ok: 0, failed: 0 });
    stat.failed++;
    const now = this.now();
    if (outcome.kind === "rate-limit") {
      // A daily limit is shared by every model on the account; a short limit
      // is that model's own (free models are often just busy).
      recordRateLimit(outcome.daily ? budget : block, now, slot.resetHourUtc, { retryAfterSec: outcome.retryAfterSec, daily: outcome.daily });
      return `${slot.id}: rate-limited${outcome.daily ? " (daily)" : ""}`;
    }
    if (outcome.kind === "blocked") recordBlock(block, now, outcome.ms);
    else recordTransientFailure(block, now);
    return `${slot.id}: ${outcome.detail}`;
  }

  async json(req: RouteRequest): Promise<RouteResult> {
    const priority = req.priority ?? "normal";
    const est = estimateTokens(req.prompt.length, req.maxOutputTokens ?? 1024);
    const chain = chainFor(this.slots, req.tier, priority);
    const attempts: string[] = [];
    let sawInvalid = false;
    // Slots that had no room or refused, as opposed to answering badly.
    let noRoom = 0;
    if (chain.length === 0) return { data: null, failure: "none", attempts };

    for (const slot of chain) {
      // Paid last, and only once every free slot is used up for the day (or out
      // for a long while): a free slot that was merely busy for a moment is a
      // reason to wait for the next run, not to spend.
      if (slot.paid && !attempts.every(attemptIsExhausted)) {
        attempts.push(`${slot.id}: held back (free providers are busy, not used up)`);
        noRoom++;
        continue;
      }
      const got = await this.acquire(slot, priority, est);
      if ("reason" in got) { attempts.push(`${slot.id}: ${got.reason}`); noRoom++; continue; }
      const { budget, block } = got;
      const outcome = await this.call(slot, req, est);

      if (outcome.kind === "ok") {
        const data = extractJson(outcome.text);
        const problem = data === undefined ? "no JSON in the answer" : validateAgainstSchema(data, req.schema);
        budget.requests += 1;
        budget.tokens += outcome.tokens;
        const stat = (this.stats[slot.id] ??= { ok: 0, failed: 0 });
        if (!problem) {
          block.strikes = 0;
          budget.strikes = 0;
          stat.ok++;
          await this.persist();
          if (attempts.length > 0) this.log(`LLM: answered by ${slot.id} after: ${attempts.join("; ")}`);
          return { data, via: slot.id, attempts };
        }
        sawInvalid = true;
        stat.failed++;
        recordTransientFailure(block, this.now());
        attempts.push(`${slot.id}: invalid answer (${problem})`);
      } else {
        noRoom++;
        attempts.push(this.noteFailure(slot, outcome, budget, block));
      }
      await this.persist();
    }
    this.log(`LLM: no provider could answer (${attempts.join("; ")})`);
    // "invalid" only when every slot that answered gave unusable output and
    // none was merely out of room: then the story, not the capacity, is the
    // problem. Anything else is a reason to wait and try again later.
    return { data: null, failure: sawInvalid && noRoom === 0 ? "invalid" : "rate-limited", attempts };
  }

  /**
   * A web-grounded answer (Gemini with Google Search), for research. Only
   * Gemini slots can do this, and only the paid one: the free project has no
   * Search grounding on Gemini 3 models (measured 2026-10-04: "quota
   * exceeded"; the 1,500-a-day allowance is for 2.5 models, closed to new
   * accounts). Set LLM_GROUNDED_FREE=1 to try the free slots anyway. With no
   * eligible slot this is simply null and research is skipped. The same
   * budgets, blocks and pacing apply.
   */
  async grounded(req: GroundedRequest): Promise<GroundedResult | null> {
    const priority = req.priority ?? "high";
    const est = estimateTokens(req.prompt.length, req.maxOutputTokens ?? 3072);
    const chain = chainFor(this.slots, "standard", "high").filter((s) => s.provider === "gemini" && (s.paid || this.groundedFree));
    const attempts: string[] = [];
    for (const slot of chain) {
      const got = await this.acquire(slot, priority, est, ":grounded");
      if ("reason" in got) { attempts.push(`${slot.id}: ${got.reason}`); continue; }
      const { budget, block } = got;
      const outcome = await this.call(slot, { prompt: req.prompt, schema: { type: "OBJECT" }, tier: "standard", temperature: req.temperature, maxOutputTokens: req.maxOutputTokens }, est, true);
      if (outcome.kind === "ok" && outcome.text.trim()) {
        budget.requests += 1;
        budget.tokens += outcome.tokens;
        block.strikes = 0;
        (this.stats[slot.id] ??= { ok: 0, failed: 0 }).ok++;
        await this.persist();
        return { text: outcome.text, chunks: outcome.chunks, via: slot.id };
      }
      attempts.push(outcome.kind === "ok" ? `${slot.id}: empty answer` : this.noteFailure(slot, outcome, budget, block));
      await this.persist();
    }
    this.log(`LLM: no grounded answer (${attempts.join("; ") || "no Gemini slot"})`);
    return null;
  }

  private async call(slot: Slot, req: RouteRequest, est: number, grounded = false): Promise<Outcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return slot.provider === "gemini"
        ? await this.callGemini(slot, req, est, controller.signal, grounded)
        : await this.callOpenAi(slot, req, est, controller.signal);
    } catch (err) {
      return { kind: "transient", detail: err instanceof Error ? err.message.slice(0, 100) : "network error" };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callGemini(slot: Slot, req: RouteRequest, est: number, signal: AbortSignal, grounded: boolean): Promise<Outcome> {
    const res = await this.fetchFn(`${slot.baseUrl}/models/${slot.model}:generateContent`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "X-goog-api-key": slot.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
        // Search grounding can't be combined with a response schema.
        ...(grounded ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: {
          ...(slot.thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...(grounded ? {} : { responseMimeType: "application/json", responseSchema: req.schema }),
          temperature: req.temperature ?? 0.3,
          maxOutputTokens: req.maxOutputTokens ?? (grounded ? 3072 : 1024),
        },
      }),
    });
    if (!res.ok) return classifyHttpError(res.status, res.headers, await res.text().catch(() => ""));
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = grounded
      ? (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n")
      : candidate?.content?.parts?.[0]?.text ?? "";
    return { kind: "ok", text, tokens: data.usageMetadata?.totalTokenCount ?? est, chunks: candidate?.groundingMetadata?.groundingChunks };
  }

  private async callOpenAi(slot: Slot, req: RouteRequest, est: number, signal: AbortSignal): Promise<Outcome> {
    const send = (withJsonMode: boolean) => this.fetchFn(`${slot.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${slot.apiKey}`, ...slot.extraHeaders },
      body: JSON.stringify({
        model: slot.model,
        messages: [
          { role: "system", content: "You are a precise sports-news assistant. You reply with a single JSON object and nothing else." },
          { role: "user", content: req.prompt + jsonInstruction(req.schema) },
        ],
        temperature: req.temperature ?? 0.3,
        [slot.maxTokensParam ?? "max_tokens"]: req.maxOutputTokens ?? 1024,
        ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(slot.reasoningEffort ? { reasoning_effort: slot.reasoningEffort } : {}),
      }),
    });
    let res = await send(true);
    let body = res.ok ? "" : await res.text().catch(() => "");
    // Some free models reject JSON mode; the schema in the prompt still asks for JSON.
    if (res.status === 400 && /response_format|json/i.test(body)) {
      res = await send(false);
      body = res.ok ? "" : await res.text().catch(() => "");
    }
    if (!res.ok) return classifyHttpError(res.status, res.headers, body);
    const data = await res.json();
    // OpenRouter reports some provider errors inside a 200 answer.
    if (data.error) return classifyHttpError(Number(data.error.code) || 500, res.headers, JSON.stringify(data.error));
    return { kind: "ok", text: data.choices?.[0]?.message?.content ?? "", tokens: data.usage?.total_tokens ?? est };
  }

  /** One line for the job log: calls answered and failed by each slot. */
  summary(): string {
    const parts = Object.entries(this.stats).map(([id, s]) => `${id} ${s.ok} ok/${s.failed} failed`);
    return parts.length ? `LLM router: ${parts.join(", ")}` : "LLM router: no calls";
  }
}

// Whether one failed attempt (the "slot: reason" text in `attempts`) means the
// slot is used up for the day or out for a long while, as opposed to merely
// busy for a moment (a 503, a pacing wait, a short rate limit, a bad answer).
// The paid slot is only used when every free slot ahead of it is used up
// (pure, unit-tested).
const LONG_BLOCK_MIN = 45;
export function attemptIsExhausted(attempt: string): boolean {
  if (/daily requests used|daily tokens used|rate-limited \(daily\)|\/min limit/.test(attempt)) return true;
  const blocked = /blocked for another (\d+) min/.exec(attempt);
  return !!blocked && Number(blocked[1]) >= LONG_BLOCK_MIN;
}
