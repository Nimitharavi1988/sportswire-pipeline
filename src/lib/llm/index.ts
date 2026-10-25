/**
 * The shared AI router for the site's jobs (2026-10-04), switched on by
 * LLM_ROUTER=1. Off by default: the jobs then call Gemini exactly as before.
 * Keys, all optional (a provider without its key is simply not used):
 *   GEMINI_FREE_API_KEY  a Google project with NO billing (the free tier)
 *   GROQ_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, OLLAMA_BASE_URL (+ OLLAMA_MODEL)
 *   GEMINI_API_KEY       the billed project: used only if LLM_PAID_DAILY_CALLS > 0
 *   LLM_DISABLE          providers to switch off, e.g. "groq,openrouter"
 * See providers.ts for the free limits each slot assumes.
 */
import { LlmRouter, type LedgerStore } from "./router";
import { buildSlots, pickOpenRouterFree } from "./providers";
import { mergeLedgers, sanitizeLedger, type Ledger } from "./ledger";

const LEDGER_KEY = "llm:ledger";
// A slow database must cost the counts, never stall a run.
const STORE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("ledger store timed out")), STORE_TIMEOUT_MS))]);
}

// Counts kept in the DataSnapshot table, so every step of every run of the
// ingest job sees the same day's usage.
async function createStore(): Promise<LedgerStore | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  const [{ db }, { dataSnapshot }, { eq }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
  const read = async (): Promise<Ledger> => {
    const [row] = await db.select({ data: dataSnapshot.data }).from(dataSnapshot).where(eq(dataSnapshot.key, LEDGER_KEY)).limit(1);
    return sanitizeLedger(row?.data);
  };
  return {
    load: () => withTimeout(read()),
    async save(ledger) {
      return withTimeout((async () => {
        // Another job (the Reel or poster workflow) may have saved since we loaded.
        const merged = mergeLedgers(ledger, await read());
        await db.insert(dataSnapshot).values({ key: LEDGER_KEY, data: merged, sourceUrl: "internal:llm", fetchedAt: new Date() })
          .onConflictDoUpdate({ target: dataSnapshot.key, set: { data: merged, fetchedAt: new Date() } });
        return merged;
      })());
    },
  };
}

let routerPromise: Promise<LlmRouter | null> | null = null;

/** The router, or null when it's off or has no free provider configured. Never throws. */
export function getRouter(): Promise<LlmRouter | null> {
  routerPromise ??= (async () => {
    try {
      if (process.env.LLM_ROUTER !== "1") return null;
      let openRouterModels: string[] = [];
      if (process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_FREE_MODELS) {
        try {
          const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
          openRouterModels = pickOpenRouterFree(((await res.json()) as { data?: never[] }).data ?? []);
        } catch (err) {
          console.error("LLM router: couldn't read OpenRouter's model list:", err);
        }
      }
      const router = new LlmRouter(buildSlots(process.env, openRouterModels), {
        store: await createStore().catch(() => undefined),
        maxTotalWaitMs: process.env.LLM_MAX_TOTAL_WAIT_MS ? Number(process.env.LLM_MAX_TOTAL_WAIT_MS) : undefined,
        groundedFree: process.env.LLM_GROUNDED_FREE === "1",
      });
      if (!router.hasFreeSlots()) {
        console.warn("LLM router: LLM_ROUTER=1 but no free provider has a key — using the Gemini key directly.");
        return null;
      }
      process.once("exit", () => console.log(router.summary()));
      return router;
    } catch (err) {
      console.error("LLM router: setup failed, using the Gemini key directly:", err);
      return null;
    }
  })();
  return routerPromise;
}
