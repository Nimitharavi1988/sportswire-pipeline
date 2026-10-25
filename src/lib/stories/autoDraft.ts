/**
 * Automatic story drafts: turns the open Story ideas (storyIdeas.ts — big
 * matches finished or coming up, players and teams in the news) into
 * editorial-style drafts in admin, so a writer starts from a finished first
 * pass instead of a blank page. Runs from the ingest workflow.
 *
 * NOTHING IS PUBLISHED HERE. Each draft is saved unpublished with no byline,
 * and carries [ADD: …] notes (gaps the model couldn't fill) and [CHECK: …]
 * notes (facts to verify, the suggested writer, the sources). Publishing is
 * blocked until a writer clears them and puts their name on it (stories.ts
 * publishProblems).
 *
 * Each draft (since 2026-10-04): the facts are researched on the web first
 * (research.ts), on top of what the site holds (draftFacts.ts); it's written
 * in one of several formats picked at random; a second call fact-checks it
 * against the research and cuts what isn't supported; and a licensed photo
 * that names the subject is attached when one exists.
 *
 * Spend and queue are capped so a busy news day can't flood the review
 * queue or the Gemini budget.
 */
import { db } from "@/db";
import { article, articleTag, dataSnapshot, vertical } from "@/db/schema";
import { and, eq, gte, isNull, count } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { fetchStoryIdeas, markStoryIdea } from "../storyIdeasData";
import type { StoryIdea } from "../storyIdeas";
import {
  MAX_DRAFTS_PER_DAY, MAX_DRAFTS_PER_RUN, MAX_RESEARCH_PER_RUN, MAX_UNREVIEWED, MIN_WEB_FACTS,
  candidatePeople, cleanDraftProblem, draftBodyWithChecks, scorePhoto, usablePhotos, draftProblem, editorNotes, pickFormat, pickIdeas, pickPhoto, reviewPackKey, suggestedWriter,
  type ReviewPack,
} from "./autoDraftRules";
import { unsupportedFigures } from "./enrichRules";
import { applyReview, notePaidCall, paidReviewCalls, paidReviewDraft } from "./paidReview";
import { researchFromCoverage } from "./coverageResearch";
import { gatherDraftFacts, seriesLabelFor } from "../draftFacts";
import { AiDraftError, requestDraft, type AiDraft } from "../aiDraft";
import { RESEARCH_MODEL, factCheckDraft, researchStory } from "./research";
import { photoReachable, searchPhotos, type PhotoResult } from "../photoSearch";
import { ORIGINAL_SOURCE, ORIGINAL_TRENDING_SCORE, storySlug } from "../stories";
import { isKnownTag } from "../tags";
import { articleUrl } from "../indexNow";
import { TRACKED_PLAYERS } from "../players";
import { TRACKED_CLUBS } from "../clubs";
import { TRACKED_COUNTRIES } from "../countries";
import { VENUES } from "../venues";

// Who or what the photo should show: the first tagged player, else team,
// else ground.
function photoSubject(tags: { kind: string; slug: string }[]): string | null {
  const find = <T extends { slug: string; name: string }>(kind: string, list: T[]) =>
    tags.filter((t) => t.kind === kind).map((t) => list.find((x) => x.slug === t.slug)?.name).find(Boolean);
  return find("player", TRACKED_PLAYERS) ?? find("club", TRACKED_CLUBS) ?? find("country", TRACKED_COUNTRIES) ?? find("venue", VENUES) ?? null;
}

async function suggestPhoto(subject: string | null): Promise<PhotoResult | null> {
  if (!subject) return null;
  try {
    return pickPhoto((await searchPhotos(subject)).results, subject);
  } catch (err) {
    console.error("Auto-draft photo search failed:", err);
    return null;
  }
}

// Photo for a clean draft: a named player from the story first (a real
// photograph of someone the story is about), then one of the clubs; never a
// uniform chart, logo, old card or building (autoDraftRules.ts isUsablePhoto).
// null when nothing suitable exists: the draft isn't saved without a photo.
// The first photo (of the first few) whose address really serves an image.
async function firstReachable(photos: PhotoResult[]): Promise<PhotoResult | null> {
  for (const photo of photos.slice(0, 6)) {
    if (await photoReachable(photo.importUrl)) return photo;
  }
  return null;
}

export async function suggestCleanPhoto(body: string, tags: { kind: string; slug: string }[]): Promise<{ photo: PhotoResult; subject: string } | null> {
  const clubNames = tags.filter((t) => t.kind === "club").map((t) => TRACKED_CLUBS.find((c) => c.slug === t.slug)?.name).filter((n): n is string => !!n);
  try {
    // The best-fitting photo among the people the story names: one showing
    // the player in a club's colours, or recent, beats the first one found.
    const clubWords = clubNames.map((c) => c.split(" ").pop() ?? "");
    let best: { photo: PhotoResult; subject: string; score: number } | null = null;
    for (const name of candidatePeople(body, clubNames, 6)) {
      const photo = await firstReachable(usablePhotos((await searchPhotos(name)).results, name));
      if (!photo) continue;
      const score = scorePhoto(photo, clubWords);
      if (!best || score > best.score) best = { photo, subject: name, score };
      if (score >= 2) break;
    }
    // A photo must show the story's club or be recent (score 1+): a namesake
    // ("Josh Allen OLB 2022" for the Bills quarterback) or an unrelated shot
    // scores 0 and is not used.
    if (best && best.score >= 1) return { photo: best.photo, subject: best.subject };
    for (const club of clubNames) {
      const photo = await firstReachable(usablePhotos((await searchPhotos(club)).results, club));
      if (photo) return { photo, subject: club };
    }
  } catch (err) {
    console.error("Auto-draft photo search failed:", err);
  }
  return null;
}

async function autoDraftCounts(now: Date) {
  const base = and(eq(article.sourceName, ORIGINAL_SOURCE), eq(article.status, "draft"), isNull(article.reviewedBy));
  const [[unreviewed], [today]] = await Promise.all([
    db.select({ n: count() }).from(article).where(base),
    db.select({ n: count() }).from(article).where(and(base, gte(article.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)))),
  ]);
  return { unreviewed: unreviewed.n, today: today.n };
}

async function saveDraft(idea: StoryIdea, draft: AiDraft, photo: PhotoResult | null, verticalId: string, now: Date, pack?: ReviewPack): Promise<string> {
  const id = createId();
  const slug = storySlug(draft.title, now.getTime());
  const seriesLabel = idea.seriesKey ? await seriesLabelFor(idea.seriesKey) : null;
  await db.insert(article).values({
    id,
    slug,
    verticalId,
    title: draft.title,
    summary: draft.summary,
    // A review-pack draft keeps its text clean; the checks live in the pack.
    body: pack ? draft.body : draftBodyWithChecks(draft),
    // Linked from Commons, not copied to our storage: this runs on GitHub
    // Actions, which has no access to the media bucket. Picking it again
    // with Find a photo in the editor copies it over.
    heroImageUrl: photo?.importUrl ?? null,
    heroImageCredit: photo?.credit ?? null,
    heroImageCreditUrl: photo?.landingUrl ?? null,
    category: idea.sport,
    storyKind: idea.storyKind,
    seriesKey: idea.seriesKey && seriesLabel ? idea.seriesKey : null,
    seriesLabel: idea.seriesKey && seriesLabel ? seriesLabel : null,
    sourceName: ORIGINAL_SOURCE,
    sourceUrl: articleUrl(slug),
    dedupeHash: `original-${id}`,
    trendingScore: ORIGINAL_TRENDING_SCORE,
    // reviewedBy stays null until a writer saves it: that's what marks it an
    // automatic draft in the Stories list.
    status: "draft",
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const tags = idea.tags.filter(isKnownTag);
  if (tags.length > 0) await db.insert(articleTag).values(tags.map((t) => ({ articleId: id, kind: t.kind, slug: t.slug }))).onConflictDoNothing();
  if (pack) {
    await db.insert(dataSnapshot).values({ key: reviewPackKey(id), data: pack, sourceUrl: "internal:draft-review", fetchedAt: now })
      .onConflictDoUpdate({ target: dataSnapshot.key, set: { data: pack, fetchedAt: now } });
  }
  await markStoryIdea(idea.key, "used", id);
  return id;
}

// The workflow uses the defaults. The local script (scripts/draftLocal.ts)
// raises the limits, researches from stored coverage instead of paid web
// search (freeResearch) and saves clean drafts with a review pack beside them
// (reviewPack) for one-click approval at /admin/stories/review.
export interface AutoDraftOptions {
  perRun?: number;
  perDay?: number;
  researchPerRun?: number;
  maxUnreviewed?: number;
  freeResearch?: boolean;
  reviewPack?: boolean;
  // A paid model reviews and corrects each draft before it is saved (paidReview.ts).
  paidReview?: boolean;
  // The paid model also writes the first draft: the free models' drafts were
  // all rejected by the review (2026-10-06), so they are no use as a base.
  paidWrite?: boolean;
  // Hard cap on paid review calls for this process.
  paidReviewMax?: number;
}

export async function autoDraftStories(now: Date = new Date(), opts: AutoDraftOptions = {}): Promise<{ drafted: number; note: string }> {
  const perRun = opts.perRun ?? MAX_DRAFTS_PER_RUN;
  const perDay = opts.perDay ?? MAX_DRAFTS_PER_DAY;
  const researchPerRun = opts.researchPerRun ?? MAX_RESEARCH_PER_RUN;
  const maxUnreviewed = opts.maxUnreviewed ?? MAX_UNREVIEWED;
  const counts = await autoDraftCounts(now);
  if (counts.unreviewed >= maxUnreviewed) return { drafted: 0, note: `${counts.unreviewed} drafts still waiting for review` };
  const room = Math.min(perRun, perDay - counts.today, maxUnreviewed - counts.unreviewed);
  if (room <= 0) return { drafted: 0, note: "daily limit reached" };

  const [sports] = await db.select({ id: vertical.id }).from(vertical).where(eq(vertical.name, "sports")).limit(1);
  if (!sports) return { drafted: 0, note: "no sports vertical" };

  let drafted = 0;
  let researched = 0;
  // Ideas without facts are skipped (not marked), so they're tried again as
  // data arrives; pick more than needed to allow for them.
  for (const idea of pickIdeas(await fetchStoryIdeas(now), 12)) {
    if (drafted >= room) break;
    // Each idea tried costs a search call, drafted or not.
    if (++researched > researchPerRun) break;
    const research = opts.freeResearch
      ? await researchFromCoverage({ id: `idea:${idea.key}`, title: idea.headline, summary: idea.brief, sourceName: ORIGINAL_SOURCE, sourceUrl: "", category: idea.sport }, now)
      : await researchStory(idea.headline, idea.brief, now);
    // Gemini unavailable: stop, try again next run.
    if (!research) return { drafted, note: "research unavailable" };
    if (research.facts.length < MIN_WEB_FACTS) {
      // Too little reported yet: dismissed rather than retried every run.
      console.log(`Auto-draft skipped "${idea.headline}" (${research.facts.length} researched facts).`);
      await markStoryIdea(idea.key, "dismissed");
      continue;
    }
    const facts = await gatherDraftFacts({ brief: idea.brief, category: idea.sport, storyKind: idea.storyKind, seriesKey: idea.seriesKey, tags: idea.tags });
    // The opinion "feature" format invited sweeping claims about named people
    // (a draft on a player's "past" and "liability", 2026-10-06), so drafts
    // meant for one-click approval use a more factual shape instead.
    const picked = pickFormat(idea.kind);
    const format = opts.reviewPack && picked === "feature" ? "takeaways" : picked;
    let draft: AiDraft;
    try {
      const paidKey = opts.paidWrite ? process.env.GEMINI_PAID_REVIEW_KEY : undefined;
      if (paidKey) {
        if (paidReviewCalls() >= (opts.paidReviewMax ?? 30)) return { drafted, note: "paid call limit reached for this run" };
        notePaidCall();
      }
      draft = await requestDraft({ ...facts, webFacts: research.facts, format, noNotes: opts.reviewPack }, RESEARCH_MODEL, paidKey);
    } catch (err) {
      // Out of credit, busy or not configured: stop, try again next run.
      if (err instanceof AiDraftError) return { drafted, note: err.message };
      throw err;
    }
    const problem = opts.reviewPack ? cleanDraftProblem(draft) : draftProblem(draft);
    if (problem) {
      // Not retried — it would cost a call every run.
      console.log(`Auto-draft skipped "${idea.headline}" (${problem}).`);
      await markStoryIdea(idea.key, "dismissed");
      continue;
    }
    // Checked against the researched facts plus the site's own fixtures.
    const checked = await factCheckDraft([...research.facts, ...facts.fixtures], draft.body);
    if (!checked) return { drafted, note: "fact-check unavailable" };
    const checkedDraft = { ...draft, body: checked.body };
    if (opts.reviewPack ? cleanDraftProblem(checkedDraft) : draftProblem(checkedDraft)) {
      console.log(`Auto-draft skipped "${idea.headline}" (too little left after the fact-check).`);
      await markStoryIdea(idea.key, "dismissed");
      continue;
    }
    if (opts.reviewPack) {
      // A figure the research never gave: the writer invented or mangled it.
      const unsupported = unsupportedFigures(checkedDraft.body, [...research.facts, ...facts.fixtures], draft.title);
      if (unsupported.length > 0) {
        console.log(`Auto-draft skipped "${idea.headline}" (figures not in the facts: ${unsupported.join(", ")}).`);
        await markStoryIdea(idea.key, "dismissed");
        continue;
      }
    }
    let subject = photoSubject(idea.tags);
    let photo: PhotoResult | null;
    if (opts.reviewPack) {
      // Clean drafts are approved without editing, so the photo must be right.
      const found = await suggestCleanPhoto(checkedDraft.body, idea.tags);
      if (!found) {
        console.log(`Auto-draft skipped "${idea.headline}" (no suitable photo).`);
        await markStoryIdea(idea.key, "dismissed");
        continue;
      }
      photo = found.photo;
      subject = found.subject;
    } else {
      photo = await suggestPhoto(subject);
    }
    const notes = editorNotes({ writer: suggestedWriter(idea.sport), sources: research.sources, removed: checked.removed.length, photoSubject: photo ? subject : null });
    let finalDraft = checkedDraft;
    const reviewNotes: string[] = [];
    if (opts.reviewPack && opts.paidReview) {
      if (paidReviewCalls() >= (opts.paidReviewMax ?? 30)) return { drafted, note: "paid review limit reached for this run" };
      const review = await paidReviewDraft(
        { title: checkedDraft.title, summary: checkedDraft.summary, body: checkedDraft.body },
        [...research.facts, ...facts.fixtures],
      );
      // Not available (no key, out of credit): stop, nothing unreviewed is saved.
      if (!review) return { drafted, note: "paid review unavailable" };
      const outcome = applyReview({ title: checkedDraft.title, summary: checkedDraft.summary, body: checkedDraft.body }, review);
      if (!outcome.ok) {
        console.log(`Auto-draft skipped "${idea.headline}" (${outcome.reason}).`);
        await markStoryIdea(idea.key, "dismissed");
        continue;
      }
      finalDraft = { ...checkedDraft, ...outcome.text };
      reviewNotes.push(...outcome.notes);
      // What is left after the corrections must still clear every check.
      const afterReview = cleanDraftProblem(finalDraft);
      if (afterReview) {
        console.log(`Auto-draft skipped "${idea.headline}" (after the paid review: ${afterReview}).`);
        await markStoryIdea(idea.key, "dismissed");
        continue;
      }
    }
    const checks = [...reviewNotes, ...notes, ...draft.checks];
    const pack: ReviewPack | undefined = opts.reviewPack
      ? {
          writer: suggestedWriter(idea.sport), format, kind: idea.kind, sport: idea.sport, sources: research.sources,
          facts: research.facts, checks, removed: checked.removed.length, photoSubject: photo ? subject : null, createdAt: now.toISOString(),
        }
      : undefined;
    await saveDraft(idea, { ...finalDraft, checks }, photo, sports.id, now, pack);
    console.log(`Auto-draft saved: "${draft.title}" (${idea.kind}, ${idea.sport}, ${format}, ${research.facts.length} facts, ${checked.removed.length} removed).`);
    drafted++;
  }
  return { drafted, note: "ok" };
}

if (require.main === module) {
  autoDraftStories()
    .then(({ drafted, note }) => {
      console.log(`Auto-draft: ${drafted} new draft(s) (${note}).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Auto-draft run failed:", err);
      process.exit(1);
    });
}
