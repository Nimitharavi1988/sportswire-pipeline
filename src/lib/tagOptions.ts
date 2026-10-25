import { TRACKED_PLAYERS } from "./players";
import { TRACKED_CLUBS } from "./clubs";
import { TRACKED_COUNTRIES } from "./countries";
import { VENUES } from "./venues";

// What a story can be tagged with (ArticleTag) — pure config, safe to use in
// the browser (the admin story editor). The database side is lib/tags.ts.
export const TAG_KINDS = ["player", "club", "country", "venue"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export interface TagOption {
  kind: TagKind;
  slug: string;
  label: string;
}

const KIND_LABEL: Record<TagKind, string> = { player: "Player", club: "Team", country: "Country", venue: "Venue" };

export function tagGroupLabel(kind: TagKind): string {
  return KIND_LABEL[kind];
}

// Everything that can be tagged, for the editor's picker.
export function tagOptions(): TagOption[] {
  return [
    ...TRACKED_COUNTRIES.map((c) => ({ kind: "country" as const, slug: c.slug, label: c.name })),
    ...TRACKED_CLUBS.map((c) => ({ kind: "club" as const, slug: c.slug, label: c.name })),
    ...TRACKED_PLAYERS.map((p) => ({ kind: "player" as const, slug: p.slug, label: p.name })),
    ...VENUES.map((v) => ({ kind: "venue" as const, slug: v.slug, label: `${v.name}, ${v.city}` })),
  ];
}

export function isKnownTag(t: { kind: string; slug: string }): t is { kind: TagKind; slug: string } {
  return tagOptions().some((o) => o.kind === t.kind && o.slug === t.slug);
}
