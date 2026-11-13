// A finished match as a stats reel (2026-11-13, pilot): the same stat for both sides as two-sided bars, picked from the box score stored for the match
// (scores/matchDetail.ts, from ESPN). Football, the NFL and college football, basketball and hockey, each with its own short list of stats. Every
// number is copied from the stored box, nothing is derived or estimated; a match without enough readable stats, or without a final score, is skipped.
// The text is a template (no AI). Pure, unit-tested.
import type { BoxScore } from "../scores/espnBoxScore";

export type StatsSport = "football" | "american-football" | "college-football" | "basketball" | "wnba" | "hockey";

interface Pick {
  /** Matches the box score label, case-insensitive. */
  label: RegExp;
  /** What the bar says. */
  name: string;
  /** Lower is better (turnovers, fouls): the smaller side is the stronger one. */
  lowerIsBetter?: boolean;
  suffix?: string;
}

// In order of how much each says about the match; the first MAX_STATS that are present and readable are used.
const PICKS: Record<StatsSport, Pick[]> = {
  football: [
    { label: /^possession$/i, name: "Possession", suffix: "%" },
    { label: /^shots$/i, name: "Shots" },
    { label: /^(on goal|shots on (goal|target))$/i, name: "Shots on target" },
    { label: /^corner kicks$/i, name: "Corners" },
    { label: /^fouls$/i, name: "Fouls", lowerIsBetter: true },
    { label: /^saves$/i, name: "Saves" },
  ],
  "american-football": [
    { label: /^total yards$/i, name: "Total yards" },
    { label: /^passing$/i, name: "Passing yards" },
    { label: /^rushing$/i, name: "Rushing yards" },
    { label: /^1st downs$/i, name: "First downs" },
    { label: /^turnovers$/i, name: "Turnovers", lowerIsBetter: true },
  ],
  "college-football": [
    { label: /^total yards$/i, name: "Total yards" },
    { label: /^passing$/i, name: "Passing yards" },
    { label: /^rushing$/i, name: "Rushing yards" },
    { label: /^1st downs$/i, name: "First downs" },
    { label: /^turnovers$/i, name: "Turnovers", lowerIsBetter: true },
  ],
  basketball: [
    { label: /^field goal %$/i, name: "Field goal", suffix: "%" },
    { label: /^three point %$/i, name: "Three-pointers", suffix: "%" },
    { label: /^rebounds$/i, name: "Rebounds" },
    { label: /^assists$/i, name: "Assists" },
    { label: /^turnovers$/i, name: "Turnovers", lowerIsBetter: true },
    { label: /^steals$/i, name: "Steals" },
  ],
  wnba: [
    { label: /^field goal %$/i, name: "Field goal", suffix: "%" },
    { label: /^three point %$/i, name: "Three-pointers", suffix: "%" },
    { label: /^rebounds$/i, name: "Rebounds" },
    { label: /^assists$/i, name: "Assists" },
    { label: /^turnovers$/i, name: "Turnovers", lowerIsBetter: true },
    { label: /^steals$/i, name: "Steals" },
  ],
  hockey: [
    { label: /^shots$/i, name: "Shots" },
    { label: /^hits$/i, name: "Hits" },
    { label: /^blocked shots$/i, name: "Blocked shots" },
    { label: /^faceoff win percent$/i, name: "Faceoffs won", suffix: "%" },
    { label: /^takeaways$/i, name: "Takeaways" },
  ],
};

export const MAX_STATS = 5;
export const MIN_STATS = 4;

export interface StatBar { name: string; home: number; away: number; homeText: string; awayText: string; lowerIsBetter: boolean }

// A plain number from a box score cell: "61.5", "372", "41". Ratios ("9-17", "18/30") are not plain numbers.
export function plainNumber(v: string): number | null {
  const t = v.trim().replace(/%$/, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const shown = (n: number, suffix = ""): string => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}${suffix}`;

export function pickStats(box: BoxScore, sport: StatsSport): StatBar[] {
  const out: StatBar[] = [];
  for (const pick of PICKS[sport]) {
    const row = box.teamStats.find((t) => pick.label.test(t.label.trim()));
    if (!row) continue;
    const h = plainNumber(row.home);
    const a = plainNumber(row.away);
    if (h === null || a === null || h + a === 0) continue;
    out.push({ name: pick.name, home: h, away: a, homeText: shown(h, pick.suffix), awayText: shown(a, pick.suffix), lowerIsBetter: Boolean(pick.lowerIsBetter) });
    if (out.length === MAX_STATS) break;
  }
  return out;
}

export const statsSportOf = (category: string): StatsSport | null => {
  const s = category.split("/")[0].toLowerCase();
  return s in PICKS ? (s as StatsSport) : null;
};

export interface MatchStatsInput {
  category: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  leagueLabel: string | null;
  matchStatus: string | null;
  kickoffAt: Date | null;
  articleId: string;
  box: BoxScore | null;
  boxFinal: boolean;
}

export interface StatsReel {
  key: string;
  articleId: string;
  sport: StatsSport;
  title: string;
  subtitle: string;
  home: string;
  away: string;
  score: [number, number];
  bars: StatBar[];
  hook: string;
  caption: string;
  source: string;
}

export type StatsVerdict = { ok: true; reel: StatsReel } | { ok: false; reason: string };

const SPORT_NAME: Record<StatsSport, string> = { football: "Football", "american-football": "NFL", "college-football": "College football", basketball: "Basketball", wnba: "WNBA", hockey: "Hockey" };
const resultWord = (h: number, a: number) => (h > a ? "beat" : h < a ? "lost to" : "drew with");

export function buildMatchStats(m: MatchStatsInput, now: Date = new Date(), maxAgeHours = 24): StatsVerdict {
  const sport = statsSportOf(m.category);
  if (!sport) return { ok: false, reason: "sport not covered" };
  if (m.matchStatus !== "finished") return { ok: false, reason: "match not finished" };
  if (!m.kickoffAt || now.getTime() - m.kickoffAt.getTime() > maxAgeHours * 3_600_000 || m.kickoffAt.getTime() > now.getTime()) return { ok: false, reason: "match not recent" };
  if (m.homeScore === null || m.awayScore === null) return { ok: false, reason: "no final score" };
  if (!m.box || !m.boxFinal) return { ok: false, reason: "no final box score" };
  const bars = pickStats(m.box, sport);
  if (bars.length < MIN_STATS) return { ok: false, reason: `only ${bars.length} readable stats` };
  const score = `${m.homeScore}–${m.awayScore}`;
  const hook = `${m.home} ${score} ${m.away}: the match in numbers`;
  const lead = bars.slice(0, 3).map((b) => `${b.name.toLowerCase()} ${b.homeText}–${b.awayText}`).join(", ");
  const caption = `📊 ${m.home} ${m.homeScore}, ${m.away} ${m.awayScore}. ${m.home} ${resultWord(m.homeScore, m.awayScore)} ${m.away}, and here is the match in numbers: ${lead}. Which stat tells the story? Tell us in the comments.`;
  return {
    ok: true,
    reel: {
      key: `stats-${m.articleId}`,
      articleId: m.articleId,
      sport,
      title: hook,
      subtitle: m.leagueLabel ?? SPORT_NAME[sport],
      home: m.home,
      away: m.away,
      score: [m.homeScore, m.awayScore],
      bars,
      hook,
      caption,
      source: m.box.source || "ESPN",
    },
  };
}

// Football only for the competitions people follow; the US sports have few enough games to take any.
export const BIG_FOOTBALL = /(premier league|la ?liga|bundesliga|serie a|ligue 1|champions league|europa league|world cup|\bmls\b|fa cup|copa|nations league|euro)/i;
// Reels a day per sport (UTC day).
export const STATS_DAILY_CAP: Partial<Record<StatsSport, number>> = { football: 4, "american-football": 3, basketball: 3, hockey: 2 };
export function wantedSports(env: Record<string, string | undefined> = process.env): Set<string> {
  const raw = env.DATA_REEL_SPORTS?.trim();
  return new Set((raw ? raw.split(",") : ["cricket", "football", "american-football", "basketball", "hockey"]).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

