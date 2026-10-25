import { sql, type SQL } from "drizzle-orm";
import { article as articleTable } from "@/db/schema";

// Word-boundary-safe replacement for `or(...searchTerms.map(term =>
// ilike(article.title, "%term%")))` -- confirmed live (2026-09-20): a plain
// substring ILIKE for the country "India" matched "Indianapolis Colts",
// "Indiana Hoosiers", "Southern Indiana Screaming Eagles", none of which
// have anything to do with India -- the exact "Scunthorpe problem" this
// project's own search-term curation elsewhere (players.ts/clubs.ts
// comments) has always tried to avoid, just missed here because this is a
// raw SQL substring match, not the word-boundary-aware regex
// entityLinks.tsx's inline linker already uses. Same underlying pattern was
// duplicated in club/[slug]/page.tsx, its opengraph-image, and
// player/[slug]/page.tsx -- fixed in all four at once rather than only the
// one specifically reported.
//
// Uses Postgres's own regex match operator (~*, case-insensitive POSIX
// ERE) with \y word-boundary metacharacters (Postgres's own boundary
// syntax -- \b means backspace in POSIX ERE, not a word boundary) instead
// of ILIKE, combining every term into one alternation so this is still a
// single WHERE condition, not N OR'd ones.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titleMatchesAnyTerm(terms: string[]): SQL {
  const pattern = terms.map(escapeRegex).join("|");
  return sql`${articleTable.title} ~* ${"\\y(" + pattern + ")\\y"}`;
}
