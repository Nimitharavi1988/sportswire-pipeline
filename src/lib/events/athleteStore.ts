import { athleteSlug, type GamesMedal } from "./athletes";

// What the athlete sync stores (DataSnapshot rows, athleteSync.ts) and the
// pages read (athleteRead.ts). Types and keys only — no database import, so
// tests and client code can use them.

// One country's medallists at one Games.
export interface MedalistsSnapshot {
  country: string;
  medals: GamesMedal[];
  // Where it was read from, for the credit under the list.
  sourceUrl: string;
}

// An athlete's bio and photo, from their Wikipedia article's summary.
export interface AthleteProfile {
  slug: string;
  name: string;
  title: string;
  // Wikipedia's one-line description ("Indian sport shooter").
  description: string | null;
  // The opening paragraph.
  extract: string | null;
  thumbnail: string | null;
  pageUrl: string;
}

// Each athlete with a Wikipedia article once, in the order they first appear —
// the ones who get a page (athlete/[slug]).
export function athleteSlugsOf(list: Pick<MedalistsSnapshot, "medals">): string[] {
  const seen = new Set<string>();
  for (const m of list.medals) for (const a of m.athletes) if (a.title) seen.add(athleteSlug(a.title));
  return [...seen];
}

export const medalistsKey = (eventKey: string, country: string) => `athletes:${eventKey}:${country.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
export const profileKey = (slug: string) => `athlete:${slug}`;
