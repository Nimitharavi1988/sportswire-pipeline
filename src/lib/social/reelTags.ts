// Instagram accounts to co-author / tag on a reel when a story is about them.
// Keys are the name as it appears in headlines (matched on word boundaries,
// case-insensitive); values are the verified Instagram username without "@".
// Empty on purpose: only add a handle after checking it is the real, official
// account, and only for accounts that are actually the subject of our stories.
// A wrong or private username makes Instagram reject the container, so
// postReel retries once without tags (see postReelToInstagram).
import { entitiesInTitle } from "./entityHandles";

export const REEL_COLLABORATORS: Record<string, string> = {};
// Leagues and governing bodies, checked 2026-09-28 by web search (top
// result for the handle, matching name, 3M to 121M followers, own content).
// Not API-verified: Business Discovery isn't enabled for our Meta app.
export const REEL_USER_TAGS: Record<string, string> = {
  "Premier League": "premierleague",
  "Champions League": "championsleague",
  NFL: "nfl",
  NBA: "nba",
  MLB: "mlb",
  NHL: "nhl",
  WNBA: "wnba",
  "Formula 1": "f1",
  F1: "f1",
  IPL: "iplt20",
  ICC: "icc",
};

function matching(map: Record<string, string>, title: string): string[] {
  const found = new Set<string>();
  for (const [name, handle] of Object.entries(map)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(title)) found.add(handle);
  }
  return [...found];
}

// Instagram allows at most 3 collaborators per post. Tags are the players and
// clubs the story leads with (entityHandles.ts, only those with a verified
// handle), then any league in the headline, capped at 3 in total.
export function reelTagsFor(title: string, category: string): { collaborators: string[]; userTags: { username: string }[] } {
  const collaborators = matching(REEL_COLLABORATORS, title).slice(0, 3);
  const entityHandles = entitiesInTitle(title, category, { precise: true }).flatMap((e) => (e.handle ? [e.handle] : []));
  const userTags = [...new Set([...entityHandles, ...matching(REEL_USER_TAGS, title)])]
    .filter((h) => !collaborators.includes(h))
    .slice(0, 3)
    .map((username) => ({ username }));
  return { collaborators, userTags };
}
