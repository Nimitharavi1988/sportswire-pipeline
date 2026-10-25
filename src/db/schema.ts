// Drizzle schema, hand-translated from prisma/schema.prisma (2026-09-19
// Prisma -> Drizzle migration). Table/column names match Prisma's defaults
// exactly (no @@map/@map anywhere in the Prisma schema, so table names are
// the model names as-written and column names are the field names
// as-written) -- confirmed directly against the real database via a raw
// SQL query during the migration's own feasibility test.
import { pgTable, pgEnum, text, boolean, doublePrecision, integer, timestamp, jsonb, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const articleStatusEnum = pgEnum("ArticleStatus", [
  "ingested", "auto_checked", "flagged", "pending_review", "approved", "published", "rejected",
  // An original story being written in admin (Write a story), not yet live.
  "draft",
]);
// "push" added 2026-09-24 for automated breaking-news push notifications
// (see autoApprove.ts's sendAutomatedPushNotifications) -- reuses this
// table/enum rather than a bespoke Article column so idempotency (has this
// article already been pushed) and the daily cap both use the exact same
// query shape already established here for Facebook/Instagram.
export const socialPlatformEnum = pgEnum("SocialPlatform", ["facebook", "x", "instagram", "push", "youtube"]);
export const socialPostStatusEnum = pgEnum("SocialPostStatus", ["queued", "posted", "failed"]);
export const reactionTypeEnum = pgEnum("ReactionType", ["hype", "panic", "neutral"]);

export type ReactionType = (typeof reactionTypeEnum.enumValues)[number];
export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];

export const vertical = pgTable("Vertical", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  domain: text("domain"),
  facebookPageId: text("facebookPageId"),
  facebookPageAccessToken: text("facebookPageAccessToken"),
  instagramBusinessAccountId: text("instagramBusinessAccountId"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

export const article = pgTable("Article", {
  id: text("id").primaryKey(),
  verticalId: text("verticalId").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  summary: text("summary").notNull(),
  body: text("body"),
  sourceUrl: text("sourceUrl").notNull(),
  sourceName: text("sourceName").notNull(),
  category: text("category").notNull(),
  status: articleStatusEnum("status").notNull().default("ingested"),
  profanityFlag: boolean("profanityFlag").notNull().default(false),
  profanityDetail: text("profanityDetail"),
  readabilityScore: doublePrecision("readabilityScore"),
  trendingScore: doublePrecision("trendingScore").notNull().default(0),
  reviewedBy: text("reviewedBy"),
  reviewedAt: timestamp("reviewedAt", { precision: 3 }),
  publishedAt: timestamp("publishedAt", { precision: 3 }),
  dedupeHash: text("dedupeHash").notNull().unique(),
  homeCrestUrl: text("homeCrestUrl"),
  awayCrestUrl: text("awayCrestUrl"),
  heroImageUrl: text("heroImageUrl"),
  heroImageCredit: text("heroImageCredit"),
  heroImageCreditUrl: text("heroImageCreditUrl"),
  featured: boolean("featured").notNull().default(false),
  featuredAt: timestamp("featuredAt", { precision: 3 }),
  highlighted: boolean("highlighted").notNull().default(false),
  highlightedAt: timestamp("highlightedAt", { precision: 3 }),
  playerNewsSourced: boolean("playerNewsSourced").notNull().default(false),
  homeTeam: text("homeTeam"),
  awayTeam: text("awayTeam"),
  homeScore: integer("homeScore"),
  awayScore: integer("awayScore"),
  matchStatus: text("matchStatus"),
  kickoffAt: timestamp("kickoffAt", { precision: 3 }),
  homeScoreText: text("homeScoreText"),
  awayScoreText: text("awayScoreText"),
  // Why ingestion/auto-approval rejected it ("source page unreadable (http
  // 403)", "AI returned no write-up", ...), for diagnosing sources.
  rejectionReason: text("rejectionReason"),
  seriesKey: text("seriesKey"),
  seriesLabel: text("seriesLabel"),
  venue: text("venue"),
  // Scoreboard fields (added 2026-09-25 via ALTER TABLE, all nullable, for
  // the standardized score cards / match header — see src/lib/scores/).
  // Written by match-data sources only; null for everything else.
  // "NFL · Week 4", "Premier League", "India v West Indies" — the heading a
  // game is grouped under on /scores.
  leagueLabel: text("leagueLabel"),
  // Live status only ("Q3 · 8:42", "Halftime", "67'"); null before kickoff
  // and after the final, so a stale clock can never outlive the game.
  matchClock: text("matchClock"),
  // One-line situation under the score ("India need 93 runs from 70 balls").
  matchNote: text("matchNote"),
  // Team records at the time of the game ("3-0"), when the source has them.
  homeRecord: text("homeRecord"),
  awayRecord: text("awayRecord"),
  // TV/stream channel for upcoming games ("FOX"), when the source has it.
  broadcast: text("broadcast"),
  // Provider-independent identity: `${category}:${yyyy-mm-dd}:${home}-v-${away}`
  // (slugified). dedupeHash stays provider-specific (espn-nfl-<id>); this is
  // what lets a second provider be compared against, or swapped in for, the
  // first without creating a duplicate match. See lib/scores/matchKey.ts.
  matchKey: text("matchKey"),
  // The source whose scores are on this row when it isn't the row's own
  // (sourceName): a higher-priority provider for the same match takes over
  // its live score — see matchDataSources.ts `supersedes`. null = sourceName.
  scoreSource: text("scoreSource"),
  // Byline: set on original stories and on ones an editor rewrote (Author).
  authorSlug: text("authorSlug"),
  // What kind of original piece it is (lib/stories.ts STORY_KINDS).
  storyKind: text("storyKind"),
  // Added 2026-09-24 ahead of a planned (not yet implemented) Spanish-
  // language content pipeline -- default 'en' means every existing row and
  // every current (English-only) ingestion source is unaffected. Drives the
  // Postgres text-search config choice for `searchVector` below (English
  // stemming is wrong for Spanish text, and vice versa), and is the same
  // field a future <html lang>/hreflang/RSS <language> implementation would
  // need -- cheap to add now, expensive to retrofit once searchVector's
  // GENERATED expression and 18,000+ rows already assume English-only.
  language: text("language").notNull().default("en"),
  // GENERATED ALWAYS AS ... STORED in Postgres itself (see the migration
  // that added this column) -- Postgres maintains it automatically on every
  // insert/update, so it's intentionally NOT a normal Drizzle column here
  // (the app never writes to it directly, only queries against it via raw
  // sql`"searchVector"` fragments, same pattern as titleMatch.ts's regex
  // helper). Declaring it here is just documentation of what really exists
  // in the table -- Drizzle has no native tsvector column type to declare
  // it with anyway.
  // searchVector: tsvector, GENERATED ALWAYS AS (...) STORED — see search/page.tsx
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { precision: 3 }).notNull(),
}, (t) => [
  index("Article_status_idx").on(t.status),
  index("Article_category_idx").on(t.category),
  index("Article_matchStatus_kickoffAt_idx").on(t.matchStatus, t.kickoffAt),
  index("Article_seriesKey_idx").on(t.seriesKey),
  index("Article_matchKey_idx").on(t.matchKey),
  // Created in production 2026-10-21 with CREATE INDEX CONCURRENTLY; they serve the list queries (latest / per category).
  index("Article_status_publishedAt_idx").on(t.status, t.publishedAt.desc()),
  index("Article_category_publishedAt_idx").on(t.category, t.publishedAt.desc()),
]);

// Per-language copy of a published article (Spanish site, see PLAN.md). Created
// 2026-10-02 via scripts/sql/2026-10-02-article-translation.sql. The table also
// has a generated "searchVector" tsvector column (per-locale text-search
// config) that, like Article's, is only queried via raw sql.
// title/summary/body/slug are null on a failed row; only status 'translated'
// rows are ever shown. sourceHash = hash of the English text it was made from.
export const articleTranslation = pgTable("ArticleTranslation", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull().references(() => article.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  title: text("title"),
  summary: text("summary"),
  body: text("body"),
  slug: text("slug"),
  sourceHash: text("sourceHash").notNull(),
  status: text("status").notNull().default("translated"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("lastError"),
  model: text("model"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ArticleTranslation_articleId_locale_key").on(t.articleId, t.locale),
  uniqueIndex("ArticleTranslation_locale_slug_key").on(t.locale, t.slug),
  index("ArticleTranslation_locale_status_idx").on(t.locale, t.status),
]);

export const socialPost = pgTable("SocialPost", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull(),
  platform: socialPlatformEnum("platform").notNull(),
  // Which Page/account: "main" (Sports Wire Live) or a topic Page key
  // (social/facebookDestinations.ts). Each has its own posting history.
  destination: text("destination").notNull().default("main"),
  status: socialPostStatusEnum("status").notNull().default("queued"),
  externalPostId: text("externalPostId"),
  errorMessage: text("errorMessage"),
  postedAt: timestamp("postedAt", { precision: 3 }),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

// Decision log (social/decisionLog.ts): one row per reel/Short decision, with the features it was made with.
export const postDecision = pgTable("PostDecision", {
  id: text("id").primaryKey(),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
  articleId: text("articleId"),
  platform: text("platform").notNull(),
  destination: text("destination").notNull(),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason"),
  features: jsonb("features"),
  externalPostId: text("externalPostId"),
}, (t) => [
  index("PostDecision_createdAt_idx").on(t.createdAt),
  index("PostDecision_article_idx").on(t.articleId),
  index("PostDecision_stream_idx").on(t.platform, t.destination, t.createdAt),
]);

export const source = pgTable("Source", {
  id: text("id").primaryKey(),
  verticalId: text("verticalId").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
  lastPolledAt: timestamp("lastPolledAt", { precision: 3 }),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

// Videos from official league/broadcaster YouTube channels (created
// 2026-09-25 via CREATE TABLE, like the other schema changes). Filled by
// ingestion/youtubeVideos.ts from each channel's public RSS feed — no API
// key, no quota. Only regular videos (not Shorts) that YouTube allows to be
// embedded; played through YouTube's own player, never re-hosted.
// isHighlights + matchArticleId link a highlights video to the match story
// it's about, for the video on that match page.
// Per-event data kept outside articles (events/eventHubs.ts), e.g. a
// Games' medal table — one row per key ("asian-games-2026:medals"), holding
// the last snapshot that passed its checks.
export const eventData = pgTable("EventData", {
  key: text("key").primaryKey(),
  eventKey: text("eventKey").notNull(),
  kind: text("kind").notNull(),
  data: jsonb("data").notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  fetchedAt: timestamp("fetchedAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [index("EventData_eventKey_idx").on(t.eventKey)]);

// Stored copies of third-party tables shown on the site (standings) —
// written by the ingestion job, read by pages (snapshots/read.ts).
export const dataSnapshot = pgTable("DataSnapshot", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  fetchedAt: timestamp("fetchedAt", { precision: 3 }).notNull().defaultNow(),
});

// Errors readers hit in the browser (the "Something went wrong" page),
// reported by src/app/error.tsx via /api/client-error — the only way to
// see a crash that happens on a reader's device and not in testing.
export const clientError = pgTable("ClientError", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  message: text("message").notNull(),
  stack: text("stack"),
  digest: text("digest"),
  url: text("url"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [index("ClientError_createdAt_idx").on(t.createdAt)]);

// Tags an editor chose for a story (admin story editor): the players,
// teams, countries and venues it is about — on top of the automatic
// headline matching (lib/tags.ts). kind: player | club | country | venue.
export const articleTag = pgTable("ArticleTag", {
  articleId: text("articleId").notNull().references(() => article.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  slug: text("slug").notNull(),
}, (t) => [primaryKey({ columns: [t.articleId, t.kind, t.slug] }), index("ArticleTag_kind_slug_idx").on(t.kind, t.slug)]);

// Story Ideas (lib/storyIdeas.ts) the editor dismissed or started a story
// from — ideas themselves are worked out from live data each time, so only
// this is stored (created 2026-09-28 via CREATE TABLE).
export const storyIdea = pgTable("StoryIdea", {
  key: text("key").primaryKey(),
  // "dismissed" | "used"
  status: text("status").notNull(),
  articleId: text("articleId"),
  updatedAt: timestamp("updatedAt", { precision: 3 }).notNull().defaultNow(),
});

// A social poster image while it's being posted (socialPoster.ts): served at
// /social-posters/<slug>.png for Instagram/Facebook to fetch, deleted right
// after. Was a git commit + a second commit to remove it — each one a full
// site deploy, ~100 a day, wiping the page cache every time (2026-09-28).
// PNG as base64 (Neon's HTTP driver moves text reliably). Created
// 2026-09-28 via CREATE TABLE.
export const socialPosterImage = pgTable("SocialPosterImage", {
  slug: text("slug").primaryKey(),
  pngBase64: text("pngBase64").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

// People who write for the site — the byline on original and editor-
// rewritten stories, with their own page (/author/[slug]).
export const author = pgTable("Author", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

export const video = pgTable("Video", {
  id: text("id").primaryKey(),
  youtubeId: text("youtubeId").notNull(),
  channelId: text("channelId").notNull(),
  channelTitle: text("channelTitle").notNull(),
  title: text("title").notNull(),
  publishedAt: timestamp("publishedAt", { precision: 3 }).notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  // Top-level sport category, same values as Article.category's first part.
  category: text("category").notNull(),
  isHighlights: boolean("isHighlights").notNull().default(false),
  matchArticleId: text("matchArticleId"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("Video_youtubeId_key").on(t.youtubeId),
  index("Video_matchArticleId_idx").on(t.matchArticleId),
  index("Video_category_publishedAt_idx").on(t.category, t.publishedAt),
]);

// Web Push subscriptions — anonymous, one row per browser that's granted
// notification permission (see ServiceWorkerRegister.tsx/public/sw.js). No
// article/user relation: an admin-triggered push (admin/actions.ts) sends
// to every row here, same "no accounts, anonymous by cookie/endpoint"
// pattern Poll/ArticleReaction already use.
export const pushSubscription = pgTable("PushSubscription", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

export const adminUser = pgTable("AdminUser", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
});

export const poll = pgTable("Poll", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull().unique(),
  question: text("question").notNull(),
  // "editorial" = made by hand in admin; "prediction" = auto-created "Who will
  // win?" for a match (lib/predictions.ts). A prediction closes at kickoff and
  // is resolved after full time: resolvedAt set, with resolvedOptionId = the
  // winning option, or null when the match had no winner (void).
  kind: text("kind").notNull().default("editorial"),
  resolvedOptionId: text("resolvedOptionId"),
  resolvedAt: timestamp("resolvedAt", { precision: 3 }),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  index("Poll_kind_resolvedAt_idx").on(t.kind, t.resolvedAt),
]);

export const pollOption = pgTable("PollOption", {
  id: text("id").primaryKey(),
  pollId: text("pollId").notNull(),
  text: text("text").notNull(),
  // Prediction polls only: "home" | "away" | "draw".
  outcome: text("outcome"),
}, (t) => [
  index("PollOption_pollId_idx").on(t.pollId),
]);

export const pollVote = pgTable("PollVote", {
  id: text("id").primaryKey(),
  pollId: text("pollId").notNull(),
  optionId: text("optionId").notNull(),
  cookieId: text("cookieId").notNull(),
  ipAddress: text("ipAddress"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("PollVote_pollId_cookieId_key").on(t.pollId, t.cookieId),
  index("PollVote_optionId_idx").on(t.optionId),
]);

export const articleReaction = pgTable("ArticleReaction", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull(),
  type: reactionTypeEnum("type").notNull(),
  cookieId: text("cookieId").notNull(),
  ipAddress: text("ipAddress"),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ArticleReaction_articleId_cookieId_key").on(t.articleId, t.cookieId),
  index("ArticleReaction_articleId_type_idx").on(t.articleId, t.type),
]);

// Relations (mirrors Prisma's implicit relations, needed for Drizzle's
// relational query API — `db.query.article.findMany({ with: {...} })`).
export const articleRelations = relations(article, ({ one, many }) => ({
  vertical: one(vertical, { fields: [article.verticalId], references: [vertical.id] }),
  socialPosts: many(socialPost),
  poll: one(poll, { fields: [article.id], references: [poll.articleId] }),
  reactions: many(articleReaction),
}));

export const verticalRelations = relations(vertical, ({ many }) => ({
  articles: many(article),
  sources: many(source),
}));

export const socialPostRelations = relations(socialPost, ({ one }) => ({
  article: one(article, { fields: [socialPost.articleId], references: [article.id] }),
}));

export const sourceRelations = relations(source, ({ one }) => ({
  vertical: one(vertical, { fields: [source.verticalId], references: [vertical.id] }),
}));

export const pollRelations = relations(poll, ({ one, many }) => ({
  article: one(article, { fields: [poll.articleId], references: [article.id] }),
  options: many(pollOption),
  votes: many(pollVote),
}));

export const pollOptionRelations = relations(pollOption, ({ one, many }) => ({
  poll: one(poll, { fields: [pollOption.pollId], references: [poll.id] }),
  votes: many(pollVote),
}));

export const pollVoteRelations = relations(pollVote, ({ one }) => ({
  poll: one(poll, { fields: [pollVote.pollId], references: [poll.id] }),
  option: one(pollOption, { fields: [pollVote.optionId], references: [pollOption.id] }),
}));

export const articleReactionRelations = relations(articleReaction, ({ one }) => ({
  article: one(article, { fields: [articleReaction.articleId], references: [article.id] }),
}));

// Anonymous daily counters for app-install funnel (banner shown, accepted,
// installed, launched from the home screen). No user/device identifiers.
export const appEvent = pgTable("AppEvent", {
  day: text("day").notNull(),
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.kind] })]);

// 1-5 rating of a finished match, one per visitor per match (changeable).
export const matchRating = pgTable("MatchRating", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull(),
  voterId: text("voterId").notNull(),
  rating: integer("rating").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("MatchRating_articleId_voterId_key").on(t.articleId, t.voterId),
]);

// Private "how are we doing" notes from the /feedback page. Read in admin only,
// never shown to other visitors.
export const siteFeedback = pgTable("SiteFeedback", {
  id: text("id").primaryKey(),
  voterId: text("voterId").notNull(),
  sentiment: text("sentiment").notNull(), // "up" | "down"
  note: text("note"),
  page: text("page"),
  handled: boolean("handled").notNull().default(false),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  index("SiteFeedback_createdAt_idx").on(t.createdAt),
]);

// A fan's short take on a match. Shown publicly only once approved in admin.
export const fanVoice = pgTable("FanVoice", {
  id: text("id").primaryKey(),
  articleId: text("articleId").notNull(),
  voterId: text("voterId").notNull(),
  name: text("name").notNull(),
  country: text("country"),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewedAt", { precision: 3 }),
}, (t) => [
  uniqueIndex("FanVoice_articleId_voterId_key").on(t.articleId, t.voterId),
  index("FanVoice_status_createdAt_idx").on(t.status, t.createdAt),
  index("FanVoice_articleId_status_idx").on(t.articleId, t.status),
]);

// One row per anonymous visitor (swl_voter_id cookie) per day they were active
// (see lib/fan.ts, lib/fanStore.ts). `day` is the visitor's local date as
// YYYY-MM-DD. No name, email or account: just the opaque cookie id.
export const fanVisit = pgTable("FanVisit", {
  voterId: text("voterId").notNull(),
  day: text("day").notNull(),
  createdAt: timestamp("createdAt", { precision: 3 }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.voterId, t.day] }),
  index("FanVisit_day_idx").on(t.day),
]);
