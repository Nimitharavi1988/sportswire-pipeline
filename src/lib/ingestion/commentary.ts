/**
 * Original commentary generation using Google Gemini's free API tier, for
 * two distinct input shapes:
 *  - RSS-sourced news: the source's own text (sourceSnippet) is used ONLY as
 *    grounding input — never stored or displayed as-is — to avoid
 *    republishing the publisher's copyrighted prose (see rssFeeds.ts).
 *  - Structured match data (football-data.org / CricketData.org): our own
 *    factual data (score, competition, standings context), not another
 *    publisher's article, expanded from a bare template into real prose.
 * In both cases the model is instructed to write in its own words, using
 * only the given facts, with no invented details.
 *
 * Docs: https://ai.google.dev/gemini-api/docs
 * Free tier: no credit card required, rate-limited (see Google AI Studio).
 */

import { getRouter } from "../llm";
import { ungroundedNumbers } from "../llm/grounding";
import type { LlmRouter } from "../llm/router";
import type { Priority } from "../llm/ledger";
import type { GeminiSchema } from "../llm/schema";
import { STYLE_GUIDE, type HookStyle } from "../social/hookStyles";
import { chooseHook, type HookCandidate, type HookChoice } from "../social/hookChoice";

// Lite tier — confirmed live (2026-09-19) resolves to gemini-3.5-flash-lite,
// at a fraction of the standard Flash tier's per-token cost (Flash-Lite is
// roughly 6x cheaper on input and 12x cheaper on output per Google's current
// pricing). Same "-latest" auto-tracking alias pattern as before, just the
// lite family instead of the standard one — every call here is short
// factual summarization/translation grounded in given facts, not open-ended
// reasoning, which is exactly the workload the lite tier is designed for.
export const MODEL = "gemini-flash-lite-latest";

export function buildRssPrompt(title: string, sourceSnippet: string, sourceName: string): string {
  return `You are writing a brief original news blurb for a sports aggregator site, based on a report from ${sourceName}.

Headline: "${title}"

Facts from the source report (for reference only — do not copy any phrase or sentence from this text):
"""
${sourceSnippet}
"""

Write a fuller original blurb (aim for 2 short paragraphs, roughly 5-8 sentences total when the facts support it) covering every concrete fact given above — names, numbers, results, context — in your own words and sentence structure. Rules:
- Never copy phrasing verbatim or near-verbatim from the facts above — use entirely your own wording and sentence structure throughout.
- Never invent any fact, statistic, quote, or detail not present in the facts above. Do not pad length with generic filler, speculation, or restating the same fact twice — only expand as far as the real facts given actually go.
- If the facts above are too thin to fill that length without inventing or repeating, write a shorter piece instead — brevity is always better than padding.
- If the facts above contain no real, substantive, reportable information at all — no actual score, statement, decision, or specific development, just a bare name/place/headline restated — do not paper over that gap with vague hedge sentences ("X has been highlighted in recent coverage", "no further details were provided"), vague hype language that sounds exciting but conveys nothing concrete ("action is underway", "immediate fireworks", "explosive start", "set an early tone", "off to a flying start"), OR self-referential sentences that describe the existence of coverage instead of the actual event ("MLB.com has published an analytical breakdown of Gerrit Cole's pitching arsenal", "The feature examines the mechanics behind the blast", "This analysis centers on..."). That last pattern is especially common when the source is a short video-clip title (e.g. "Breaking down X's pitches", "Field View: Y homers") with no real substance behind the headline — describing that a breakdown/analysis/feature exists is not the same as reporting a fact, even though it reads grammatically like a real sentence. A reader must learn at least one real, specific, checkable fact from every sentence you write — if you can't do that because the facts above genuinely don't contain one, return an empty commentary instead. An honest empty result is always better than a sentence that merely sounds like news.
- Separate paragraphs with a literal blank line (two newlines) — never return the whole thing as one unbroken block.
- Do not mention that you were given source material or instructions — just write the blurb itself.
- Plain text only, no markdown.

Also list the real, named individuals (athletes, coaches, or officials) this story is centrally about — not team names, and not any journalist, reporter, or pundit merely cited as the source of the report. Order them by prominence to the story (most central first), fullest real name as it would appear as a Wikipedia article title (e.g. "Ben Stokes", not "Stokes" or "the England captain"). Include more than one only when multiple people are genuinely co-central (e.g. a batter and a bowler both credited for a result) — don't pad the list with minor mentions. If no specific named athlete/coach/official is truly central, leave personNames empty.

Also extract the real-world venue/stadium name (e.g. "Old Trafford", "Lord's", "the MCG") ONLY if the facts above genuinely state where this happened — never guess, infer from the teams/competition, or fill in a team's usual home ground. If no venue is explicitly stated in the facts, leave venue empty.`;
}

function buildMatchPrompt(title: string, factsText: string, competitionName: string): string {
  return `You are writing a short match recap for a sports news site. This is NOT another publisher's article — it's our own structured match data, and you're expanding it into real prose.

Match: "${title}"
Competition: ${competitionName}

Facts (from our own match data — this is the complete set of facts available, nothing else is known about this match):
"""
${factsText}
"""

Write a short, original recap (roughly 4-7 sentences, 2 short paragraphs at most) covering the facts above — result or fixture details, competition context, league standing/form where given — in natural sports-journalism prose. Rules:
- Use ONLY the facts given above. Never invent goalscorers, assists, cards, injuries, lineups, or any other detail not present in the facts — we deliberately don't have play-by-play data at this tier, so do not fabricate it.
- Vary sentence structure and wording rather than restating the facts in the same order and phrasing they're given in.
- If the facts are too thin to fill that length without inventing or repeating, write a shorter piece instead — brevity is always better than padding or fabrication.
- Separate paragraphs with a literal blank line (two newlines) — never return the whole thing as one unbroken block.
- Do not mention that you were given source material or instructions, and do not repeat the headline verbatim at the top — just write the recap itself.
- Plain text only, no markdown.`;
}

interface GeminiCallOptions {
  responseSchema: object;
  // Per-call overrides. Default is the lite model at temperature 0.3 — right
  // for faithful summarization; the short, high-value Instagram copy below
  // opts into the standard Flash model and a little more creativity.
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  // Retries (with growing waits) on a temporary Gemini error (429/5xx) before the
  // run is declared unavailable. Default 0 = unchanged behaviour; the translation
  // job opts in so a brief outage mid-run does not abandon the whole batch.
  retries?: number;
  // How much of a free tier's daily allowance this call may use when the AI
  // router is on (llm/ledger.ts SOFT_CAP): "high" work can use nearly all of
  // it, "low" (social copy) only a share, so a busy day's bulk work doesn't
  // leave nothing for the work that matters. Default "normal".
  priority?: Priority;
}

// Standard Flash for the Instagram hook/caption writing (2026-10-01): a few
// short lines per post where writing quality drives reach, so the extra cost
// per call is tiny next to the lite model used for bulk summarization.
const COPY_MODEL = "gemini-flash-latest";

// Set when Gemini says it can't serve requests at all (out of credits,
// rate-limited, auth or server errors) — as opposed to answering and
// producing nothing usable. Callers use it to leave stories waiting
// instead of rejecting them (confirmed 2026-09-26: prepaid credits ran out,
// every call returned 402, and every story was rejected as if the model
// had declined it). Once set, further calls in this run are skipped.
let unavailable: string | null = null;

export function aiUnavailableReason(): string | null {
  return unavailable;
}

const UNAVAILABLE_STATUSES = new Set([401, 402, 403, 429, 500, 502, 503, 504]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_WAITS_MS = [5_000, 15_000, 45_000, 90_000];
const RETRY = Symbol("retry");

// With LLM_ROUTER=1 (llm/index.ts) the call goes to the first free provider
// that has room, falling through Gemini's free tier, Groq and OpenRouter; the
// model option only picks the tier (lite by default, standard for a
// non-default model). Otherwise it's the Gemini call below, unchanged.
async function callViaRouter(router: LlmRouter, prompt: string, options: GeminiCallOptions): Promise<unknown> {
  if (unavailable) return null;
  const result = await router.json({
    prompt,
    schema: options.responseSchema as GeminiSchema,
    tier: options.model && options.model !== MODEL ? "standard" : "lite",
    priority: options.priority,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  });
  if (result.data) return result.data;
  // Out of room everywhere is no verdict on the story: like a Gemini outage,
  // it stays waiting for a later run. Only "answered, but unusable" is.
  if (result.failure !== "invalid") unavailable = "AI unavailable (every free provider is at its limit)";
  return null;
}

export async function callGemini(prompt: string, options: GeminiCallOptions): Promise<any | null> {
  const router = await getRouter();
  if (router) return callViaRouter(router, prompt, options);
  const retries = options.retries ?? 0;
  for (let attempt = 0; ; attempt++) {
    const out = await callGeminiOnce(prompt, options, attempt < retries);
    if (out !== RETRY) return out;
    await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)]));
  }
}

async function callGeminiOnce(prompt: string, options: GeminiCallOptions, willRetry: boolean): Promise<any | null | typeof RETRY> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    unavailable = "AI not configured (GEMINI_API_KEY unset)";
    return null;
  }
  if (unavailable) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${options.model ?? MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // No thinkingConfig override — confirmed live (2026-09-19) that
            // gemini-flash-lite-latest (gemini-3.5-flash-lite) rejects
            // thinkingBudget: 0 outright (400 INVALID_ARGUMENT), unlike the
            // standard Flash tier this used to target. usageMetadata on this
            // model shows no separate hidden reasoning-token cost anyway
            // (totalTokenCount == promptTokenCount + candidatesTokenCount in
            // every test call), so there's nothing to disable here.
            // Standard Flash spends output tokens on hidden reasoning unless told
            // not to, which truncated the JSON at the 1-2k cap (seen live).
            ...(options.model ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            responseMimeType: "application/json",
            responseSchema: options.responseSchema,
            // Low, not zero — a little variation keeps prose from feeling
            // templated across near-identical stories, but the whole point
            // of every prompt here is "stay faithful to the given facts,
            // never invent," so a high-creativity default fights that goal.
            // Free to set, no cost impact either way.
            temperature: options.temperature ?? 0.3,
            // Every prompt here asks for a couple short paragraphs at most —
            // this caps worst-case cost on an occasional runaway response
            // rather than silently paying for output nobody wants.
            maxOutputTokens: options.maxOutputTokens ?? 1024,
          },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Gemini generation failed: ${res.status} ${detail.slice(0, 200)}`);
      if (willRetry && RETRYABLE_STATUSES.has(res.status)) return RETRY;
      if (UNAVAILABLE_STATUSES.has(res.status)) {
        unavailable = res.status === 402 ? "AI unavailable (402: credits depleted)" : `AI unavailable (HTTP ${res.status})`;
      }
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini generation error:", err);
    return null;
  }
}

export interface CommentaryResult {
  commentary: string | null;
  personNames: string[];
  // Real venue/stadium name, only when genuinely stated in the source
  // text — never inferred from the teams/competition. Extracted from the
  // same Gemini call rather than a separate one, since the model is
  // already reading the full grounded text here. Powers SportsEvent
  // JSON-LD's "location" field (see article/[slug]/page.tsx) for
  // editorial/RSS match reports, extending real venue coverage beyond the
  // structured match-data sources (CricketData.org/ESPN NFL).
  venue: string | null;
}

const EMPTY_RESULT: CommentaryResult = { commentary: null, personNames: [], venue: null };

export async function generateCommentary(
  title: string,
  sourceSnippet: string | undefined,
  sourceName: string
): Promise<CommentaryResult> {
  if (!sourceSnippet || sourceSnippet.trim().length < 20) return EMPTY_RESULT;

  const parsed = await callGemini(buildRssPrompt(title, sourceSnippet, sourceName), {
    responseSchema: {
      type: "OBJECT",
      properties: {
        commentary: { type: "STRING" },
        personNames: { type: "ARRAY", items: { type: "STRING" } },
        venue: { type: "STRING" },
      },
      required: ["commentary", "personNames", "venue"],
    },
  });
  if (!parsed) return EMPTY_RESULT;

  const commentary = typeof parsed.commentary === "string" ? parsed.commentary.trim() : "";
  // With the AI router on, any provider may have written this, and the free
  // fallbacks are less careful than Gemini: a figure that isn't in the source
  // is an invention, so the write-up is dropped (llm/grounding.ts).
  if (commentary && (await getRouter())) {
    const invented = ungroundedNumbers(commentary, `${title}\n${sourceSnippet}`);
    if (invented.length > 0) {
      console.log(`[ai] write-up for "${title.slice(0, 60)}" dropped: figures not in the source (${invented.join(", ")})`);
      return EMPTY_RESULT;
    }
  }
  const personNames: string[] = Array.isArray(parsed.personNames)
    ? parsed.personNames
        .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n: string) => n.trim())
    : [];
  const venue = typeof parsed.venue === "string" && parsed.venue.trim().length > 0 ? parsed.venue.trim() : null;
  return { commentary: commentary || null, personNames, venue };
}

// buildRssPrompt above already instructs the model to self-police vagueness
// in the same generation pass ("if you can't [state a real, specific,
// checkable fact], return an empty commentary instead") -- confirmed live
// 2026-09-20 that it doesn't reliably follow that instruction: a real
// published example ("During the recent match, Manchester City secured a
// high-scoring moment when Erling Haaland successfully converted from close
// range at the far post...") named no opponent, no score, nothing
// checkable, despite the rule. Asking a model to generate prose and
// critically self-assess it in the same autoregressive pass is weaker than
// a second, narrowly-scoped verification call -- this is that second call.
// Deliberately NOT folded into generateCommentary's own response schema for
// the same reason: a self-reported "hasSubstance: true" field returned
// alongside text the model just committed to writing has the identical
// self-assessment weakness this exists to avoid.
function buildSubstanceCheckPrompt(title: string, commentary: string): string {
  return `Headline: "${title}"

Text to check:
"""
${commentary}
"""

Does the text above contain at least one specific, checkable fact (a number, a named individual beyond who's already in the headline, a direct quote, or a concrete result/decision) that a reader couldn't already have guessed from the headline alone? Answer strictly based on the text given -- a sentence that merely restates the headline in different words, or reads as exciting but conveys nothing concrete, does not count.`;
}

export async function verifyCommentaryHasSubstance(title: string, commentary: string): Promise<boolean> {
  const parsed = await callGemini(buildSubstanceCheckPrompt(title, commentary), {
    responseSchema: {
      type: "OBJECT",
      properties: { hasSubstance: { type: "BOOLEAN" } },
      required: ["hasSubstance"],
    },
  });
  // Fail open (treat as substantive) on a Gemini hiccup -- this check
  // narrows an already-generated, already-accepted-by-the-first-pass
  // commentary; a verification-call outage should never itself cause a
  // real, possibly-fine article to be rejected. Only an explicit `false`
  // from a successful check rejects.
  if (!parsed) return true;
  return parsed.hasSubstance !== false;
}

// Explicit-request caption upgrade (2026-09-22), replacing the previous
// mechanical "hook + truncated body" caption assembly in facebook.ts/
// instagram.ts. Deliberately does NOT generate hashtags here — those come
// from hashtagRepertoire.ts's deterministic, signal-based selection
// (category/title-text/player matches), not the model's judgment, so a tag
// can never be attached to an article it doesn't actually apply to. One
// call produces both platform captions together (cheaper than two calls,
// and keeps the two versions consistent with the same underlying facts).
export function buildSocialCaptionsPrompt(title: string, body: string, language?: string, facebookStyle?: "question" | "hook"): string {
  // "question": a photo post whose link goes in the first comment (see
  // postArticleToFacebook) — the caption invites a reply instead of asking for a click.
  // "hook": a link post whose first sentence must work on its own — Facebook cuts the
  // caption after ~125 characters behind "See more", which hid the closing call to action.
  const facebookHook = [
    "- HOOK FIRST: Facebook cuts the caption after roughly 125 characters behind a \"See more\" button, so the FIRST SENTENCE (under 110 characters) must stand alone and make someone want to open the story: lead with the most surprising or consequential real fact (a name, number or result) or the tension in the story, not scene-setting.",
    "- Close with one short line saying what the full story adds beyond this caption, naming something specific from the facts (a number, a quote, a next step). Do NOT use \"Click the link to read more\" or other stock wording.",
  ].join("\n");
  const facebookCta = facebookStyle === "hook"
    ? facebookHook
    : facebookStyle === "question"
    ? "- End with ONE genuine pick-a-side, prediction or reaction question that people can answer in a few words, about something the facts actually raise (never generic like \"What do you think?\"). For a match preview or a player milestone, open with the fixture, number or record. Do NOT tell readers to click a link — it is added separately."
    : "- End with a clear call to action telling readers to click the link to read more (your own wording, doesn't need to be verbatim).";
  const languageRule = language === "es"
    ? "\nLANGUAGE: Write BOTH captions in neutral Spanish for US Hispanic, Latin American and Spanish readers (no regional slang). Keep names of people, teams and competitions as they are normally written.\n"
    : "";
  return `You are an expert sports social media manager. Write two captions for the same story, one for Facebook and one for Instagram, following these platform rules exactly.
${languageRule}
Headline: "${title}"

Facts (the ONLY source of information you may use — never invent a detail, quote, or statistic not stated here):
"""
${body}
"""

FACEBOOK caption:
- Punchy, professional, engaging — 2-4 short sentences.
${facebookCta}
- Do not include any hashtags — those are added separately.
- Do not repeat the headline verbatim at the top.
- If the story is built around something a named player, coach or pundit said, lead with their exact words in quotation marks, attributed by name. Only use a quote that appears word for word in the facts; never paraphrase inside quotation marks.

INSTAGRAM caption:
- Longer than the Facebook version. Instagram cuts the caption off after roughly the first 100 characters behind a "...more" button, so the FIRST LINE must stand alone, be under 100 characters, and make someone want to tap: lead with the most surprising or consequential real fact (a name, number or result) or the tension in the story, not scene-setting and not the team's name alone.
- If the story is built around something a named player, coach or pundit said, the first line may be their exact words in quotation marks with their name (e.g. Gambhir: "this is not cricket"). Only a quote that appears word for word in the facts; never paraphrase inside quotation marks.
- Then 2-3 short paragraphs of real detail from the facts, with 1-3 emojis as visual breaks (not decorative clutter — each one should mark a real break in the text).
- Second to last line: one genuine engagement question or pick-a-side prompt that people can answer in a comment in a few words (e.g. "Who takes it?", "Fair call or not?"). It must be about something the facts actually raise, never generic ("What do you think?") and never a claim.
- Last line: a short note that the full story is linked in the bio (your own wording).
- Do not include any hashtags — those are added separately.
- Do not repeat the headline verbatim at the top.

Both captions must stay strictly true to the facts given above — no invented details, no speculation stated as fact. Emotion words must match the facts: use the source's own verb ("slams", "criticises") and never a stronger one ("furious", "outraged") unless the text says so. Plain text only, no markdown.`;
}

export interface SocialCaptions {
  facebook: string;
  instagram: string;
}

// language: "es" writes the captions in Spanish (the Spanish Page); default English.
export async function generateSocialCaptions(title: string, body: string, language?: string, facebookStyle?: "question" | "hook"): Promise<SocialCaptions | null> {
  if (!body || body.trim().length < 40) return null;

  const parsed = await callGemini(buildSocialCaptionsPrompt(title, body, language, facebookStyle), {
    priority: "low",
    model: COPY_MODEL,
    temperature: 0.6,
    maxOutputTokens: 2048,
    responseSchema: {
      type: "OBJECT",
      properties: {
        facebookCaption: { type: "STRING" },
        instagramCaption: { type: "STRING" },
      },
      required: ["facebookCaption", "instagramCaption"],
    },
  });
  if (!parsed) return null;

  const facebook = typeof parsed.facebookCaption === "string" ? parsed.facebookCaption.trim() : "";
  const instagram = typeof parsed.instagramCaption === "string" ? parsed.instagramCaption.trim() : "";
  if (!facebook || !instagram) return null;

  return { facebook, instagram };
}

function buildPosterPrompt(title: string, body: string, styles?: HookStyle[]): string {
  const base = `You are writing the on-image copy for a single sports-news Instagram poster (bold cover graphic, not the caption).

Headline: "${title}"

Full article text (the ONLY source of facts you may use):
"""
${body}
"""

Produce:
- eyebrow: a short all-caps category/context label, 2-4 words (e.g. "MANCHESTER DERBY", "TRANSFER NEWS", "MATCH REPORT"). No punctuation.
- hook: the first thing a stranger sees while scrolling, and the reason they stop or keep watching. Under 10 words, strictly true to the article. Lead with the single most surprising or consequential real fact (a specific name, number or result), then add stakes or tension when the text supports it: what it means, what's now on the line, the unexpected part, or a clear question the story answers. Prefer a concrete claim to a label. If the story is built around what a named person said, the hook may be their exact words (short, attributed, e.g. Gambhir: "not cricket"), only a quote that appears word for word in the article. Good: "Salah scores 3 in 20 minutes", "Eagles lose Hurts for the season?" (only if the text says so), "296 chased with 8 overs to spare". Bad: "A stunning night at Anfield", "Big news in the NFL", "You won't believe this". A curiosity gap is fine only when the answer is actually in the article; never state or imply anything the text doesn't support, and never imply a twist that didn't happen. Emotion words must match the source: use the article's own verb or a direct quote ("slams", "blasts", "admits") rather than a stronger one (not "furious", "outraged", "destroyed" unless the text says so). Punchy and accurate beats louder. Prefer a person's own reaction when the article has one: if it quotes a named player, coach or official, or reports what they said or revealed, a hook shaped like Name: "short exact quote" or Name opens up on X beats a summary of the result (the top-viewed sports Shorts of the week were mostly a named person plus a reaction, a record or a question). For an upset or a game decided on the last play, use the article's own strong verb (stuns, shocks, upsets) only if the article says so.
- rows: 3 to 5 short label/value pairs, a quick-read fact summary of the story (e.g. score, key name, key stat, outcome) — every value must be a real fact stated in the article text above, never invented or estimated. label is 1-3 words, value is under 8 words. Fewer, real rows are better than padding with invented or vague ones. Order rows most important first.
- Every row must be about the headline's own story: the same game, teams and people. Articles often end with other results, a roundup of other games, or related links; never take a row from those parts, even if the numbers look impressive. Don't repeat the hook in a row.
- Every row must ADD something a reader can't already see in the headline and hook: a number, a score, a stat, a record, a name not yet mentioned, a quote, a date, or what happens next. A row that just restates who or what the headline already names ("Player: Jalen Hurts", "Team: Philadelphia Eagles" under a headline about them) is wrong. Prefer concrete facts like "296 runs chased with 8 overs to spare" over labels. If fewer than 3 rows add something new, return fewer rows.

If the article doesn't contain enough concrete facts for at least 3 real rows, return fewer rows rather than inventing any.`;
  return styles?.length ? base + hookCandidatesBlock(styles) : base;
}

// Asks for one candidate hook per style, so the best can be chosen (social/hookChoice.ts) after each is checked
// against the article (social/hookCheck.ts).
function hookCandidatesBlock(styles: HookStyle[]): string {
  return `

HOOK CANDIDATES: also return hookCandidates, one {style, hook} object for each style below. Each hook is under 10 words, strictly true to the article, and uses only numbers, names and words the article contains. If the article cannot honestly support a style, leave that style out instead of stretching it. NAME RULE: every hook, in every style, must name the person or team the story is about (Shorts whose titles named nobody, such as two bare number fragments, got a fraction of the views of those that did), so put the name inside the hook: \"Hurts: 168 yards. One win.\" not \"168 yards. One win.\". The styles:
${styles.map((s) => `- ${s}: ${STYLE_GUIDE[s]}`).join("\n")}`;
}

const ROW_STOPWORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "vs", "his", "her", "their", "was", "were", "has", "have", "after", "into"]);
const GENERIC_ROW_LABELS = new Set(["player", "team", "name", "person", "club", "athlete", "coach", "manager"]);

function significantWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !ROW_STOPWORDS.has(w));
}

// Drops rows that only restate the headline or hook: a value whose words are
// (almost) all already in them, or a generic "Player"/"Team" label whose value
// is half-covered. A reel of "Player: Jalen Hurts / Team: Philadelphia Eagles"
// under a headline about the Eagles' Jalen Hurts adds nothing to read.
export function dropRepeatedRows(rows: { label: string; value: string }[], title: string, hook: string): { label: string; value: string }[] {
  const known = new Set([...significantWords(title), ...significantWords(hook)]);
  return rows.filter((r) => {
    const words = significantWords(r.value);
    if (words.length === 0) return false;
    const covered = words.filter((w) => known.has(w)).length / words.length;
    const generic = GENERIC_ROW_LABELS.has(r.label.trim().toLowerCase());
    return !(covered >= 0.75 || (generic && covered >= 0.5));
  });
}

export interface PosterContent {
  eyebrow: string;
  hook: string;
  rows: { label: string; value: string }[];
  // Set when several candidate hooks were written and one chosen: the choice and every candidate with its check and score.
  hookMeta?: { style: string; by: string; candidates: { style: string; hook: string; score: number; ok: boolean; problems: string[] }[] };
}

// Bespoke per-article poster copy (bold hook headline + a quick-read fact
// table) for the Instagram poster format — see instagramPoster.tsx for the
// actual image rendering. Grounded strictly in the article's own text, same
// no-invented-facts policy as generateCommentary/generateMatchRecap above.
// language: "es" writes the poster/reel text in Spanish (the Spanish Page's reels).
export async function generatePosterContent(title: string, body: string, language?: string, opts?: { styles?: HookStyle[]; articleId?: string }): Promise<PosterContent | null> {
  if (!body || body.trim().length < 40) return null;

  const languageRule = language === "es"
    ? "\n\nLANGUAGE: Write the eyebrow, hook and every row label and value in neutral Spanish for US Hispanic, Latin American and Spanish readers (no regional slang). Keep names of people, teams and competitions as they are normally written."
    : "";
  const parsed = await callGemini(buildPosterPrompt(title, body, opts?.styles) + languageRule, {
    priority: "low",
    model: COPY_MODEL,
    temperature: 0.5,
    maxOutputTokens: 2048,
    responseSchema: {
      type: "OBJECT",
      properties: {
        eyebrow: { type: "STRING" },
        hook: { type: "STRING" },
        hookCandidates: { type: "ARRAY", items: { type: "OBJECT", properties: { style: { type: "STRING" }, hook: { type: "STRING" } }, required: ["style", "hook"] } },
        rows: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { label: { type: "STRING" }, value: { type: "STRING" } },
            required: ["label", "value"],
          },
        },
      },
      required: ["eyebrow", "hook", "rows"],
    },
  });
  if (!parsed) return null;

  const eyebrow = typeof parsed.eyebrow === "string" ? parsed.eyebrow.trim() : "";
  let hook = typeof parsed.hook === "string" ? parsed.hook.trim() : "";
  // Several candidate hooks: check each against the article, score the valid ones and use the best (hookChoice.ts).
  let hookMeta: PosterContent["hookMeta"];
  if (opts?.styles?.length && opts.articleId && hook) {
    const known = new Set<string>(opts.styles);
    const raw: HookCandidate[] = [
      ...(Array.isArray(parsed.hookCandidates) ? parsed.hookCandidates : [])
        .filter((c: any) => typeof c?.hook === "string" && known.has(c?.style))
        .map((c: any) => ({ style: c.style as HookStyle, hook: c.hook })),
      { style: "model" as const, hook },
    ];
    const choice: HookChoice = chooseHook(raw, title, body, opts.articleId);
    hook = choice.hook;
    hookMeta = { style: choice.style, by: choice.by, candidates: choice.candidates.map((c) => ({ style: c.style, hook: c.hook, score: c.score, ok: c.ok, problems: c.problems })) };
  }
  const rows = Array.isArray(parsed.rows)
    ? parsed.rows
        .filter((r: any) => typeof r?.label === "string" && typeof r?.value === "string" && r.label.trim() && r.value.trim())
        .map((r: any) => ({ label: r.label.trim(), value: r.value.trim() }))
        .slice(0, 5)
    : [];

  const fresh = dropRepeatedRows(rows, title, hook);
  if (!hook || fresh.length < 3) return null;
  return { eyebrow: eyebrow || "SPORTS NEWS", hook, rows: fresh, ...(hookMeta ? { hookMeta } : {}) };
}

// Expands a match-data template (score/fixture + standings context, already
// built from football-data.org/CricketData.org's structured data — see
// footballData.ts/cricketData.ts) into a proper recap, instead of leaving
// match articles as a bare one- or two-sentence template forever.
export async function generateMatchRecap(
  title: string,
  factsText: string,
  competitionName: string
): Promise<string | null> {
  if (!factsText || factsText.trim().length < 20) return null;

  const parsed = await callGemini(buildMatchPrompt(title, factsText, competitionName), {
    responseSchema: {
      type: "OBJECT",
      properties: { recap: { type: "STRING" } },
      required: ["recap"],
    },
  });
  if (!parsed) return null;

  const recap = typeof parsed.recap === "string" ? parsed.recap.trim() : "";
  return recap || null;
}
