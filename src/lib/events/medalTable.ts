/**
 * Medal table for a multi-sport event (pure, unit-tested): parsed from the
 * event's Wikipedia medal-table page and checked before it's ever shown.
 * Wikipedia is community-edited and updated within minutes of each final,
 * which makes it the most current free source — but a bad edit must never
 * reach the site, so a snapshot is only accepted when it's internally
 * consistent and no nation's medals went down since the last accepted one
 * (how vandalism usually shows). A rejected snapshot leaves the last good
 * one in place.
 */

export interface MedalRow {
  rank: number;
  nation: string;
  host: boolean;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface MedalTable {
  rows: MedalRow[];
  totals: { gold: number; silver: number; bronze: number; total: number } | null;
}

function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// The first table with Gold/Silver/Bronze headers. Tied rows share one
// Rank cell (rowspan), so a row without its own rank takes the one above.
export function parseMedalTable(html: string): MedalTable {
  const table = html.split("<table").find((t) => /Gold/.test(t) && /Silver/.test(t) && /Bronze/.test(t));
  if (!table) return { rows: [], totals: null };
  const rows: MedalRow[] = [];
  let totals: MedalTable["totals"] = null;
  let lastRank = 0;
  for (const tr of table.split("<tr").slice(1)) {
    const cells = [...tr.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => cellText(m[2]));
    if (cells.length < 5) continue;
    const nums = cells.slice(-4).map((c) => Number(c));
    if (nums.some((n) => !Number.isInteger(n))) continue; // header row
    const [gold, silver, bronze, total] = nums;
    const label = cells[cells.length - 5];
    if (/^totals?\b/i.test(label)) {
      totals = { gold, silver, bronze, total };
      continue;
    }
    const ownRank = cells.length >= 6 ? Number(cells[cells.length - 6]) : NaN;
    const rank = Number.isInteger(ownRank) && ownRank > 0 ? ownRank : lastRank;
    lastRank = rank;
    const host = /\*\s*$/.test(label);
    rows.push({ rank, nation: label.replace(/\*\s*$/, "").trim(), host, gold, silver, bronze, total });
  }
  return { rows, totals };
}

// A medal can legitimately move between columns (a gold re-awarded as a
// silver, a disqualification), which lowers one column while the nation's
// total holds or rises — seen 2026-09-30 when Kazakhstan went 10 -> 9 gold and
// 41 -> 56 medals, and the old "no column may drop" rule then rejected every
// update for three days. Vandalism looks different: the total falls, or a
// column collapses. So a column may drop by at most this much.
const RECLASSIFY_MAX = 2;

// Why a snapshot can't be trusted, or null when it can.
export function medalTableProblem(table: MedalTable, previous: MedalTable | null): string | null {
  const { rows, totals } = table;
  if (rows.length < 3) return `only ${rows.length} rows`;
  for (const r of rows) {
    if (r.gold + r.silver + r.bronze !== r.total) return `${r.nation}: medals don't add up`;
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const order = a.gold - b.gold || a.silver - b.silver || a.bronze - b.bronze;
    if (order < 0) return `${b.nation} is ranked below ${a.nation} with more medals`;
  }
  if (totals) {
    const sum = (k: "gold" | "silver" | "bronze" | "total") => rows.reduce((n, r) => n + r[k], 0);
    if (sum("gold") !== totals.gold || sum("silver") !== totals.silver || sum("bronze") !== totals.bronze || sum("total") !== totals.total) {
      return "rows don't add up to the totals row";
    }
  }
  if (previous) {
    const before = new Map(previous.rows.map((r) => [r.nation, r]));
    for (const r of rows) {
      const p = before.get(r.nation);
      if (!p) continue;
      if (r.total < p.total) return `${r.nation}'s medals went down`;
      for (const col of ["gold", "silver", "bronze"] as const) {
        if (p[col] - r[col] > RECLASSIFY_MAX) return `${r.nation}'s ${col} medals dropped by more than ${RECLASSIFY_MAX}`;
      }
    }
    const nowNations = new Set(rows.map((r) => r.nation));
    const lost = previous.rows.find((r) => r.total > 0 && !nowNations.has(r.nation));
    if (lost) return `${lost.nation} disappeared from the table`;
  }
  return null;
}

// Recovery from a bad snapshot. The checks above compare a new table with the
// last stored one and keep the stored one on any regression — which is also
// what happens when the STORED table is the bad one: on 2026-10-01 a table
// with Vietnam on 255 golds (China 151) passed the checks (its numbers only
// went up) and was stored, after which every correct table (China first,
// Vietnam far lower) was rejected as "Vietnam's medals went down", for over a
// day. A rejected table is now remembered as a candidate; one that keeps
// passing the checks against ITS OWN previous fetch (so a settled, correct
// table rather than a one-off edit) for CANDIDATE_ACCEPT_AFTER_MS replaces
// the stored one.
export const CANDIDATE_ACCEPT_AFTER_MS = 3 * 60 * 60 * 1000;

export interface MedalCandidate {
  table: MedalTable;
  /** ISO time this run of consistent fetches began. */
  since: string;
}

export function reviewRejectedTable(
  table: MedalTable,
  candidate: MedalCandidate | null,
  now: Date
): { accept: boolean; candidate: MedalCandidate | null } {
  // A table that is wrong on its own terms is never a candidate.
  if (medalTableProblem(table, null)) return { accept: false, candidate: null };
  const continues = candidate !== null && medalTableProblem(table, candidate.table) === null;
  const since = continues ? candidate!.since : now.toISOString();
  return {
    accept: continues && now.getTime() - new Date(since).getTime() >= CANDIDATE_ACCEPT_AFTER_MS,
    candidate: { table, since },
  };
}
