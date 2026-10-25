import { EVENT_KEYWORDS } from "./eventKeywords";
import { SUPERSTAR_SEARCH_TERMS } from "./players";

// A headline is "notable" either by EVENT TYPE (transfer, record, death —
// see eventKeywords.ts) or by WHO it's about (a tracked star player, even
// when the headline itself has no special trigger word — a match report or
// interview about a superstar often doesn't). Shared between the homepage's
// "Transfers & Big News" section selection (page.tsx) and the auto-approve
// Facebook posting bar (autoApprove.ts) — the same standard for "worth
// surfacing prominently" should apply whether that's on-site or on social,
// not two independently-drifting definitions.
export function isHighlightWorthy(title: string): boolean {
  const lower = title.toLowerCase();
  if (EVENT_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return SUPERSTAR_SEARCH_TERMS.some((term) => lower.includes(term.toLowerCase()));
}
