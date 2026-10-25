import { categoryEmoji } from "@/lib/categoryDisplay";
import { db } from "@/db";
import { article as articleTable, vertical as verticalTable, socialPost as socialPostTable } from "@/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { generateSocialCaptions } from "@/lib/ingestion/commentary";
import { selectInstagramHashtags } from "./hashtagRepertoire";
import { resolvePageAccessToken, translationFor } from "./facebook";
import { instagramCoolingDown } from "./metaCooldown";
import { TOPIC_INSTAGRAM_KEYS, type FacebookDestination } from "./facebookDestinations";



// Isolated social publisher, same shape as facebook.ts's postArticleToFacebook
// (per-vertical config with an env-var fallback, best-effort with its own
// SocialPost row, "not configured" treated as a no-op rather than an error).
// Instagram's Graph API is a two-step publish (create a media container,
// then publish it) and — unlike Facebook — has no text-only post type at
// all, so an article without a real image simply can't go to Instagram.
// Returns whether a real post actually happened — false for a silent no-op
// (already posted, or no real image to post), so a caller trying to
// guarantee "at least one post this run" can tell that apart from a real
// success and correctly move on to the next candidate article instead of
// mistaking a skip for a completed post.
// topicPage: post to that Page's own Instagram account (facebookDestinations.ts,
// instagramId) with its own post history, instead of the main account.
// Instagram's error with what is needed to diagnose it later: the step, the error code and subcode, the trace
// id, and for the create step the image address. The original message stays first (metaCooldown.ts matches on it).
function igErrorText(data: any, fallback: string, step: string, imageUrl?: string): string {
  const e = data?.error;
  const detail = [`step=${step}`, e?.code !== undefined ? `code=${e.code}` : "", e?.error_subcode !== undefined ? `subcode=${e.error_subcode}` : "", e?.fbtrace_id ? `trace=${e.fbtrace_id}` : "", imageUrl ? `image=${imageUrl}` : ""].filter(Boolean).join(" ");
  return `${e?.message ?? fallback} [${detail}]`;
}

export async function postArticleToInstagram(articleId: string, topicPage?: FacebookDestination): Promise<boolean> {
  const destination = topicPage?.key ?? "main";
  // Idempotency guard — same reasoning as postArticleToFacebook's (see
  // facebook.ts): a repeated call for an already-posted article must be a
  // safe no-op, not a second real post.
  const [alreadyPosted] = await db.select({ id: socialPostTable.id }).from(socialPostTable)
    .where(and(eq(socialPostTable.articleId, articleId), eq(socialPostTable.platform, "instagram"), topicPage ? eq(socialPostTable.destination, destination) : notInArray(socialPostTable.destination, TOPIC_INSTAGRAM_KEYS), eq(socialPostTable.status, "posted")))
    .limit(1);
  if (alreadyPosted) return false;
  // Meta's app-wide call limit was just hit: pause rather than fail again (metaCooldown.ts).
  if (await instagramCoolingDown(destination)) {
    console.log("[instagram] skipped: Meta app request limit cooldown");
    return false;
  }

  const [row] = await db.select({ article: articleTable, vertical: verticalTable })
    .from(articleTable)
    .innerJoin(verticalTable, eq(articleTable.verticalId, verticalTable.id))
    .where(eq(articleTable.id, articleId))
    .limit(1);
  if (!row) throw new Error(`Article not found: ${articleId}`);
  const article = { ...row.article, vertical: row.vertical };

  const igUserId = topicPage ? topicPage.instagramId : article.vertical.instagramBusinessAccountId ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const pageId = topicPage ? topicPage.pageId : article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const rawToken = topicPage ? process.env[topicPage.tokenEnv] : article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const imageUrl = article.heroImageUrl;

  if (!igUserId || !pageId || !rawToken || !imageUrl) {
    return false;
  }

  // Same token-exchange requirement as Facebook posting (facebook.ts) — a
  // System User's own token isn't valid for the linked Page's assets
  // directly, IG included. Reuses the exact same exchange call.
  const accessToken = await resolvePageAccessToken(pageId, rawToken);

  const emoji = categoryEmoji(article.category);
  // Full caption upgrade (explicit request, 2026-09-22) — same
  // generateSocialCaptions call facebook.ts now uses (one Gemini call
  // writes both platform captions together), asked specifically for a
  // longer, hook-first caption with emoji visual breaks per Instagram's own
  // style, ending on a "link in bio" CTA rather than a spelled-out URL
  // (captions don't render URLs as links — see FollowUs.tsx's own comment
  // on the same limitation). Hashtags come from hashtagRepertoire.ts's
  // deterministic signal-based selection, not the model's judgment.
  // Best-effort: falls back to just the real title on any Gemini failure.
  // A language edition's account (the Spanish Page's) posts the translated
  // story with a caption and hashtags in that language — as its Facebook Page.
  const tr = topicPage?.locale ? await translationFor(articleId, topicPage.locale) : null;
  if (topicPage?.locale && !tr) return false; // not translated (yet): nothing to post
  const postTitle = tr?.title ?? article.title;
  const postBody = tr ? tr.body : article.body;
  const captions = postBody ? await generateSocialCaptions(postTitle, postBody, topicPage?.locale) : null;
  const captionBody = captions?.instagram ?? postTitle;
  const pickHashtags = topicPage?.locale && topicPage.hashtags ? topicPage.hashtags : selectInstagramHashtags;
  const hashtags = pickHashtags(article.title, article.category).join(" ");
  const caption = `${emoji} ${captionBody}\n\n${hashtags}`;

  const [socialPost] = await db.insert(socialPostTable)
    .values({ id: createId(), articleId, platform: "instagram", destination, status: "queued" })
    .returning();

  try {
    const createRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.id) {
      throw new Error(igErrorText(createData, `Instagram media creation failed (${createRes.status})`, "create", imageUrl));
    }

    // Instagram processes the container asynchronously (fetching/validating
    // the image at image_url) — publishing immediately after creation is a
    // race: confirmed live, a real container failed to publish with "Media
    // ID is not available" because it wasn't done processing yet. A polling
    // loop (up to 10 extra status_code GET calls per post) fixed that race
    // but caused a far worse regression: confirmed live, it multiplied our
    // Graph API call volume enough to hit Meta's own app-level rate limit
    // ("Application request limit reached") for 6+ straight hours, failing
    // nearly every post. A single fixed wait covers Instagram's typical
    // processing time without the extra calls — the rare container still
    // not ready after 8s just fails that one post (same acceptable
    // occasional-failure rate as before the polling loop existed), instead
    // of burning the whole app's rate limit checking on every single post.
    await new Promise((r) => setTimeout(r, 8000));

    const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      throw new Error(igErrorText(publishData, `Instagram publish failed (${publishRes.status})`, "publish"));
    }

    await db.update(socialPostTable)
      .set({ status: "posted", externalPostId: publishData.id, postedAt: new Date() })
      .where(eq(socialPostTable.id, socialPost.id));
    return true;
  } catch (err) {
    await db.update(socialPostTable)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(socialPostTable.id, socialPost.id));
    throw err;
  }
}
