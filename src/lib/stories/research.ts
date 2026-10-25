/**
 * Live research and fact-check for the automatic drafts (autoDraft.ts).
 *
 * The site's own data (draftFacts.ts) is fixtures and our ingested stories,
 * and the ingested stories carry the original publishers' mistakes: an
 * auto-draft about Prasidh Krishna's "injury setback" (2026-10-02) rested on
 * a claim no outside report backed. So before writing, Gemini searches the
 * web (Google Search grounding) for the story's facts; after writing, a
 * second call checks every sentence against those facts and drops what they
 * don't support.
 *
 * Grounding can't be combined with a JSON response schema in one call, so the
 * research call answers in plain "FACT:" lines (parsed here), and the check
 * is an ordinary structured call (callGemini).
 */
import { callGemini } from "../ingestion/commentary";
import { getRouter } from "../llm";
import type { LlmRouter } from "../llm/router";
import { blocksToBody } from "../aiDraft";

// Standard Flash, not the lite tier: research and checking are where the
// accuracy of the whole draft is decided, and it's at most a few calls a day.
export const RESEARCH_MODEL = "gemini-flash-latest";

export interface Research {
  facts: string[];
  // Where the facts came from (site names or page titles from the search).
  sources: string[];
}

export function buildResearchPrompt(headline: string, brief: string, today: Date): string {
  const date = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `Today is ${date}. You are the research desk for a sports news site. A writer is preparing this story:

Headline idea: ${headline}
Brief: ${brief}

Use Google Search to find the facts this story needs from reputable sports sources (official league, team and governing-body sites, major sports outlets, wire services): results and scores, key performances with numbers, dates, venues, records, injuries and selection news, and direct quotes with who said them.

Rules:
- Only facts you found in search results for this specific event or story. Nothing from memory, nothing inferred.
- Leave out anything uncertain, or where sources disagree.
- Prefer the most recent reports; say when something happened.
- Up to 20 facts, the most important first, one per line, each line starting with "FACT: ".
- No commentary, no opinions, no introduction.`;
}

// "FACT: …" lines from the research answer (pure, unit-tested).
export function parseFacts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s*/, ""))
    .filter((l) => /^FACT:/i.test(l))
    .map((l) => l.replace(/^FACT:\s*/i, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 15)
    .slice(0, 20);
}

interface GroundingChunk { web?: { uri?: string; title?: string } }

// The sources behind the answer, de-duplicated (pure, unit-tested). Grounding
// returns redirect links that expire, so the title (usually the site's
// domain) is what's kept.
export function groundingSources(chunks: GroundingChunk[] | undefined): string[] {
  const seen = new Set<string>();
  for (const c of chunks ?? []) {
    const title = c.web?.title?.trim();
    if (title) seen.add(title);
  }
  return [...seen].slice(0, 10);
}

// With the AI router on, the search goes through its budget like every other
// call (it uses the same Gemini Flash allowance as the standard-tier work);
// otherwise it's the direct call below, as before.
async function researchViaRouter(router: LlmRouter, prompt: string): Promise<Research | null> {
  const answer = await router.grounded({ prompt, priority: "high", temperature: 0.1, maxOutputTokens: 3072 });
  if (!answer) return null;
  const sources = groundingSources(answer.chunks as GroundingChunk[] | undefined);
  return sources.length === 0 ? { facts: [], sources } : { facts: parseFacts(answer.text), sources };
}

export async function researchStory(headline: string, brief: string, today: Date = new Date()): Promise<Research | null> {
  const router = await getRouter();
  if (router) return researchViaRouter(router, buildResearchPrompt(headline, brief, today));
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${RESEARCH_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildResearchPrompt(headline, brief, today) }] }],
        tools: [{ google_search: {} }],
        // Hidden reasoning off: it used up the output cap and cut the answer
        // off after two facts (seen in testing 2026-10-04).
        generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.1, maxOutputTokens: 3072 },
      }),
    });
    if (!res.ok) {
      console.error(`Research failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
    const sources = groundingSources(candidate?.groundingMetadata?.groundingChunks);
    // Facts with no search behind them are the model's memory: not used.
    if (sources.length === 0) return { facts: [], sources };
    return { facts: parseFacts(text), sources };
  } catch (err) {
    console.error("Research error:", err);
    return null;
  }
}

type Block = { kind: "paragraph" | "subheading"; text: string };

const CHECK_SCHEMA = {
  type: "OBJECT",
  properties: {
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { kind: { type: "STRING", enum: ["paragraph", "subheading"] }, text: { type: "STRING" } },
        required: ["kind", "text"],
      },
    },
    removed: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["blocks", "removed"],
};

export function buildCheckPrompt(facts: string[], body: string): string {
  return `You are the fact-checker for a sports news site. Check this draft against the verified facts below.

Verified facts (the only facts the draft may state):
${facts.map((f) => `- ${f}`).join("\n")}

Draft (paragraphs separated by blank lines; lines starting "## " are subheadings):
"""
${body}
"""

Rules:
- Every name, number, score, date, record, quote and event in the draft must be supported by the verified facts. A sentence with a claim that isn't: rewrite it so it only says what the facts support, or remove it.
- Fix any number or name that differs from the facts.
- Keep opinion and analysis that follows from the facts; keep the writer's structure, voice and subheadings. Change nothing else.
- Keep notes in square brackets ([ADD: …]) as they are.
- "blocks": the corrected draft, one paragraph or subheading per item (subheadings without "##").
- "removed": each claim you removed or changed, briefly. Empty if none.`;
}

// Returns the checked body and what was taken out, or null if the check
// couldn't run (the draft is then not saved: unchecked text never reaches
// the queue).
export async function factCheckDraft(facts: string[], body: string): Promise<{ body: string; removed: string[] } | null> {
  const out = (await callGemini(buildCheckPrompt(facts, body), {
    responseSchema: CHECK_SCHEMA,
    priority: "high",
    model: RESEARCH_MODEL,
    temperature: 0.1,
    maxOutputTokens: 4096,
  })) as { blocks?: Block[]; removed?: string[] } | null;
  if (!out?.blocks) return null;
  const checked = blocksToBody(out.blocks);
  if (!checked) return null;
  return { body: checked, removed: (out.removed ?? []).map((r) => r.trim()).filter(Boolean) };
}
