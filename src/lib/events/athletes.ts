/**
 * Athletes at a multi-sport Games (pure, unit-tested): who won what, read from
 * the country's own Wikipedia page ("India at the 2026 Asian Games"), whose
 * Medalists table lists every medal with its athletes, sport, event and date —
 * and links each athlete to their own Wikipedia article, which is what the
 * athlete pages draw their bio and photo from (athleteSync.ts).
 *
 * Wikipedia is community-edited, so the sync only accepts a table that reads as
 * a whole (see medalistsProblem) and keeps the last good one otherwise.
 */

export type MedalKind = "gold" | "silver" | "bronze";

export interface MedalAthlete {
  // As written on the page ("Suruchi Singh").
  name: string;
  // Their Wikipedia article ("Suruchi_Singh"), or null for no article (a red
  // link or plain text) — no page on this site without one.
  title: string | null;
}

export interface GamesMedal {
  medal: MedalKind;
  // A team entry ("India men's national kabaddi team") lists its squad as athletes.
  team: string | null;
  athletes: MedalAthlete[];
  sport: string;
  event: string;
  date: string;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#160;": " ", "&nbsp;": " ", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">" };
const decode = (s: string) => s.replace(/&(?:amp|#160|nbsp|#39|quot|lt|gt);/g, (m) => ENTITIES[m] ?? m);
const textOf = (html: string) =>
  decode(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

// An article title from a link: /wiki/Neeraj_Chopra -> "Neeraj_Chopra". Red
// links (no article yet) and non-article namespaces give null.
function wikiTitle(anchor: string): string | null {
  if (/class="[^"]*\bnew\b/.test(anchor) || /redlink=1/.test(anchor)) return null;
  const href = anchor.match(/href="\/wiki\/([^"#?]+)/)?.[1];
  if (!href || /^(File|Category|Help|Special|Template|Wikipedia|Talk):/i.test(decodeURIComponent(href))) return null;
  return decodeURIComponent(href);
}

function athleteFrom(fragment: string): MedalAthlete | null {
  const name = textOf(fragment);
  if (!name) return null;
  const anchor = fragment.match(/<a [^>]*>/)?.[0];
  return { name, title: anchor ? wikiTitle(anchor) : null };
}

// The Athlete cell: a team link followed by a list of its squad; a list of
// athletes (a relay, a pair); or a single link or plain name.
function parseAthleteCell(cell: string): { team: string | null; athletes: MedalAthlete[] } {
  const items = [...cell.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const team = cell.match(/^\s*<a [^>]*>([^<]+)<\/a>\s*(?:<style|<link|<div|<ul)/)?.[1];
  if (items.length > 0) {
    return { team: team ? textOf(team) : null, athletes: items.flatMap((i) => athleteFrom(i) ?? []) };
  }
  const anchors = [...cell.matchAll(/<a [^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  if (anchors.length > 0) return { team: null, athletes: anchors.flatMap((a) => athleteFrom(a) ?? []) };
  const plain = athleteFrom(cell);
  return { team: null, athletes: plain ? [plain] : [] };
}

export function parseMedalists(html: string): GamesMedal[] {
  // The table with Medal / Athlete / Sport / Event / Date headers.
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]).find((t) => /<th[^>]*>\s*Medal/i.test(t) && /<th[^>]*>\s*Athlete/i.test(t));
  if (!table) return [];
  const medals: GamesMedal[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 5) continue;
    const kind = textOf(cells[0]).toLowerCase().match(/gold|silver|bronze/)?.[0] as MedalKind | undefined;
    if (!kind) continue;
    const { team, athletes } = parseAthleteCell(cells[1]);
    const sport = textOf(cells[2]);
    const event = textOf(cells[3]);
    if (athletes.length === 0 || !sport || !event) continue;
    medals.push({ medal: kind, team, athletes, sport, event, date: textOf(cells[4]) });
  }
  return medals;
}

// Why a snapshot can't be trusted, or null when it can: it must read as a
// plausible table, and must not lose most of what the last good one had (how a
// bad edit or a changed page layout usually shows).
export function medalistsProblem(medals: GamesMedal[], previous: GamesMedal[] | null): string | null {
  if (medals.length < 5) return `only ${medals.length} medals read`;
  if (medals.some((m) => m.athletes.length === 0)) return "a medal with no athletes";
  if (previous && previous.length >= 10 && medals.length < previous.length * 0.8) return `${medals.length} medals, down from ${previous.length}`;
  return null;
}

// "Kamaljeet (sport shooter)" -> "kamaljeet-sport-shooter". Keeps the
// disambiguator so two athletes with one name stay apart.
export function athleteSlug(title: string): string {
  return decodeURIComponent(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Display name without a disambiguator: "Kamaljeet (sport shooter)" -> "Kamaljeet".
export function plainName(titleOrName: string): string {
  return decodeURIComponent(titleOrName).replace(/_/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export const MEDAL_LABEL: Record<MedalKind, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
