import { categoryEmoji } from "@/lib/categoryDisplay";
import { socialArticleUrl } from "./trackedLink";
import { db } from "@/db";
import { article as articleTable, vertical as verticalTable, socialPost as socialPostTable, socialPosterImage } from "@/db/schema";
import { eq, and, lt, ne, notInArray } from "drizzle-orm";
import { TOPIC_INSTAGRAM_KEYS } from "./facebookDestinations";

const POSTER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
import { createId } from "@paralleldrive/cuid2";
import { generatePosterContent, generateSocialCaptions, type PosterContent, type SocialCaptions } from "@/lib/ingestion/commentary";
import { renderInstagramPoster } from "./instagramPoster";
import { loadScoreStrip } from "./reelScore";
import { photoScoreGroupFor } from "./scoreVariant";
import { logDecision } from "./decisionLog";
import { resolvePageAccessToken } from "./facebook";
import { selectInstagramHashtags, selectFacebookHashtags } from "./hashtagRepertoire";

// Shared poster-generation core for both Facebook and Instagram, so an
// article going to both platforms in the same run gets ONE Gemini call and
// ONE render, not two. Only ever runs in a plain-Node GitHub Actions job —
// never the deployed Cloudflare Worker, where next/og can't render
// (confirmed Satori/WASM incompatibility). Callers:
//  - postInstagramPosterJob.ts: admin "Post Instagram poster" button, IG only.
//  - autoApprove.ts: the ingestion cron, both platforms.
//
// The poster PNG is committed to the repo as a real static asset just long
// enough to get a public URL for each platform's media API to fetch from,
// then deleted in a follow-up commit once both are done — the repo doesn't
// grow over time from this.



// Requires 3 CONSECUTIVE successful checks, not just one — confirmed live
// (2026-09-16): a single 200 response isn't reliable proof the poster is
// live everywhere yet. Several Instagram posts failed with "Only photo or
// video can be accepted as media type" despite the generated PNG itself
// being verified valid (reproduced locally, correct magic bytes) and our
// server confirmed serving the right Content-Type — the likely explanation
// is Cloudflare's edge network propagating the just-pushed file
// inconsistently, so the specific edge node our own HEAD request happened
// to hit already had it while the one Meta's servers fetch from (a
// different network path) briefly didn't. Spacing repeated checks and
// requiring several in a row in a real, if imperfect, way to wait out that
// propagation window instead of racing it on the first success.
async function waitUntilLive(url: string, maxAttempts = 20): Promise<void> {
  const REQUIRED_CONSECUTIVE = 3;
  let consecutiveSuccesses = 0;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      consecutiveSuccesses = res.ok ? consecutiveSuccesses + 1 : 0;
      if (consecutiveSuccesses >= REQUIRED_CONSECUTIVE) return;
    } catch {
      consecutiveSuccesses = 0;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`Poster never went live at ${url} after ${maxAttempts} attempts`);
}

type ArticleWithVertical = typeof articleTable.$inferSelect & { vertical: typeof verticalTable.$inferSelect };

async function postToInstagram(article: ArticleWithVertical, publicUrl: string, captions: SocialCaptions | null): Promise<boolean> {
  const igUserId = article.vertical.instagramBusinessAccountId ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const pageId = article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const rawToken = article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!igUserId || !pageId || !rawToken) return false;
  const accessToken = await resolvePageAccessToken(pageId, rawToken);

  const emoji = categoryEmoji(article.category);
  const creditLine = article.heroImageCredit ? `\n\n📷 ${article.heroImageCredit}` : "";
  // Full caption upgrade (explicit request, 2026-09-22) — same
  // generateSocialCaptions call as the plain-image Instagram/Facebook paths
  // (instagram.ts/facebook.ts), generated once in postSocialPoster below and
  // passed in here so an article going to both platforms in one run still
  // only costs one Gemini call for captions, same sharing principle this
  // file already applies to the poster image itself. Hashtags come from
  // hashtagRepertoire.ts's deterministic selection, not the model.
  // Best-effort: falls back to just the real title on any Gemini failure.
  const captionBody = captions?.instagram ?? article.title;
  const hashtags = selectInstagramHashtags(article.title, article.category).join(" ");
  const caption = `${emoji} ${captionBody}\n\n👉 Full breakdown — link in bio\n🔔 Follow @sportswirelivenews for daily sports news${creditLine}\n\n${hashtags}`;
  const altText = article.heroImageCredit ? `${article.title}. ${article.heroImageCredit}.` : article.title;

  const [socialPost] = await db.insert(socialPostTable)
    .values({ id: createId(), articleId: article.id, platform: "instagram", status: "queued" })
    .returning();

  try {
    console.log("[instagram] Creating media container...");
    const createRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: publicUrl, caption, alt_text: altText, access_token: accessToken }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.id) {
      throw new Error(createData?.error?.message ?? `Instagram media creation failed (${createRes.status})`);
    }

    await new Promise((r) => setTimeout(r, 8000));

    console.log("[instagram] Publishing...");
    const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      throw new Error(publishData?.error?.message ?? `Instagram publish failed (${publishRes.status})`);
    }

    await db.update(socialPostTable)
      .set({ status: "posted", externalPostId: publishData.id, postedAt: new Date() })
      .where(eq(socialPostTable.id, socialPost.id));
    console.log("[instagram] Posted! media id:", publishData.id);
    return true;
  } catch (err) {
    await db.update(socialPostTable)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(socialPostTable.id, socialPost.id));
    console.error("[instagram] Post failed:", err);
    return false;
  }
}

// Native photo post (no `link` field, no URL in the caption) — a link
// attached to a Facebook post in ANY form (link field, caption text, or a
// clickable-photo link) gets the same reduced-reach treatment in 2026, per
// Meta's own increasingly aggressive link-post throttling. The article URL
// goes on as a first comment instead, which Facebook (unlike Instagram)
// does render as a clickable link — genuinely avoiding the penalty rather
// than just moving where the link visually sits.
async function postToFacebook(article: ArticleWithVertical, publicUrl: string, captions: SocialCaptions | null, articleUrl: string): Promise<boolean> {
  const pageId = article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const rawToken = article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !rawToken) return false;
  const accessToken = await resolvePageAccessToken(pageId, rawToken);

  const emoji = categoryEmoji(article.category);
  const creditLine = article.heroImageCredit ? `\n\n📷 ${article.heroImageCredit}` : "";
  // Full caption upgrade (explicit request, 2026-09-22), same as
  // postToInstagram above — kept in sync even though this function is
  // currently dormant (see this file's own header comment) so it isn't
  // left stale relative to the rest of the pipeline's caption style.
  // Temporary reversion to a real link directly in the post — confirmed
  // live: with pages_manage_engagement still pending App Review, the
  // comment step never actually lands, so the caption's old "linked in the
  // comments below" line was a promise with nothing behind it, and site
  // traffic dropped as a result. Once pages_manage_engagement is approved,
  // switch this back to the no-link/first-comment version for the reach
  // benefit.
  const captionBody = captions?.facebook ?? article.title;
  const hashtags = selectFacebookHashtags(article.title, article.category).join(" ");
  const caption = `${emoji} ${captionBody}\n\nFull breakdown: ${articleUrl}${creditLine}\n\n${hashtags}`;

  const [socialPost] = await db.insert(socialPostTable)
    .values({ id: createId(), articleId: article.id, platform: "facebook", status: "queued" })
    .returning();

  try {
    console.log("[facebook] Posting photo with link in caption...");
    const photoRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: publicUrl, caption, access_token: accessToken }),
    });
    const photoData = await photoRes.json();
    if (!photoRes.ok || !photoData.post_id) {
      throw new Error(photoData?.error?.message ?? `Facebook photo post failed (${photoRes.status})`);
    }

    await db.update(socialPostTable)
      .set({ status: "posted", externalPostId: photoData.post_id, postedAt: new Date() })
      .where(eq(socialPostTable.id, socialPost.id));
    console.log("[facebook] Posted! post id:", photoData.post_id);

    // Best-effort extra comment with the same link, in case
    // pages_manage_engagement starts working mid-flight (e.g. right after
    // App Review approval) — harmless duplicate if it fails, and the post
    // itself is already recorded "posted" above regardless of this outcome.
    console.log("[facebook] Attempting first comment with the article link too...");
    const commentRes = await fetch(`https://graph.facebook.com/v20.0/${photoData.post_id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: articleUrl, access_token: accessToken }),
    });
    if (!commentRes.ok) {
      const commentData = await commentRes.json();
      console.error("[facebook] First-comment link failed (post itself still succeeded):", commentData?.error?.message);
    }

    return true;
  } catch (err) {
    await db.update(socialPostTable)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(socialPostTable.id, socialPost.id));
    console.error("[facebook] Post failed:", err);
    return false;
  }
}

// Generates one poster for an article and posts it to whichever of
// Facebook/Instagram are requested and not already posted. Returns which
// platforms actually got a fresh post this call.
export async function postSocialPoster(
  articleId: string,
  platforms: { instagram: boolean; facebook: boolean }
): Promise<{ instagramPosted: boolean; facebookPosted: boolean }> {
  const none = { instagramPosted: false, facebookPosted: false };
  const [row] = await db.select({ article: articleTable, vertical: verticalTable })
    .from(articleTable)
    .innerJoin(verticalTable, eq(articleTable.verticalId, verticalTable.id))
    .where(eq(articleTable.id, articleId))
    .limit(1);
  if (!row) throw new Error(`Article not found: ${articleId}`);
  const article: ArticleWithVertical = { ...row.article, vertical: row.vertical };

  const [[existingInstagram], [existingFacebook]] = await Promise.all([
    db.select({ id: socialPostTable.id }).from(socialPostTable)
      .where(and(eq(socialPostTable.articleId, articleId), eq(socialPostTable.platform, "instagram"), ne(socialPostTable.destination, "reel"), notInArray(socialPostTable.destination, TOPIC_INSTAGRAM_KEYS), eq(socialPostTable.status, "posted")))
      .limit(1),
    db.select({ id: socialPostTable.id }).from(socialPostTable)
      .where(and(eq(socialPostTable.articleId, articleId), eq(socialPostTable.platform, "facebook"), eq(socialPostTable.destination, "main"), eq(socialPostTable.status, "posted")))
      .limit(1),
  ]);
  const needInstagram = platforms.instagram && !existingInstagram;
  // Facebook is back to its plain-format post (autoApprove.ts calls
  // postArticleToFacebook directly again, not this) - the poster path here
  // still exists for Facebook in case it's wanted again later, just isn't
  // called from the main automated flow right now.
  const needFacebook = platforms.facebook && !existingFacebook;
  if (!needInstagram && !needFacebook) return none;

  if (!article.heroImageUrl || !article.body) return none;

  console.log("Generating poster copy...");
  const content = await generatePosterContent(article.title, article.body);
  if (!content) return none;
  console.log("Poster content:", JSON.stringify(content));

  // Shared once for whichever platform(s) this run actually needs — same
  // "one Gemini call, not two" principle as the poster image itself above.
  const captions = await generateSocialCaptions(article.title, article.body);

  // A story with a verified score: half of them get the score on the poster, half the plain poster (the control).
  const scoreAvailable = await loadScoreStrip(article.title);
  const scoreGroup = scoreAvailable ? photoScoreGroupFor(article.id) : null;
  console.log("Rendering poster image..." + (scoreGroup ? ` (score group: ${scoreGroup})` : ""));
  const png = await renderInstagramPoster({ content, heroImageUrl: article.heroImageUrl, category: article.category, credit: article.heroImageCredit, score: scoreGroup === "strip" ? scoreAvailable : null });

  const siteUrl = process.env.SITE_URL ?? "https://sportswirelive.com";
  const publicUrl = `${siteUrl}/social-posters/${article.slug}.png`;
  // Only Facebook carries the link (Instagram captions can't link out).
  const articleUrl = socialArticleUrl(siteUrl, article.slug, "facebook");

  // Stored in the database and served by app/social-posters/[file] for the
  // platforms to fetch — was committed to the repo (and removed again
  // after), each commit a full site deploy: ~100 a day, wiping the page
  // cache every time (2026-09-28).
  //
  // Each poster is deleted in the finally below; this sweep catches any a
  // killed run (runner crash, timeout) left behind. A post takes minutes,
  // so anything over 2 hours old is finished with.
  await db.delete(socialPosterImage).where(lt(socialPosterImage.createdAt, new Date(Date.now() - POSTER_MAX_AGE_MS)));
  console.log("Storing poster for the platforms to fetch...");
  const pngBase64 = Buffer.from(png).toString("base64");
  await db
    .insert(socialPosterImage)
    .values({ slug: article.slug, pngBase64 })
    .onConflictDoUpdate({ target: socialPosterImage.slug, set: { pngBase64, createdAt: new Date() } });

  try {
    console.log(`Waiting for ${publicUrl} to go live...`);
    await waitUntilLive(publicUrl);

    const instagramPosted = needInstagram ? await postToInstagram(article, publicUrl, captions) : false;
    if (scoreGroup && needInstagram) await logDecision({ articleId: article.id, platform: "instagram", destination: "main", kind: "photo", outcome: instagramPosted ? "posted" : "failed", features: { scoreGroup, scoreOnImage: scoreGroup === "strip", sport: article.category.split("/")[0] } });
    const facebookPosted = needFacebook ? await postToFacebook(article, publicUrl, captions, articleUrl) : false;
    return { instagramPosted, facebookPosted };
  } finally {
    // Runs even if waitUntilLive itself throws, so a failed post never
    // leaves the image behind.
    console.log("Removing the stored poster...");
    try {
      await db.delete(socialPosterImage).where(eq(socialPosterImage.slug, article.slug));
    } catch (cleanupErr) {
      console.error("Cleanup commit failed (non-fatal):", cleanupErr);
    }
  }
}
