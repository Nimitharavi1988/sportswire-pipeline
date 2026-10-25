/**
 * The AI providers the router can use, and which models serve which work
 * (2026-10-04). Aim: spend nothing. Every slot here is a free tier (or a
 * local model); a paid slot exists only when LLM_PAID_DAILY_CALLS is set above
 * 0, as a hard-capped last resort.
 *
 * Free limits, as published or reported on 2026-10-04 (they change without
 * notice, which is why the router also obeys each provider's own "too many
 * requests" answers, and every number can be overridden by an env var):
 *  - Gemini API free tier (a Google project WITHOUT billing): Google does not
 *    publish it; read from its own error on 2026-10-04: Flash allows only 20
 *    requests a day. Flash-Lite (AI Studio, Rate limits, free project): 15
 *    requests/min, 250K tokens/min, 500 requests/day. Google Search grounding
 *    was refused on the free key ("quota exceeded"), so web research needs
 *    the paid slot.
 *  - Groq: limits are per model: 30 requests/min, 1,000/day, 8,000
 *    tokens/min, 200,000 tokens/day each on gpt-oss-20b, gpt-oss-120b and
 *    qwen3.8-27b (console.groq.com/docs/rate-limits). Llama 3.x left the free
 *    tier on 16 Aug 2026.
 *  - OpenRouter free models: 20 requests/min and 50 requests/day for the
 *    whole account (1,000/day after a one-time $10 credit purchase).
 *  - Hugging Face's free tier is ~$0.10 a month: not used. Ollama is only
 *    used when OLLAMA_BASE_URL points at a machine that is on.
 */
import type { Limits } from "./ledger";

export type Tier = "lite" | "standard";

export type Provider = "gemini" | "openai";

// One provider/model that can answer. `budgetKey` is where its usage is
// counted: per model for Gemini and Groq, per account for OpenRouter.
export interface Slot {
  id: string;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  tiers: Tier[];
  limits: Limits;
  budgetKey: string;
  resetHourUtc: number;
  paid: boolean;
  // Gemini Flash spends output tokens on hidden reasoning unless told not
  // to; Flash-Lite rejects that setting (see ingestion/commentary.ts).
  thinkingOff?: boolean;
  // Only for high-priority work (and first in line for it): the strong models
  // with the smallest daily allowances.
  highOnly?: boolean;
  // Position in a tier's chain where it differs from the order slots are
  // listed in (lower is earlier).
  order?: Partial<Record<Tier, number>>;
  // OpenAI-style options.
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  reasoningEffort?: "low";
  extraHeaders?: Record<string, string>;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

export const GEMINI_LITE = "gemini-flash-lite-latest";
export const GEMINI_STANDARD = "gemini-flash-latest";

// Gemini's daily quota turns at midnight Pacific (07:00-08:00 UTC); Groq and
// OpenRouter at midnight UTC.
const GEMINI_RESET_HOUR_UTC = 8;

// LLM_DISABLE="groq,openrouter" switches providers off without a code change
// (a provider misbehaving, or a key to rotate): names are gemini-free, groq,
// openrouter, ollama, gemini-paid.
export function buildSlots(env: Record<string, string | undefined>, openRouterModels: string[] = []): Slot[] {
  const off = [...new Set((env.LLM_DISABLE ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  // A name matches any slot whose id contains it: "groq", "gemma", "gemini-free".
  return buildAllSlots(env, openRouterModels).filter((s) => !off.some((t) => s.id.toLowerCase().includes(t)));
}

function buildAllSlots(env: Record<string, string | undefined>, openRouterModels: string[]): Slot[] {
  const slots: Slot[] = [];
  const gemini = (key: string, id: string, model: string, tiers: Tier[], limits: Limits, paid: boolean, thinkingOff: boolean, extra: Partial<Slot> = {}): Slot => ({
    id, provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: key, model, tiers, limits,
    budgetKey: `${paid ? "gemini-paid" : "gemini-free"}/${model}`, resetHourUtc: GEMINI_RESET_HOUR_UTC, paid, thinkingOff, ...extra,
  });

  // The free Gemini project's limits, read from AI Studio's Rate limits page on
  // 2026-10-04. Each MODEL has its own allowance (as with Groq's), which is
  // what lets one project carry the site's bulk work:
  //   Gemini 3.5 and 3.1 Flash-Lite   15 requests/min, 250K tokens/min, 500 a day each
  //   Gemma 4 31B and 26B             30 requests/min, 16K tokens/min, 14,400 a day each
  //   Gemini 3.5 to 3.8 Flash         5 requests/min, 250K tokens/min, 20 a day each
  // (Gemini 2.5 models are closed to new accounts, and Gemini 3 has no free
  // Search grounding, so web research needs the paid slot.)
  // The 2026-10-04 test (10 write-ups and 5 Spanish translations per model, on
  // real stories, judged by Gemini) decided the order:
  //   3.5 Flash-Lite  quality 4.8, 0% invented figures, 1.4 s a call, translations ok
  //   3.1 Flash-Lite  quality 5.0, translations 3 of 3 ok, 10-27 s a call
  //   gpt-oss-120b    quality 4.9, translations 3 of 3 ok, 12 s
  //   Qwen            quality 4.7, translations ok/minor, 22-50 s
  //   Gemma 4         the 14,400-a-day looks big, but 16K tokens a minute and
  //                   long "thinking" meant only 4 of 10 write-ups (31B) or 6
  //                   of 10 (26B) came back, with stalls of minutes: last resort.
  const freeKey = env.GEMINI_FREE_API_KEY;
  if (freeKey) {
    const lite = (id: string, model: string): Slot => gemini(freeKey, id, model, ["lite", "standard"],
      { rpm: num(env.GEMINI_FREE_LITE_RPM, 14), rpd: num(env.GEMINI_FREE_LITE_RPD, 500), tpm: num(env.GEMINI_FREE_LITE_TPM, 240000) }, false, false);
    slots.push(lite("gemini-free lite", GEMINI_LITE));
    slots.push(lite("gemini-free lite31", "gemini-3.1-flash-lite"));
  }

  const groqKey = env.GROQ_API_KEY;
  if (groqKey) {
    const groq = (model: string, tiers: Tier[]): Slot => ({
      id: `groq ${model}`, provider: "openai", baseUrl: "https://api.groq.com/openai/v1", apiKey: groqKey, model, tiers,
      limits: { rpm: num(env.GROQ_RPM, 28), rpd: num(env.GROQ_RPD, 1000), tpm: num(env.GROQ_TPM, 8000), tpd: num(env.GROQ_TPD, 200000) },
      budgetKey: `groq/${model}`, resetHourUtc: 0, paid: false, maxTokensParam: "max_completion_tokens",
      ...(model.startsWith("openai/gpt-oss") ? { reasoningEffort: "low" as const } : {}),
    });
    // Each model has its own daily allowance. gpt-oss-120b was the best Groq
    // model in the 2026-10-04 test (a translation rated "ok" 3 times in 3) and
    // leads standard work; gpt-oss-20b was dropped (muddled facts, left words
    // untranslated); Qwen is sound but slow (22-50 s a call).
    slots.push({ ...groq("openai/gpt-oss-120b", ["lite", "standard"]), order: { standard: -1 } });
    slots.push(groq("qwen/qwen3.8-27b", ["lite", "standard"]));
  }

  // Mistral's free plan (checked 2026-10-04 with the account's own limits page
  // and live calls): ministral-14b-2512 answers (30 requests/min, ~940k
  // tokens/min); mistral-small-2603 is limited to 0 and mistral-large to
  // "not allowed" on this plan, so only the Ministral model is used. A smaller
  // model than Groq's 120B, so it follows Groq and precedes OpenRouter.
  // rpd 4000 (was 1000, which the first day of use reached by evening): the
  // plan limits are per minute and per month, not a small daily count; about
  // 900k tokens a day is well inside a monthly allowance. Watch the ledger.
  const mistralKey = env.MISTRAL_API_KEY;
  if (mistralKey) {
    slots.push({
      id: "mistral ministral-14b-2512", provider: "openai", baseUrl: "https://api.mistral.ai/v1", apiKey: mistralKey,
      model: "ministral-14b-2512", tiers: ["lite", "standard"],
      limits: { rpm: num(env.MISTRAL_RPM, 28), rpd: num(env.MISTRAL_RPD, 4000), tpm: num(env.MISTRAL_TPM, 800000) },
      budgetKey: "mistral/ministral-14b-2512", resetHourUtc: 0, paid: false, maxTokensParam: "max_tokens",
    });
  }

  // ministral-8b-2512: its own allowance on the same free plan (188 requests a
  // minute, tested 2026-10-06) and valid JSON on a test call, so it adds
  // throughput after the 14B when that one is busy. ministral-3b answered the
  // same test with a JSON shape that ignored the instruction, so it is not used.
  if (mistralKey) {
    slots.push({
      id: "mistral ministral-8b-2512", provider: "openai", baseUrl: "https://api.mistral.ai/v1", apiKey: mistralKey,
      model: "ministral-8b-2512", tiers: ["lite", "standard"],
      limits: { rpm: num(env.MISTRAL_8B_RPM, 150), rpd: num(env.MISTRAL_8B_RPD, 4000), tpm: num(env.MISTRAL_8B_TPM, 500000) },
      budgetKey: "mistral/ministral-8b-2512", resetHourUtc: 0, paid: false, maxTokensParam: "max_tokens",
    });
  }

  const orKey = env.OPENROUTER_API_KEY;
  if (orKey) {
    const orLimits: Limits = { rpm: num(env.OPENROUTER_RPM, 18), rpd: num(env.OPENROUTER_RPD, 50) };
    const configured = (env.OPENROUTER_FREE_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    for (const model of (configured.length ? configured : openRouterModels).slice(0, 4)) {
      slots.push({
        id: `openrouter ${model}`, provider: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: orKey, model, tiers: ["lite", "standard"],
        limits: orLimits, budgetKey: "openrouter", resetHourUtc: 0, paid: false, maxTokensParam: "max_tokens",
        extraHeaders: { "HTTP-Referer": env.SITE_URL ?? "https://sportswirelive.com", "X-Title": "Sports Wire Live" },
      });
    }
  }

  // Last resort before giving up (see the test results above).
  if (freeKey) {
    const gemma = (id: string, model: string): Slot => gemini(freeKey, id, model, ["lite", "standard"],
      { rpm: num(env.GEMINI_FREE_GEMMA_RPM, 28), rpd: num(env.GEMINI_FREE_GEMMA_RPD, 14000), tpm: num(env.GEMINI_FREE_GEMMA_TPM, 15000) }, false, false);
    slots.push(gemma("gemini-free gemma31", "gemma-4-31b-it"));
    slots.push(gemma("gemini-free gemma26", "gemma-4-26b-a4b-it"));
  }

  // Four strong Flash models with 20 requests a day each: 80 a day for the work
  // that matters most (researched reports, fact-checks, drafts), which asks for
  // them with "high" priority; other work never touches them.
  if (freeKey) {
    for (const model of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]) {
      slots.push(gemini(freeKey, `gemini-free flash${model.replace(/\D/g, "")}`, model, ["standard"],
        { rpm: num(env.GEMINI_FREE_FLASH_RPM, 4), rpd: num(env.GEMINI_FREE_FLASH_RPD, 20) }, false, true, { highOnly: true }));
    }
  }

  if (env.OLLAMA_BASE_URL) {
    const model = env.OLLAMA_MODEL ?? "llama3.1:8b";
    slots.push({
      id: `ollama ${model}`, provider: "openai", baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/$/, "")}/v1`, apiKey: "ollama", model, tiers: ["lite"],
      limits: {}, budgetKey: "ollama", resetHourUtc: 0, paid: false, maxTokensParam: "max_tokens",
    });
  }

  // Hard-capped, off unless asked for: the billed Gemini project.
  const paidCalls = num(env.LLM_PAID_DAILY_CALLS, 0);
  if (paidCalls > 0 && env.GEMINI_API_KEY) {
    slots.push(gemini(env.GEMINI_API_KEY, "gemini-paid lite", GEMINI_LITE, ["lite"], { rpd: paidCalls }, true, false));
    slots.push(gemini(env.GEMINI_API_KEY, "gemini-paid flash", GEMINI_STANDARD, ["standard"], { rpd: paidCalls }, true, true));
  }
  return slots;
}

// The slots that may answer a request of this tier and priority, best first:
// high-priority work gets the strong low-allowance models first and other
// work never sees them; otherwise the order buildSlots lists them in (or a
// slot's own `order` for the tier); any paid slot is always last.
export function chainFor(slots: Slot[], tier: Tier, priority: "high" | "normal" | "low" = "normal"): Slot[] {
  return slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.tiers.includes(tier) && (!s.highOnly || priority === "high"))
    .sort((a, b) => Number(a.s.paid) - Number(b.s.paid)
      || Number(!!b.s.highOnly) - Number(!!a.s.highOnly)
      || (a.s.order?.[tier] ?? a.i) - (b.s.order?.[tier] ?? b.i)
      || a.i - b.i)
    .map(({ s }) => s);
}

// Free OpenRouter text models that can return JSON, best first, from its
// public model list (pure, unit-tested). The list changes every few weeks, so
// it is read at run time rather than hard-coded.
interface OpenRouterModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

export function pickOpenRouterFree(models: OpenRouterModel[]): string[] {
  // nemotron: in the 2026-10-04 test it returned no JSON on 3 of 5 write-ups
  // and took up to two minutes a call.
  const AVOID = /safety|guard|code|omni|preview|stealth|audio|image|vision|embed|lyria|content|nemotron/i;
  const PREFER = /qwen3|gemma-4|gpt-oss|llama-3\.3|deepseek/i;
  return models
    .filter((m) => m.id.endsWith(":free") && Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
    .filter((m) => !AVOID.test(m.id) && (m.context_length ?? 0) >= 32_000)
    .filter((m) => (m.supported_parameters ?? []).some((p) => p === "response_format" || p === "structured_outputs"))
    .sort((a, b) => Number(PREFER.test(b.id)) - Number(PREFER.test(a.id))
      || Number((b.supported_parameters ?? []).includes("structured_outputs")) - Number((a.supported_parameters ?? []).includes("structured_outputs")))
    .map((m) => m.id);
}
