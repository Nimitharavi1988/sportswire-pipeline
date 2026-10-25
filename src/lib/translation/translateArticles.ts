import { hasRealImage } from "../contentQuality";
import { db } from "@/db";
import { article, articleTranslation } from "@/db/schema";
import { isMatchDataSource } from "../matchDataSources";
import { isThinRewrite } from "../thinContent";
import { and, count, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { callGemini, aiUnavailableReason, MODEL } from "../ingestion/commentary";
import { enabledLocales, type LocaleConfig } from "../i18n/locales";
import { applyDailyCaps, applyThinCap, checkTranslation, priorityScore, slugFromTitle, sourceHash, type Fields } from "./checks";
import { reviewTranslation, type Review } from "./review";
import { submitToIndexNow } from "../indexNow";
import { liveLocales, localeOrigin } from "../i18n/liveLocales";

// Translation stage of the Spanish site (PLAN.md). Runs on the GitHub Actions
// runner right after auto-approve, as its own step: translating at request
// time is impossible on the Worker's 10ms CPU budget, and a failure here must
// never touch ingestion or posting. Only PUBLISHED articles are translated, so
// rejected items never cost anything.
//
//   TRANSLATION_LOCALES=es npx tsx src/lib/translation/translateArticles.ts [--dry-run]
//
// Env: TRANSLATION_LOCALES (kill switch; unset = no-op), TRANSLATE_MAX_PER_RUN
// (default 30), TRANSLATE_WINDOW_HOURS (default 48: new articles, plus matches kicking off from window start to +72h -- no backlog backfill).

const RETRY_MODEL = "gemini-flash-latest"; // lite first (cheaper); flagged items retry once here
const MAX_ATTEMPTS = 3;
const MIN_BODY_CHARS = 200;

export function buildPrompt(locale: LocaleConfig, f: Fields, feedback: string[] = []): string {
  return `You are a professional sports-news translator. Translate the article below from English into ${locale.promptName}.

Rules:
- Faithful translation only: do not add, drop, or change any fact, number, score, date, quote or name. Do not summarise.
- Keep names of people, teams, clubs, leagues, venues and competitions as they are normally written (do not translate "Manchester United", "Lakers", etc.).
- Keep the paragraph structure (blank lines) of the body exactly.
- Translate EVERY field completely, including the whole body.
${locale.glossary.map((g) => `- ${g}`).join("\n")}
- Return JSON with title, summary, body.
${feedback.length ? "\nA previous attempt at this translation was rejected for these problems — avoid them:\n" + feedback.map((x) => `- ${x}`).join("\n") + "\n" : ""}
TITLE: ${f.title}

SUMMARY: ${f.summary}

BODY:
${f.body}`;
}

async function translateOnce(locale: LocaleConfig, f: Fields, model?: string, feedback: string[] = []): Promise<Fields | null> {
  const parsed = await callGemini(buildPrompt(locale, f, feedback), {
    ...(model ? { model } : {}),
    temperature: 0.2,
    maxOutputTokens: 8192,
    retries: 4,
    responseSchema: {
      type: "OBJECT",
      properties: { title: { type: "STRING" }, summary: { type: "STRING" }, body: { type: "STRING" } },
      required: ["title", "summary", "body"],
    },
  });
  if (!parsed || typeof parsed.title !== "string" || typeof parsed.summary !== "string" || typeof parsed.body !== "string") return null;
  return { title: parsed.title.trim(), summary: parsed.summary.trim(), body: parsed.body.trim() };
}

// Short write-ups of other outlets' news (thinContent.ts) are what
// locale.thinDailyCap limits. Match score cards are left to their sport's
// daily cap: they are short by nature, not a cost problem, and an untranslated
// card sends a Spanish visitor to the English page.
type CappedFields = { sourceName: string; title: string; body: string | null; summary: string | null };
const isCappedThin = (a: CappedFields) => isThinRewrite(a) && !isMatchDataSource(a.sourceName);

// New translations in the last hour of stories under that cap. Paced by the
// hour, not counted over a rolling day: the day this went in, the last 24
// hours already held ~545, so a rolling-day count would have stopped every
// new Spanish rewrite for ~20 hours.
async function thinTranslatedLastHour(locale: string): Promise<{ plain: number; photo: number }> {
  try {
    const rows = await db
      .select({ sourceName: article.sourceName, title: article.title, body: article.body, summary: article.summary, heroImageUrl: article.heroImageUrl, homeCrestUrl: article.homeCrestUrl })
      .from(articleTranslation)
      .innerJoin(article, eq(article.id, articleTranslation.articleId))
      .where(and(eq(articleTranslation.locale, locale), eq(articleTranslation.status, "translated"), gte(articleTranslation.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
    const thin = rows.filter(isCappedThin);
    const photo = thin.filter(hasRealImage).length;
    return { plain: thin.length - photo, photo };
  } catch {
    return { plain: 0, photo: 0 };
  }
}

export async function translateArticles(opts: { dryRun?: boolean } = {}): Promise<{ translated: number; failed: number; skipped: number }> {
  const locales = enabledLocales();
  if (locales.length === 0) {
    console.log("Translation: TRANSLATION_LOCALES not set — nothing to do.");
    return { translated: 0, failed: 0, skipped: 0 };
  }
  const maxPerRun = Number(process.env.TRANSLATE_MAX_PER_RUN ?? 30);
  const windowStart = new Date(Date.now() - Number(process.env.TRANSLATE_WINDOW_HOURS ?? 48) * 60 * 60 * 1000);
  // One-off backfill (TRANSLATE_BACKFILL=1, with a wide TRANSLATE_WINDOW_HOURS and a
  // large TRANSLATE_MAX_PER_RUN): news only, per-sport limits from the locale's
  // backfillCaps for the whole run instead of the rolling daily caps. Idempotent:
  // already-translated articles are skipped, so it can simply be re-run.
  const backfill = process.env.TRANSLATE_BACKFILL === "1";
  // TRANSLATE_ONLY_CATEGORIES="volleyball,rugby": limit this run to those sports
  // (e.g. a backfill after an edition adds sports) instead of all of its sports.
  const onlyCategories = (process.env.TRANSLATE_ONLY_CATEGORIES ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  let translated = 0, failed = 0, skipped = 0;
  const newUrls: Record<string, string[]> = {}; // per-edition URLs to ping IndexNow with once the run is done

  for (const locale of locales) {
    const candidates = await db
      .select({
        id: article.id, category: article.category, title: article.title, summary: article.summary, body: article.body,
        trendingScore: article.trendingScore, sourceName: article.sourceName,
        heroImageUrl: article.heroImageUrl, homeCrestUrl: article.homeCrestUrl,
      })
      .from(article)
      .where(and(
        eq(article.status, "published"),
        inArray(article.category, onlyCategories.length > 0 ? locale.categories.filter((c) => onlyCategories.includes(c)) : locale.categories),
        isNotNull(article.body),
        // New articles in the window, plus match articles whose kickoff is within
        // [window start, +72h] (previews becoming results). NOT plain updatedAt: that is
        // bumped across the whole archive and would turn this into a backlog backfill.
        or(gte(article.createdAt, windowStart), and(gte(article.kickoffAt, windowStart), lte(article.kickoffAt, new Date(Date.now() + 72 * 60 * 60 * 1000)))),
      ));

    // Existing rows, read separately (and tolerantly in dry-run, so the job can
    // be previewed before the table exists).
    let existing: { articleId: string; sourceHash: string; status: string; attempts: number; slug: string | null }[] = [];
    try {
      existing = candidates.length === 0 ? [] : await db
        .select({
          articleId: articleTranslation.articleId, sourceHash: articleTranslation.sourceHash,
          status: articleTranslation.status, attempts: articleTranslation.attempts, slug: articleTranslation.slug,
        })
        .from(articleTranslation)
        .where(and(eq(articleTranslation.locale, locale.code), inArray(articleTranslation.articleId, candidates.map((c) => c.id))));
    } catch (err) {
      if (!opts.dryRun) throw err;
      console.log("Translation: ArticleTranslation table not found (dry-run) — treating as empty.");
    }
    const byArticle = new Map(existing.map((e) => [e.articleId, e]));

    // New translations already made in the last 24h, per sport (for the daily caps).
    const usedToday: Record<string, number> = {};
    try {
      const rows = await db
        .select({ category: article.category, n: count() })
        .from(articleTranslation)
        .innerJoin(article, eq(article.id, articleTranslation.articleId))
        .where(and(eq(articleTranslation.locale, locale.code), eq(articleTranslation.status, "translated"), gte(articleTranslation.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))))
        .groupBy(article.category);
      for (const r of rows) usedToday[r.category] = r.n;
    } catch (err) {
      if (!opts.dryRun) throw err;
    }

    const ranked = candidates
      .filter((c) => (c.body ?? "").length >= MIN_BODY_CHARS)
      .filter((c) => !backfill || !isMatchDataSource(c.sourceName))
      .map((c) => ({ ...c, fields: { title: c.title.trim(), summary: c.summary.trim(), body: c.body!.trim() } }))
      .map((c) => ({ ...c, hash: sourceHash(c.fields), prev: byArticle.get(c.id) }))
      .filter((c) => {
        if (!c.prev) return true;
        if (c.prev.attempts >= MAX_ATTEMPTS) return false; // gave up; a success resets attempts
        if (c.prev.sourceHash !== c.hash) return true; // English changed -> re-translate
        return c.prev.status === "failed";
      })
      .sort((a, b) => priorityScore(b.trendingScore, b.title, locale.priorityTerms) - priorityScore(a.trendingScore, a.title, locale.priorityTerms))
      .map((c) => ({ ...c, isNew: !c.prev, thin: isCappedThin(c) && !hasRealImage(c), thinPhoto: isCappedThin(c) && hasRealImage(c) }));
    // Noindex write-ups get a small allowance (locale.thinDailyCap, spread
    // over the day's hours); the site's indexed stories are always translated.
    // Short write-ups with a real photo (what the Pages can post) have their own, larger allowance.
    const thinUsed = backfill ? { plain: 0, photo: 0 } : await thinTranslatedLastHour(locale.code);
    const capped = backfill ? ranked : applyThinCap(applyThinCap(ranked, thinUsed.plain, Math.ceil(locale.thinDailyCap / 24)), thinUsed.photo, Math.ceil(locale.thinPhotoDailyCap / 24), (it) => it.thinPhoto);
    const todo = applyDailyCaps(capped, backfill ? {} : usedToday, backfill ? locale.backfillCaps : locale.dailyCaps).slice(0, maxPerRun);

    console.log(`Translation [${locale.code}]: ${candidates.length} recent published, ${todo.length} to translate (cap ${maxPerRun})${opts.dryRun ? " [dry-run]" : ""}`);

    for (const c of todo) {
      if (aiUnavailableReason()) { console.log(`Translation: stopping — ${aiUnavailableReason()}`); break; }

      // Attempt 1 on the cheap lite model; if the deterministic checks or the
      // second-opinion review reject it, one retry on Flash with the problems
      // spelled out. A "minor" review still publishes (notes kept for the admin).
      type Outcome = { out: Fields | null; ok: boolean; reason: string; review: Review | null };
      const attempt = async (model: string | undefined, feedback: string[]): Promise<Outcome> => {
        const out = await translateOnce(locale, c.fields, model, feedback);
        if (!out) return { out, ok: false, reason: "no response", review: null };
        const check = checkTranslation(c.fields, out);
        if (!check.ok) return { out, ok: false, reason: check.reason, review: null };
        const review = await reviewTranslation(locale, c.fields, out);
        return review.verdict === "major"
          ? { out, ok: false, reason: `review: ${review.issues.join("; ") || "major"}`, review }
          : { out, ok: true, reason: review.issues.join("; "), review };
      };

      let model = MODEL;
      let res = await attempt(undefined, []);
      if (!res.ok) {
        model = RETRY_MODEL;
        res = await attempt(RETRY_MODEL, [res.reason]);
      }
      // The AI ran out of room, or went down, during this item (normal on free
      // tiers, which end each day): that isn't the translation's fault. Leave
      // the item untouched for the next run, rather than counting a failed
      // attempt or holding it for review because its review couldn't run.
      if (!res.ok && aiUnavailableReason()) {
        console.log(`Translation: stopping — ${aiUnavailableReason()}`);
        break;
      }
      const out = res.out;
      const verdict = res.ok ? ({ ok: true } as const) : ({ ok: false, reason: res.reason } as const);

      if (opts.dryRun) {
        console.log(`${verdict.ok ? "ok  " : "FAIL"} (${model}) ${c.title.slice(0, 60)} -> ${verdict.ok ? out!.title.slice(0, 60) : verdict.reason}`);
        verdict.ok ? translated++ : failed++;
        continue;
      }

      const now = new Date();
      if (verdict.ok && out) {
        // A re-translation keeps its existing slug so URLs never change.
        const slug = c.prev?.slug ?? slugFromTitle(out.title, c.id.slice(-6));
        await db.insert(articleTranslation).values({
          id: createId(), articleId: c.id, locale: locale.code, ...out, slug, sourceHash: c.hash,
          status: "translated", attempts: 0, lastError: res.reason || null, model, updatedAt: now,
        }).onConflictDoUpdate({
          target: [articleTranslation.articleId, articleTranslation.locale],
          set: { ...out, slug, sourceHash: c.hash, status: "translated", attempts: 0, lastError: res.reason || null, model, updatedAt: now },
        });
        translated++;
        // Noindex pages (a translation of a short write-up, thinContent.ts) aren't announced.
        if (!c.prev && !isThinRewrite(c)) (newUrls[locale.code] ??= []).push(`${localeOrigin(locale.code)}/article/${slug}`);
      } else {
        const reason = verdict.ok ? "unknown" : verdict.reason;
        // Held back by the second-opinion review (not retried automatically; the
        // reviewer's notes are in lastError) vs. failed outright.
        const heldStatus = reason.startsWith("review:") ? "needs_review" : "failed";
        await db.insert(articleTranslation).values({
          id: createId(), articleId: c.id, locale: locale.code, sourceHash: c.hash,
          status: heldStatus, attempts: 1, lastError: reason, model, updatedAt: now,
        }).onConflictDoUpdate({
          target: [articleTranslation.articleId, articleTranslation.locale],
          // Keep any earlier good translation visible (status stays what it was
          // if it was 'translated'); only count the failed attempt.
          set: c.prev?.status === "translated"
            ? { lastError: reason, attempts: sql`${articleTranslation.attempts} + 1`, updatedAt: now }
            : { sourceHash: c.hash, status: heldStatus, attempts: sql`${articleTranslation.attempts} + 1`, lastError: reason, model, updatedAt: now },
        });
        failed++;
      }
    }
    skipped += candidates.length - todo.length;
  }
  // Best-effort, only for editions that are live (the same key file is served on every host).
  if (!opts.dryRun) {
    for (const l of liveLocales()) {
      const urls = newUrls[l.code] ?? [];
      if (urls.length > 0) await submitToIndexNow(urls, localeOrigin(l.code));
    }
  }
  console.log(`Translation: ${translated} translated, ${failed} failed, ${skipped} skipped.`);
  return { translated, failed, skipped };
}

if (require.main === module) {
  translateArticles({ dryRun: process.argv.includes("--dry-run") })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Translation run failed:", err);
      process.exit(1);
    });
}
