import { categoryEmoji } from "@/lib/categoryDisplay";
import { socialArticleUrl } from "./trackedLink";
import { captionVariantFor, questionFirst, shortReelCaption } from "./captionVariant";
import { mainKeywordOn, withSportKeyword } from "./reelKeyword";
import { graphErrorDetail, recoverPublishedReel } from "./igPublishRecovery";
import { decodeHtmlEntities } from "../htmlEntities";
import { unknownNames } from "./speechNames";
import { voiceSource, buildShortScript, buildVoiceScript, makeVoice, pickVoice, voiceoverFor, youtubeVoiceOn } from "./voiceover";
import { reelIsFresh, reelMaxAgeHours, isStarStory } from "./freshness";
import { facebookShortCaption } from "./captionVariant";
import { YOUTUBE_EN_CURVE, curveAllows, reelPacingOn } from "./reelPacing";
import { MATCH_DAY_REEL_MAX_AGE_HOURS, isMatchDayStory } from "./matchDay";
import { loadMatchDayFixtures } from "./matchDayFixtures";
import { loadScoreStrip } from "./reelScore";
import { chooseHookLayout } from "./hookLayout";
import { db } from "@/db";
import { article as articleTable, vertical as verticalTable, socialPost as socialPostTable } from "@/db/schema";
import { and, count, eq, gte, inArray, like, max, ne } from "drizzle-orm";
import { TOPIC_DESTINATIONS, SPANISH_PAGE, instagramPaused, type FacebookDestination } from "./facebookDestinations";
import { MAIN_REEL_DESTINATION, reelNeeds } from "./reelDuplicates";
import { createId } from "@paralleldrive/cuid2";
import { generatePosterContent, generateSocialCaptions, type SocialCaptions } from "@/lib/ingestion/commentary";
import { renderReel } from "./reel";
import { planReels, reelSwitches } from "./reelPlan";
import { isFallbackCard } from "../fallbackCards";
import { musicStyleFor, type ReelMusicStyle } from "./reelMusic";
import { reelThemeForLayout, type ReelTheme, type ReelFont } from "./reelThemes";
import { resolvePageAccessToken, translationFor } from "./facebook";
import { LOCALES } from "@/lib/i18n/locales";
import { selectInstagramHashtags, selectFacebookHashtags, selectTopicInstagramHashtags, selectSpanishInstagramHashtags } from "./hashtagRepertoire";
import { reelTagsFor } from "./reelTags";
import { instagramCoolingDown } from "./metaCooldown";
import { logDecision, setDecisionContext, clearDecisionContext, decisionContextFor } from "./decisionLog";
import { reelFeatures } from "./decisionFeatures";
import { openingFor } from "./reelOpening";
import { storyTypeOf, STYLES_BY_TYPE } from "./hookStyles";
import { youtubeConfigured, uploadShort, shortsTitleFor, shortsDescription, shortsTags, youtubeSlotOpen, spanishShortsHourOpen, uploadLimitPauseActive, UPLOAD_LIMIT_MESSAGE, UPLOAD_LIMIT_PAUSE_HOURS, maxShortsPerDayFor, minGapMinutes, youtubeSportAllowed, priorityReserve, titleVariantFor, decorateShortsTitle } from "./youtube";

// Posts a story as a Reel to Instagram and the main Facebook Page. Runs in
// the post-reel GitHub Actions job only (renderReel needs plain Node).
//
// The MP4 is uploaded straight to Meta ("resumable" upload: the bytes go
// in the request to rupload.facebook.com), so, unlike the poster, it's
// never stored or served by us: no storage, nothing to clean up, and no
// waiting for a public URL to propagate (the poster's "Only photo or video
// can be accepted" failures).
//
// Recorded in SocialPost with destination "reel". The automated pipeline
// (autoApprove.ts) counts Instagram reel rows as Instagram posts (daily cap,
// one Instagram post per story); its Facebook checks filter on destination
// "main", so a Facebook reel doesn't stop the normal Facebook post. The
// manual admin buttons treat reels separately (ReelButton).

const GRAPH = "https://graph.facebook.com/v20.0";
const RUPLOAD = "https://rupload.facebook.com";
const DESTINATION = MAIN_REEL_DESTINATION;

type ArticleWithVertical = typeof articleTable.$inferSelect & { vertical: typeof verticalTable.$inferSelect };

async function graphJson(res: Response, what: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    // Meta's own error code and trace id, to diagnose the failures that carry only a word like "Fatal" (never the token).
    if (data?.error) console.warn(`[graph] ${what} error: ${graphErrorDetail(data)}`);
    throw new Error(data?.error?.message ?? `${what} failed (${res.status})`);
  }
  return data;
}

// Sends the whole file in one request (offset 0) to a rupload URL.
async function uploadBytes(url: string, accessToken: string, mp4: Buffer, what: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(mp4.length),
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(mp4),
  });
  await graphJson(res, what);
}

// A follow prompt as the first comment on a published reel. Best-effort: the
// reel is already public, so a failed comment is logged, never thrown (and
// never retried as a second post). A just-published reel can still be
// processing, so a failed attempt is retried a few times.
async function commentOnReel(objectId: string, message: string, accessToken: string, what: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await graphJson(
        await fetch(`${GRAPH}/${objectId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, access_token: accessToken }),
        }),
        `${what} follow comment`
      );
      return;
    } catch (err) {
      if (attempt === 3) console.warn(`[${what}] follow comment failed on ${objectId}:`, err instanceof Error ? err.message : err);
      else await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

async function recordAttempt(article: ArticleWithVertical, platform: "instagram" | "facebook" | "youtube", run: () => Promise<string>, destination = DESTINATION): Promise<boolean> {
  const [row] = await db.insert(socialPostTable)
    .values({ id: createId(), articleId: article.id, platform, destination, status: "queued" })
    .returning();
  const kind = platform === "youtube" ? "short" : "reel";
  try {
    const externalId = await run();
    await db.update(socialPostTable)
      .set({ status: "posted", externalPostId: externalId, postedAt: new Date() })
      .where(eq(socialPostTable.id, row.id));
    console.log(`[${platform} reel] Posted! id:`, externalId);
    await logDecision({ articleId: article.id, platform, destination, kind, outcome: "posted", externalPostId: externalId, features: decisionContextFor(article.id) });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(socialPostTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(socialPostTable.id, row.id));
    console.error(`[${platform} reel] Post failed:`, err);
    await logDecision({ articleId: article.id, platform, destination, kind, outcome: "failed", reason: message, features: decisionContextFor(article.id) });
    return false;
  }
}

// One "skipped" row per platform the caller asked for (the reel was not made, or not posted there), with why.
async function logSkips(articleId: string, opts: { instagram: boolean; facebook: boolean; youtube?: boolean; topicPage?: FacebookDestination }, reason: string): Promise<void> {
  const destination = opts.topicPage ? `${opts.topicPage.key}-reel` : DESTINATION;
  const platforms = ([opts.instagram && "instagram", opts.facebook && "facebook", opts.youtube && "youtube"].filter(Boolean)) as ("instagram" | "facebook" | "youtube")[];
  for (const platform of platforms) await logDecision({ articleId, platform, destination, kind: platform === "youtube" ? "short" : "reel", outcome: "skipped", reason });
}

// topicPage: that Page's own Instagram account (instagramId), its own reel
// history ("<key>-reel") and, for a language edition, captions in that language.
async function postReelToInstagram(article: ArticleWithVertical, mp4: Buffer, captions: SocialCaptions | null, topicPage?: FacebookDestination): Promise<boolean> {
  const igUserId = topicPage ? topicPage.instagramId : article.vertical.instagramBusinessAccountId ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const pageId = topicPage ? topicPage.pageId : article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const rawToken = topicPage ? process.env[topicPage.tokenEnv] : article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!igUserId || !pageId || !rawToken) return false;
  // Meta's app-wide call limit was just hit: pause rather than fail again (metaCooldown.ts).
  if (await instagramCoolingDown(topicPage ? `${topicPage.key}-reel` : DESTINATION)) {
    console.log("[instagram reel] skipped: Meta app request limit cooldown");
    return false;
  }
  const accessToken = await resolvePageAccessToken(pageId, rawToken);

  // Same caption shape as the Instagram poster (socialPoster.ts), plus a
  // comment prompt matching the reel's end card.
  const emoji = categoryEmoji(article.category);
  const creditLine = article.heroImageCredit ? `\n\n📷 ${decodeHtmlEntities(article.heroImageCredit)}` : "";
  // 4 specific tags + brand: more than that reads as spam and adds no reach.
  const spanish = topicPage?.locale === "es";
  const hashtagList = spanish && topicPage?.hashtags ? selectSpanishInstagramHashtags(article.title, article.category) : topicPage ? selectTopicInstagramHashtags(article.title, article.category, 4) : selectInstagramHashtags(article.title, article.category, 4);
  // Instagram allows 5 tags. A cricket topic reel keeps its 3 most specific, swaps the 4th for the format tag, and ends with the brand tag.
  const hashtags = (topicPage && !spanish && article.category.startsWith("cricket") ? [...hashtagList.slice(0, 3), "#CricketReels", ...hashtagList.slice(-1)] : hashtagList).filter((t, i, all) => all.indexOf(t) === i).join(" ");
  const cta = spanish
    ? "💬 ¿Qué opinas? Cuéntanos en los comentarios\n👉 Toda la información — enlace en la bio\n🔔 Síguenos para más noticias deportivas"
    : `💬 What's your take? Tell us in the comments\n👉 Full breakdown — link in bio\n🔔 ${topicPage ? "Follow us for daily sports news" : "Follow @sportswirelivenews for daily sports news"}`;
  const leadText = withTopicKeyword(captions?.instagram ?? article.title, article.category, topicPage, article.id);
  // Topic Pages without their own question test: the closing question goes first (questionFirst, 2026-10-28).
  const caption = `${emoji} ${topicPage && !topicPage.reelCaptionTest ? questionFirst(leadText) : leadText}\n\n${cta}${creditLine}\n\n${hashtags}`;
  const tags = reelTagsFor(article.title, article.category);

  const createContainer = (withTags: boolean) =>
    fetch(`${GRAPH}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Cover: the headline frame, 1s in (before the first fact appears).
      body: JSON.stringify({
        media_type: "REELS", upload_type: "resumable", caption, share_to_feed: true, thumb_offset: 1000, access_token: accessToken,
        ...(withTags && tags.collaborators.length > 0 ? { collaborators: tags.collaborators } : {}),
        ...(withTags && tags.userTags.length > 0 ? { user_tags: tags.userTags } : {}),
      }),
    });

  return recordAttempt(article, "instagram", async () => {
    console.log("[instagram reel] Creating container...");
    const hasTags = tags.collaborators.length > 0 || tags.userTags.length > 0;
    let container;
    try {
      container = await graphJson(await createContainer(hasTags), "Instagram reel container");
    } catch (err) {
      if (!hasTags) throw err;
      console.warn("[instagram reel] Container with tags failed, retrying without:", err instanceof Error ? err.message : err);
      container = await graphJson(await createContainer(false), "Instagram reel container");
    }
    if (!container.id) throw new Error("Instagram returned no container id");

    console.log("[instagram reel] Uploading video...");
    await uploadBytes(`${RUPLOAD}/ig-api-upload/v20.0/${container.id}`, accessToken, mp4, "Instagram reel upload");

    // Instagram processes the video before it can be published.
    console.log("[instagram reel] Waiting for processing...");
    for (let i = 0; ; i++) {
      const status = await graphJson(
        await fetch(`${GRAPH}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`),
        "Instagram reel status"
      );
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Instagram processing ${status.status_code}: ${status.status ?? ""}`);
      // Every status check counts against Meta's app-wide call limit, so check every 30s (still 10 minutes in all).
      if (i >= 20) throw new Error("Instagram reel still processing after 10 minutes");
      await new Promise((r) => setTimeout(r, 30000));
    }

    console.log("[instagram reel] Publishing...");
    const publishStarted = Date.now();
    let published: any;
    try {
      published = await graphJson(
        await fetch(`${GRAPH}/${igUserId}/media_publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
        }),
        "Instagram reel publish"
      );
    } catch (err) {
      // The publish call can answer "Fatal" although the reel is live (igPublishRecovery.ts): check before calling it a failure.
      const liveId = await recoverPublishedReel({ graph: GRAPH, igUserId, accessToken, containerId: container.id, sinceMs: publishStarted - 120_000 });
      if (!liveId) throw err;
      console.warn(`[instagram reel] publish call errored (${err instanceof Error ? err.message : err}) but the reel is live: ${liveId}`);
      return liveId;
    }
    if (!published.id) throw new Error("Instagram returned no media id");
    return published.id as string;
  }, topicPage ? `${topicPage.key}-reel` : DESTINATION);
}

// topicPage: post to a topic Page (facebookDestinations.ts) instead of the
// main Page — its own token and posting history, and a caption that points
// viewers at the Page (Follow) as well as the article.
// Topic Pages (English) put the sport in the caption's first sentence when it is missing (reelKeyword.ts); the main Page and the Spanish Page keep their text.
// The main Page and main Instagram get it for a share of their stories only (MAIN_CAPTION_KEYWORD, reelKeyword.ts mainKeywordOn), a test against the rest.
function withTopicKeyword(text: string, category: string, topicPage?: FacebookDestination, articleId?: string): string {
  if (!topicPage) return articleId && mainKeywordOn(articleId) ? withSportKeyword(text, category, "en") : text;
  return withSportKeyword(text, category, topicPage.locale === "es" ? "es" : "en");
}

async function postReelToFacebook(article: ArticleWithVertical, mp4: Buffer, captions: SocialCaptions | null, articleUrl: string, topicPage?: FacebookDestination, shortCaption = false): Promise<boolean> {
  const pageId = topicPage ? topicPage.pageId : article.vertical.facebookPageId ?? process.env.FACEBOOK_PAGE_ID;
  const rawToken = topicPage ? process.env[topicPage.tokenEnv] : article.vertical.facebookPageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !rawToken) return false;
  const accessToken = await resolvePageAccessToken(pageId, rawToken);

  const emoji = categoryEmoji(article.category);
  const creditLine = article.heroImageCredit ? `\n\n📷 ${decodeHtmlEntities(article.heroImageCredit)}` : "";
  const hashtags = (topicPage?.hashtags ? topicPage.hashtags(article.title, article.category) : selectFacebookHashtags(article.title, article.category)).join(" ");
  const spanish = topicPage?.locale === "es";
  // The caption test (captionVariant.ts), on the main Page and every topic Page except Greenfield (which has its
  // own question-ending test): half the stories get just the opening sentence and no link (the photo credit and
  // hashtags stay); the other half keep the usual caption.
  const description = shortCaption
    ? `${emoji} ${shortReelCaption(withTopicKeyword(captions?.facebook ?? article.title, article.category, topicPage, article.id))}${creditLine}\n\n${hashtags}`
    : `${emoji} ${topicPage && !topicPage.reelCaptionTest ? questionFirst(withTopicKeyword(captions?.facebook ?? article.title, article.category, topicPage, article.id)) : withTopicKeyword(captions?.facebook ?? article.title, article.category, topicPage, article.id)}\n\n${spanish ? "Toda la información" : "Full breakdown"}: ${articleUrl}${creditLine}\n\n${hashtags}`;

  return recordAttempt(article, "facebook", async () => {
    console.log("[facebook reel] Starting upload...");
    const start = await graphJson(
      await fetch(`${GRAPH}/${pageId}/video_reels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_phase: "start", access_token: accessToken }),
      }),
      "Facebook reel start"
    );
    if (!start.video_id) throw new Error("Facebook returned no video id");

    console.log("[facebook reel] Uploading video...");
    await uploadBytes(start.upload_url ?? `${RUPLOAD}/video-upload/v20.0/${start.video_id}`, accessToken, mp4, "Facebook reel upload");

    console.log("[facebook reel] Publishing...");
    await graphJson(
      await fetch(`${GRAPH}/${pageId}/video_reels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description, access_token: accessToken }),
      }),
      "Facebook reel publish"
    );
    // Topic Pages only: the main Page's reels are unchanged (no comment).
    if (topicPage) await commentOnReel(start.video_id, `👍 ${spanish ? "Síguenos para más noticias deportivas" : "Follow for more sports news"}: https://www.facebook.com/${pageId}`, accessToken, "facebook reel");
    return start.video_id as string;
  }, topicPage ? `${topicPage.key}-reel` : DESTINATION);
}

// The same MP4 as a YouTube Short, on the English channel (main) or the Spanish one (the Spanish Page's
// reels, in Spanish). Off unless YOUTUBE_SHORTS_ENABLED=1 (youtube.ts); recorded as platform "youtube",
// destination "reel" (English) or "es-reel".
async function postReelToYouTube(article: ArticleWithVertical, mp4: Buffer, captions: SocialCaptions | null, articleUrl: string, hook: string, title0: string, topicPage?: FacebookDestination): Promise<boolean> {
  const spanish = topicPage?.locale === "es";
  const hashtags = topicPage?.hashtags ? topicPage.hashtags(title0, article.category) : selectFacebookHashtags(title0, article.category);
  const plainTitle = shortsTitleFor(hook, title0, spanish ? "es" : "en", article.category);
  // Title: under 60 characters, names first, no emoji or hashtags (YouTube rules, 2026-10-29; the decorated-title test is over).
  const title = plainTitle;
  const description = shortsDescription(captions?.facebook ?? title0, hashtags, spanish ? "es" : "en", article.heroImageCredit, { category: article.category, title: plainTitle });
  const tags = shortsTags({ category: article.category, title: plainTitle, names: [article.homeTeam, article.awayTeam, article.seriesLabel], hashtags, language: spanish ? "es" : "en" });
  return recordAttempt(article, "youtube", async () => {
    console.log("[youtube short] Uploading video...");
    return uploadShort(mp4, title, description, tags, "public", spanish ? "es" : "en", spanish ? "es" : "en");
  }, topicPage ? `${topicPage.key}-reel` : DESTINATION);
}

// Renders one reel for a story and posts it to whichever of Instagram /
// Facebook are requested and don't already have a reel of this story.
// `music` is a style name, or undefined for the story's own pick;
// `theme` / `font` a colour theme and headline font, or undefined for
// brand green / Poppins.
export async function postReel(
  articleId: string,
  // fanOut: a big match-day story, or an admin's explicit post: only this account's own history decides whether it needs the reel
  // (reelDuplicates.ts), not the other Pages'.
  opts: { instagram: boolean; facebook: boolean; youtube?: boolean; topicPage?: FacebookDestination; music?: ReelMusicStyle; theme?: ReelTheme; font?: ReelFont; fanOut?: boolean }
): Promise<{ instagramPosted: boolean; facebookPosted: boolean; youtubePosted: boolean }> {
  const none = { instagramPosted: false, facebookPosted: false, youtubePosted: false };
  clearDecisionContext();
  const [row] = await db.select({ article: articleTable, vertical: verticalTable })
    .from(articleTable)
    .innerJoin(verticalTable, eq(articleTable.verticalId, verticalTable.id))
    .where(eq(articleTable.id, articleId))
    .limit(1);
  if (!row) throw new Error(`Article not found: ${articleId}`);
  const article: ArticleWithVertical = { ...row.article, vertical: row.vertical };
  if (!article.heroImageUrl || !article.body) {
    console.log(`[reel] skipped ${articleId}: no photo or no body`);
    await logSkips(articleId, opts, "no photo or no body");
    return none;
  }
  // Fresh news only (freshness.ts): no reel of an old story, whoever asks for it.
  const maxAge = reelMaxAgeHours(process.env, opts.topicPage?.key);
  // Messi and Ronaldo stories are exempt: they stay worth a reel as they age (freshness.ts); so is a story
  // about a match starting soon or just played, which may be up to a day old (matchDay.ts).
  const reelNow = new Date();
  let freshEnough = isStarStory(article.title) || reelIsFresh(article.publishedAt, article.createdAt, reelNow, maxAge);
  if (!freshEnough && reelIsFresh(article.publishedAt, article.createdAt, reelNow, MATCH_DAY_REEL_MAX_AGE_HOURS)) {
    freshEnough = isMatchDayStory(article.title, await loadMatchDayFixtures(reelNow), reelNow);
    if (freshEnough) console.log(`[reel] ${articleId}: older than ${maxAge}h but about a match today, allowed`);
  }
  if (!freshEnough) {
    console.log(`[reel] skipped ${articleId}: published more than ${maxAge} hours ago (set REEL_MAX_AGE_HOURS to change)`);
    await logSkips(articleId, opts, `too old: published more than ${maxAge} hours ago`);
    return none;
  }

  // One Facebook reel per story across our Pages: repeated videos get less
  // reach. A topic Page skips a story the main Page (or itself) already has; the
  // main Page skips a story any topic Page already has. (Instagram: its own row.)
  const topicReelKeys = TOPIC_DESTINATIONS.map((d) => `${d.key}-reel`);
  const existing = await db.select({ platform: socialPostTable.platform, destination: socialPostTable.destination }).from(socialPostTable)
    .where(and(eq(socialPostTable.articleId, articleId), inArray(socialPostTable.destination, [DESTINATION, ...topicReelKeys]), eq(socialPostTable.status, "posted")));
  // A language edition's Page (Spanish) makes its own reel, in its language, of the
  // translated story: a different video for a different audience, so only its own
  // history counts (not the English Pages' reels of the same story).
  const locale = opts.topicPage?.locale;
  const tr = locale ? await translationFor(articleId, locale) : null;
  if (locale && !tr?.body) {
    console.log(`[reel] skipped ${articleId}: no ${locale} translation yet`);
    await logSkips(articleId, opts, `no ${locale} translation yet`);
    return none;
  }
  const ownKey = opts.topicPage ? `${opts.topicPage.key}-reel` : null;
  const { needInstagram: wantInstagram, needFacebook } = locale
    ? {
      needInstagram: opts.instagram && !existing.some((p) => p.platform === "instagram" && p.destination === ownKey),
      needFacebook: opts.facebook && !existing.some((p) => p.platform === "facebook" && p.destination === ownKey),
    }
    : reelNeeds(existing, { instagram: opts.instagram, facebook: opts.facebook, topicKey: opts.topicPage?.key, fanOut: opts.fanOut });
  // Skip Instagram up front while Meta's app limit is cooling down, so no reel is rendered just for it (metaCooldown.ts).
  const whySkipped: string[] = [];
  const igCooling = wantInstagram && (await instagramCoolingDown(opts.topicPage ? `${opts.topicPage.key}-reel` : DESTINATION));
  if (igCooling) whySkipped.push("instagram paused after a platform limit error (metaCooldown.ts)");
  // An account switched off by hand (INSTAGRAM_PAUSED_ACCOUNTS, facebookDestinations.ts): no reel is rendered for it.
  const igPaused = wantInstagram && Boolean(opts.topicPage && instagramPaused(opts.topicPage.key));
  if (igPaused) whySkipped.push("instagram account paused by hand (INSTAGRAM_PAUSED_ACCOUNTS)");
  const needInstagram = wantInstagram && !igCooling && !igPaused;
  // YouTube: the English channel for the main reels, the Spanish channel for the Spanish Page's reels
  // (other topic Pages: none), once per story per channel.
  // The cricket Pages' reels (reels.youtube) go to the English channel too, with the main reels: one Short
  // per story across all the English destinations, and one pacing budget for the channel.
  const ytChannel = locale === "es" ? "es" : !opts.topicPage || opts.topicPage.reels?.youtube ? "en" : null;
  const ytKey = ytChannel === "es" ? ownKey : opts.topicPage ? ownKey : DESTINATION;
  const spanishYtKey = `${SPANISH_PAGE.key}-reel`;
  // Paced (youtube.ts): a daily cap and a minimum gap since the last Short, per channel.
  let needYouTube = Boolean(opts.youtube) && ytChannel !== null && youtubeConfigured(ytChannel)
    && !existing.some((p) => p.platform === "youtube" && (ytChannel === "es" ? p.destination === ytKey : p.destination !== spanishYtKey));
  if (needYouTube && ytChannel === "es" && !spanishShortsHourOpen(new Date())) { needYouTube = false; whySkipped.push("youtube timing: outside the Spanish channel's hours"); }
  if (needYouTube) {
    const [{ value: lastDay, last }] = await db.select({ value: count(), last: max(socialPostTable.postedAt) }).from(socialPostTable)
      .where(and(eq(socialPostTable.platform, "youtube"), ytChannel === "es" ? eq(socialPostTable.destination, spanishYtKey) : ne(socialPostTable.destination, spanishYtKey), eq(socialPostTable.status, "posted"), gte(socialPostTable.postedAt, new Date(Date.now() - 24 * 3600 * 1000))));
    // The English channel's Shorts follow their own hourly curve (reelPacing.ts): most go out 00:00-09:00 UTC, where they got views.
    let ytTodayOk = true;
    if (ytChannel !== "es" && reelPacingOn()) {
      const utcMidnight = new Date(); utcMidnight.setUTCHours(0, 0, 0, 0);
      const [{ value: ytToday }] = await db.select({ value: count() }).from(socialPostTable)
        .where(and(eq(socialPostTable.platform, "youtube"), ne(socialPostTable.destination, spanishYtKey), eq(socialPostTable.status, "posted"), gte(socialPostTable.postedAt, utcMidnight)));
      ytTodayOk = curveAllows(YOUTUBE_EN_CURVE, maxShortsPerDayFor("en"), ytToday, new Date());
    }
    if (!youtubeSlotOpen(lastDay, last, new Date(), maxShortsPerDayFor(ytChannel ?? "en"), minGapMinutes())) { needYouTube = false; whySkipped.push("youtube pacing: daily cap or minimum gap"); }
    else if (!ytTodayOk) { needYouTube = false; whySkipped.push("youtube pacing: ahead of the hourly curve"); }
    else if (!youtubeSportAllowed(ytChannel ?? "en", article.category, lastDay, maxShortsPerDayFor(ytChannel ?? "en"), priorityReserve())) { console.log(`[youtube short] skipped: ${article.category} waits for a free slot (the last ${priorityReserve()} of ${maxShortsPerDayFor(ytChannel ?? "en")} a day go to the best-performing sports)`); needYouTube = false; whySkipped.push(`youtube: ${article.category} waits for a free slot`); }
  }
  if (needYouTube) {
    // YouTube's own daily upload limit was hit recently on this channel: pause, don't render and fail again (youtube.ts).
    const [limitRow] = await db.select({ at: max(socialPostTable.createdAt) }).from(socialPostTable)
      .where(and(eq(socialPostTable.platform, "youtube"), ytChannel === "es" ? eq(socialPostTable.destination, spanishYtKey) : ne(socialPostTable.destination, spanishYtKey), eq(socialPostTable.status, "failed"), like(socialPostTable.errorMessage, `%${UPLOAD_LIMIT_MESSAGE}%`), gte(socialPostTable.createdAt, new Date(Date.now() - UPLOAD_LIMIT_PAUSE_HOURS * 3_600_000))));
    if (uploadLimitPauseActive(limitRow?.at ?? null, new Date())) {
      console.log(`[youtube short] paused: the ${ytChannel} channel hit YouTube's daily upload limit in the last ${UPLOAD_LIMIT_PAUSE_HOURS}h`);
      needYouTube = false;
      whySkipped.push(`youtube paused: the ${ytChannel} channel hit YouTube's daily upload limit`);
    }
  }
  if (!needInstagram && !needFacebook && !needYouTube) {
    console.log(`[reel] skipped ${articleId}: already has a reel on the requested platform(s)`);
    if (whySkipped.length) await logSkips(articleId, opts, whySkipped.join("; "));
    return none;
  }
  const textTitle = tr?.title ?? article.title;
  const textBody = tr?.body ?? article.body;

  console.log("Generating reel copy...");
  // The hook: several candidates in the styles that suit this kind of story, each checked against the article, the best used (hookChoice.ts).
  const storyType = storyTypeOf(article.title, article.body);
  const content = await generatePosterContent(textTitle, textBody, locale, { styles: STYLES_BY_TYPE[storyType], articleId: article.id });
  if (!content) {
    console.log(`[reel] skipped ${articleId}: no reel copy (too few real facts, or the copy call failed)`);
    await logSkips(articleId, opts, "no reel copy (too few real facts, or the copy call failed)");
    return none;
  }
  console.log("Reel content:", JSON.stringify(content));
  // Fallback for a language edition: its own headline, never the English one.
  // Greenfield's reel A/B test (reelCaptionTest): half the stories get a description that ends
  // in a pick-a-side question (reel viewers can't tap the link, so comments are the signal to win),
  // half the usual one. Each story's link is tagged utm_content=question|control.
  const reelVariant = opts.topicPage?.reelCaptionTest ? (captionVariantFor(articleId) === "hook" ? "question" : "control") : undefined;
  const captions = (await generateSocialCaptions(textTitle, textBody, locale, reelVariant === "question" ? "question" : undefined)) ?? (locale ? { facebook: textTitle, instagram: textTitle } : null);

  // Topic Pages pick music by the story's mood and sport; the main Page and Instagram keep the original rotation.
  const music = opts.music ?? musicStyleFor(article.id, opts.topicPage ? { title: article.title, category: article.category } : undefined);
  // An explicit colour wins; otherwise every reel (main Page, topic Pages, Instagram, YouTube) rotates by sport (reelThemes.ts).
  // The score strip is loaded first: whether the story has a score is part of choosing its layout, and the layout sets the colour.
  const score = await loadScoreStrip(article.title, locale === "es" ? "es" : "en");
  const layoutKind = chooseHookLayout({ hook: content.hook, hasScore: Boolean(score) }).layout;
  const theme = opts.theme ?? reelThemeForLayout(layoutKind, article.id, article.category);
  // What this reel was made with, recorded with its outcome by recordAttempt (decisionLog.ts).
  // The reel's opening: half the stories get the fast one, half the classic (the control); recorded in the decision log.
  const opening = openingFor(article.id);
  // Voice (voiceover.ts): English reels of the listed Pages, half the stories; the main Page is the key "main". Silent on any failure.
  // The Spanish Page (key "es") is voiced in Spanish when listed ("es:4" = 1 story in 4); any other language edition stays silent.
  const voiceLanguage: "en" | "es" | null = !locale ? "en" : locale === "es" ? "es" : null;
  const voiceName = voiceLanguage && voiceoverFor(opts.topicPage ? opts.topicPage.key : "main", article.id) ? pickVoice(article.id, voiceLanguage) : null;
  // What the voice reads: the caption's description, or, when no AI wrote captions (quota used up), the opening sentences of the article itself
  // rather than only the on-screen hook (voiceover.ts picks whole sentences and skips calls to action).
  const voiceDescription = captions?.facebook ?? textBody;
  const voiceSeed = [...article.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
  const voice = voiceName && voiceLanguage ? await makeVoice(buildVoiceScript(content, article.category, voiceDescription, voiceLanguage), buildShortScript(content, article.category, voiceLanguage), voiceName, voiceSeed) : null;
  const voicePath = voice?.path ?? null;
  if (voice) {
    console.log(`[voiceover] ${voiceName}, ${voice.seconds.toFixed(1)} s, ${voiceSource(voice.text, content, article.category, voiceDescription, voiceLanguage ?? "en")}: ${voice.text}`);
    const unknown = unknownNames(voice.text);
    if (unknown.length) console.log(`[voiceover] names not in the pronunciation list: ${unknown.join(", ")}`);
  }
  // The YouTube Short's own voice (voiceover.ts youtubeVoiceOn): every English Short has the commentary, including those from main Page stories whose
  // Instagram and Facebook reels stay silent. A voiced topic Page reel already has one, and the Short uses it.
  const youtubeVoice = needYouTube && voiceLanguage && !voicePath && youtubeVoiceOn(process.env, voiceLanguage, article.id) ? await makeVoice(buildVoiceScript(content, article.category, voiceDescription, voiceLanguage), buildShortScript(content, article.category, voiceLanguage), pickVoice(article.id, voiceLanguage), voiceSeed) : null;
  const youtubeVoicePath = voicePath ?? youtubeVoice?.path ?? null;
  if (youtubeVoice) console.log(`[voiceover] YouTube Short only, ${youtubeVoice.seconds.toFixed(1)} s, ${voiceSource(youtubeVoice.text, content, article.category, voiceDescription, voiceLanguage ?? "en")}: ${youtubeVoice.text}`);
  setDecisionContext(article.id, reelFeatures({ category: article.category, title: article.title, hashtags: (opts.topicPage?.hashtags ?? selectFacebookHashtags)(article.title, article.category), publishedAt: article.publishedAt, trendingScore: article.trendingScore ?? null, now: new Date(), theme, music, font: opts.font, language: locale, topicKey: opts.topicPage?.key, captionVariant: captionVariantFor(articleId), hook: content.hook, factRows: content.rows.length, storyType, hookMeta: content.hookMeta, opening, voice: voicePath ? voiceName : null, youtubeVoice: Boolean(youtubeVoicePath), layout: layoutKind, noPhoto: isFallbackCard(article.heroImageUrl), captionKeyword: opts.topicPage ? null : mainKeywordOn(article.id) }));
  console.log(`Rendering reel (music: ${music}, theme: ${theme ?? "default"}, font: ${opts.font ?? "default"})...`);
  // The score of the match the story is about, when it is clearly one live or just finished (reelScore.ts); the original English headline names the teams.
  if (score) console.log(`[reel] score strip: ${score.home} ${score.homeScore} - ${score.awayScore} ${score.away} (${score.label})`);
  // Which version each destination gets (reelPlan.ts): no photo of its own -> the graphic reel everywhere; a photo -> the photo reel, with
  // the animated hook on Instagram, the topic Pages and YouTube (the main Page keeps the classic one).
  const plan = planReels({ noPhoto: isFallbackCard(article.heroImageUrl), isTopicPage: Boolean(opts.topicPage), needInstagram, needFacebook, needYouTube, ...reelSwitches(process.env) });
  if (plan.graphic) console.log("[reel] no photo of its own: graphic reel (drawn art, animated hook)");
  const render = (youtube: boolean, motionHook: boolean, facebook = false) => renderReel({ content, heroImageUrl: article.heroImageUrl!, category: article.category, credit: article.heroImageCredit, musicStyle: music, theme, font: opts.font, language: locale, score, facebook, followHandle: opts.topicPage ? opts.topicPage.instagramHandle ?? null : undefined, youtube, opening, voicePath: (youtube ? youtubeVoicePath : voicePath) ?? undefined, graphic: plan.graphic ? { seed: article.id } : undefined, motionHook, soundHook: Boolean(opts.topicPage), punchZoom: Boolean(opts.topicPage) });
  // Instagram/Facebook share one render per version (motion hook or classic); the YouTube Short gets its own end card (Subscribe, link in the description).
  // Only Instagram uses the shared renders now (Facebook has its own below), so a version only Facebook wanted is not rendered twice.
  const mp4Motion = needInstagram && plan.instagramMotion ? await render(false, true) : null;
  const mp4Classic = needInstagram && !plan.instagramMotion ? await render(false, false) : null;
  for (const m of [mp4Motion, mp4Classic]) if (m) console.log(`Rendered ${(m.length / 1024 / 1024).toFixed(1)} MB`);
  const mp4Instagram = plan.instagramMotion ? mp4Motion : mp4Classic;
  // Facebook gets its own render, with an end card that does not say "link in bio" or name an Instagram handle (reel.tsx endCardText).
  const mp4Facebook = needFacebook ? await render(false, plan.facebookMotion, true).catch((err) => { console.error("Facebook end-card render failed:", err); return null; }) : null;

  const siteUrl = locale ? `https://${LOCALES[locale].host}` : process.env.SITE_URL ?? "https://sportswirelive.com";
  const articleUrl = socialArticleUrl(siteUrl, tr?.slug ?? article.slug, "facebook", reelVariant, opts.topicPage?.key);
  const instagramPosted = needInstagram && mp4Instagram ? await postReelToInstagram(article, mp4Instagram, captions, opts.topicPage) : false;
  const facebookPosted = needFacebook && mp4Facebook ? await postReelToFacebook(article, mp4Facebook, captions, articleUrl, opts.topicPage, facebookShortCaption(captionVariantFor(articleId), Boolean(opts.topicPage?.reelCaptionTest))) : false;
  // Never lets a YouTube problem (e.g. the row insert) undo the Instagram/Facebook posts above.
  const youtubePosted = needYouTube ? await render(true, plan.youtubeMotion).then((yt) => postReelToYouTube(article, yt, captions, socialArticleUrl(siteUrl, tr?.slug ?? article.slug, "youtube"), content.hook, textTitle, opts.topicPage)).catch((err) => { console.error("[youtube short] failed:", err); return false; }) : false;
  return { instagramPosted, facebookPosted, youtubePosted };
}
