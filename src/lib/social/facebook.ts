import { categoryEmoji } from "@/lib/categoryDisplay";
import { socialArticleUrl } from "./trackedLink";
import { captionVariantFor } from "./captionVariant";
import { db } from "@/db";
import { article as articleTable, articleTranslation as articleTranslationTable, vertical as verticalTable, socialPost as socialPostTable } from "@/db/schema";
import { LOCALES } from "@/lib/i18n/locales";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { generateSocialCaptions } from "@/lib/ingestion/commentary";
import { selectFacebookHashtags } from "./hashtagRepertoire";
import type { FacebookDestination } from "./facebookDestinations";

// A sport emoji at the start of the post text is a small, low-risk
// engagement lever on Facebook (unlike extra hashtags, which hurt reach —
// see below, this has no such downside since it's not a discoverability
// mechanism, just visual attention in the feed).
// (Per-sport emoji now live in categoryDisplay.ts's shared registry.)
const emojiFor = categoryEmoji;

// A Business System User's own token (what FACEBOOK_PAGE_ACCESS_TOKEN
// actually is, per the Meta setup this uses) is NOT directly valid for
// posting to a Page's /feed — confirmed live: every real post attempt
// failed with "(#200) ... requires ... as an admin with sufficient
// administrative permission" using that token as-is, even though the
// System User genuinely has pages_manage_posts/pages_read_engagement
// assigned. The fix is a one-call exchange: GET /{page-id}?fields=
// access_token with the System User token returns the actual Page-scoped
// token, which posting requires. Confirmed live: the exact same token that
// failed on /feed succeeded immediately once exchanged this way. Falls
// back to the original token if the exchange call itself fails, in case a
// genuine Page token was configured directly (no exchange needed then).
export async function resolvePageAccessToken(pageId: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return token;
    const data = await res.json();
    return typeof data?.access_token === "string" ? data.access_token : token;
  } catch {
    return token;
  }
}

// Isolated social publisher: posts an approved article to the Facebook Page
// configured for its vertical (each product/vertical can post to its own
// Page). Falls back to the global env vars when a vertical has no Page of
// its own configured yet, so single-vertical setups keep working unchanged.
// A missing token/page id is treated as "not configured" rather than an
// error, since Facebook posting is optional (see README).
// Returns whether this call actually posted something new — callers (e.g.
// autoApprove.ts's run log) need to tell a real post apart from a no-op, so
// a log line can't just assume success from "didn't throw." Confirmed live
// 2026-09-20: the log previously said "posted" unconditionally, even when
// this returned early via the idempotency guard below, masking a real bug
// (the caller's own already-posted exclusion set was time-windowed, so it
// kept re-selecting long-since-posted articles as "candidates," which then
// silently no-op'd here while still being logged as a fresh success).
//
// `destination`: a topic Page (facebookDestinations.ts) instead of the main
// Page. Its own page id/token, and its own history — the guard below is per
// destination, so posting a story to one Page doesn't block it for another.
export async function translationFor(articleId: string, locale: string): Promise<{ title: string; body: string | null; slug: string } | null> {
  const rows = await db.select({ title: articleTranslationTable.title, body: articleTranslationTable.body, slug: articleTranslationTable.slug })
    .from(articleTranslationTable)
    .where(and(eq(articleTranslationTable.articleId, articleId), eq(articleTranslationTable.locale, locale), eq(articleTranslationTable.status, "translated")))
    .limit(1);
  const r = rows[0];
  return r?.title && r.slug ? { title: r.title, body: r.body, slug: r.slug } : null;
}

// The story's photo as a Page photo post with `caption`, then the article link
// as its first comment. Returns the post id, or null if the photo post didn't go
// out (the caller falls back to a link post). A comment that fails after the
// photo is up is logged, not thrown: the photo is already public, and falling
// back would post the story twice.
async function postPhotoWithLinkComment(pageId: string, token: string, photoUrl: string, caption: string, link: string, photoBytes?: Buffer): Promise<string | null> {
  try {
    const fullCaption = `${caption}\n\n👇 Full story in the first comment`;
    // Our own image (the photo with the score on it, scorePhoto.tsx) goes up as the file itself; otherwise Facebook fetches the photo's address.
    let init: RequestInit;
    if (photoBytes) {
      const form = new FormData();
      form.append("source", new Blob([new Uint8Array(photoBytes)], { type: "image/png" }), "photo.png");
      form.append("caption", fullCaption);
      form.append("access_token", token);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: photoUrl, caption: fullCaption, access_token: token }) };
    }
    const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/photos`, init);
    const data = await res.json();
    if (!res.ok || !(data?.post_id ?? data?.id)) {
      console.warn(`[facebook] photo post failed, falling back to a link post: ${data?.error?.message ?? res.status}`);
      return null;
    }
    const postId: string = data.post_id ?? data.id;
    const commentRes = await fetch(`https://graph.facebook.com/v20.0/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Read the full story: ${link}`, access_token: token }),
    });
    if (!commentRes.ok) {
      const c = await commentRes.json().catch(() => ({}));
      console.warn(`[facebook] link comment failed on ${postId}: ${c?.error?.message ?? commentRes.status}`);
    }
    return postId;
  } catch (err) {
    console.warn("[facebook] photo post errored, falling back to a link post:", err);
    return null;
  }
}

// opts.photoBytes: for a photo-style Page, our own image (the photo with the score on it) to post instead of the plain photo.
export async function postArticleToFacebook(articleId: string, destination?: FacebookDestination, opts?: { photoBytes?: Buffer }): Promise<boolean> {
  const destinationKey = destination?.key ?? "main";
  // Idempotency guard: confirmed live that repeated calls for the same
  // article (a manual admin re-click before the page re-rendered the
  // "already posted" state, or any future automated retry) were creating
  // multiple real Page posts for one story — 4 duplicate posts of the same
  // article within 16 seconds, observed directly in SocialPost rows.
  // Checking for an existing "posted" row makes every caller safe to retry.
  const [alreadyPosted] = await db.select({ id: socialPostTable.id }).from(socialPostTable)
    .where(and(eq(socialPostTable.articleId, articleId), eq(socialPostTable.platform, "facebook"), eq(socialPostTable.destination, destinationKey), eq(socialPostTable.status, "posted")))
    .limit(1);
  if (alreadyPosted) return false;

  const [row] = await db.select({ article: articleTable, vertical: verticalTable })
    .from(articleTable)
    .innerJoin(verticalTable, eq(articleTable.verticalId, verticalTable.id))
    .where(eq(articleTable.id, articleId))
    .limit(1);
  if (!row) throw new Error(`Article not found: ${articleId}`);
  const article = { ...row.article, vertical: row.vertical };

  const pageId = destination ? destination.pageId : article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const accessToken = destination
    ? process.env[destination.tokenEnv]
    : article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    return false;
  }

  // A language edition's Page posts the translated text and links to that edition's own
  // article address (not the English one).
  const tr = destination?.locale ? await translationFor(articleId, destination.locale) : null;
  if (destination?.locale && !tr) return false; // not translated (yet): nothing to post
  const siteUrl = destination?.locale ? `https://${LOCALES[destination.locale].host}` : (process.env.SITE_URL ?? "http://localhost:3000");
  const isPhotoPost = destination?.style === "photo-question" && Boolean(article.heroImageUrl);
  const variant = destination?.captionTest && !isPhotoPost ? captionVariantFor(articleId) : undefined;
  const link = socialArticleUrl(siteUrl, tr?.slug ?? article.slug, "facebook", variant, destination?.key);
  const postTitle = tr?.title ?? article.title;
  const postBody = tr ? tr.body : article.body;
  // The link itself is passed as its own `link` field, not pasted into the
  // message text — Facebook auto-generates a proper preview card (image,
  // title, domain) from it, which gets meaningfully more reach than a raw
  // URL sitting in the post body. That card's thumbnail comes from the
  // article page's own og:image (generateMetadata in article/[slug]/
  // page.tsx), so it only works correctly now that SITE_URL is set right
  // (see the earlier production fix — before that it pointed at localhost).
  // Unchanged by the headline change below — this stays exactly as-is.

  // Full caption upgrade (explicit request, 2026-09-22) — replaced the
  // previous mechanical "Gemini hook + sentence-boundary-truncated body"
  // assembly with a single dedicated caption-writing call
  // (generateSocialCaptions) that writes the whole Facebook caption as one
  // real piece of prose per the platform's own style rules (punchy, a real
  // CTA, no hashtags — those come from hashtagRepertoire.ts's deterministic
  // signal-based selection instead of the model's judgment). Best-effort:
  // falls back to a minimal safe caption (just the real title) on any
  // Gemini failure so a hiccup can never block a Facebook post, same as
  // every other Gemini-dependent step here.
  const photoStyle = isPhotoPost;
  const captions = postBody ? await generateSocialCaptions(postTitle, postBody, destination?.locale, photoStyle ? "question" : variant === "hook" ? "hook" : undefined) : null;
  const captionBody = captions?.facebook ?? postTitle;
  const hashtags = (destination?.hashtags ?? selectFacebookHashtags)(article.title, article.category).join(" ");
  const message = `${emojiFor(article.category)} ${captionBody}\n\n${hashtags}`;

  const [socialPost] = await db.insert(socialPostTable)
    .values({ id: createId(), articleId, platform: "facebook", destination: destinationKey, status: "queued" })
    .returning();

  try {
    const postToken = await resolvePageAccessToken(pageId, accessToken);
    // Photo + question with the link in the first comment (destination.style);
    // null when the photo post fails, so the story still goes out as a normal
    // link post below.
    const photoId = photoStyle && article.heroImageUrl
      ? await postPhotoWithLinkComment(pageId, postToken, article.heroImageUrl, message, link, opts?.photoBytes)
      : null;
    let externalId: string;
    if (photoId) {
      externalId = photoId;
    } else {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${pageId}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, link, access_token: postToken }),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Facebook API error (${res.status})`);
      }
      externalId = data.id;
    }

    await db.update(socialPostTable)
      .set({ status: "posted", externalPostId: externalId, postedAt: new Date() })
      .where(eq(socialPostTable.id, socialPost.id));
    return true;
  } catch (err) {
    await db.update(socialPostTable)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(socialPostTable.id, socialPost.id));
    throw err;
  }
}
