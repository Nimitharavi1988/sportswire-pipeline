/**
 * Decision log: one row per reel/Short decision (posted, failed or skipped, and why), with the features the post was
 * made with (sport, story age, hour, colour theme, music, caption variant, hook...). The automation's own record of
 * what it did, so a later analysis system can join it with the engagement numbers (reach, views, followers) and learn
 * what works, and so a skipped reel is no longer a silent gap. Best-effort: a logging problem must never stop a post.
 * Table: PostDecision (scripts/sql/2026-10-16-post-decision.sql).
 */
import { createId } from "@paralleldrive/cuid2";

export interface Decision {
  articleId?: string | null;
  platform: "facebook" | "instagram" | "youtube";
  destination: string;
  kind: "reel" | "short" | "photo";
  outcome: "posted" | "failed" | "skipped";
  reason?: string;
  features?: Record<string, unknown>;
  externalPostId?: string | null;
}

export async function logDecision(d: Decision): Promise<void> {
  try {
    // Loaded here so the pure parts of this module can be tested without a database connection.
    const [{ db }, { postDecision }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await db.insert(postDecision).values({
      id: createId(),
      articleId: d.articleId ?? null,
      platform: d.platform,
      destination: d.destination,
      kind: d.kind,
      outcome: d.outcome,
      reason: d.reason ? d.reason.slice(0, 400) : null,
      features: d.features ?? null,
      externalPostId: d.externalPostId ?? null,
    });
  } catch (err) {
    console.warn("[decision-log] could not record:", err instanceof Error ? err.message : err);
  }
}

// The features of the reel being posted, set by postReel once they are known and read by recordAttempt, so the
// post-and-record code needs no extra arguments. It only applies to the article it was set for.
let context: { articleId: string; features: Record<string, unknown> } | null = null;
export const setDecisionContext = (articleId: string, features: Record<string, unknown>) => { context = { articleId, features }; };
export const clearDecisionContext = () => { context = null; };
export const decisionContextFor = (articleId: string): Record<string, unknown> | undefined => (context?.articleId === articleId ? context.features : undefined);
