// A cricket series as a chart (2026-11-13, pilot): the ESPN Cricket match rows of one series and format, grouped and checked, turned into the
// numbers for chartReel.tsx and a template hook and caption. No AI and no estimate: every figure is a score or a result line already stored on a
// match row, and a series that does not check out is skipped with a reason instead of drawn. Pure, unit-tested.
import { runsOf, type ChartMatch, type ChartReelParams } from "./chartReel";

export interface SeriesRow {
  id: string;
  sourceUrl: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScoreText: string | null;
  awayScoreText: string | null;
  matchStatus: string | null;
  matchNote: string | null;
  kickoffAt: Date | null;
  leagueLabel: string | null;
}

export type Format = "odi" | "t20i";
const FORMAT_NAME: Record<Format, string> = { odi: "ODI", t20i: "T20I" };

// https://www.espn.in/cricket/series/24469/game/1539437/new-zealand-vs-india-1st-odi-24469: the series id, the game number and the format.
export function parseEspnGame(sourceUrl: string): { seriesId: string; gameNo: number; format: Format | "test" } | null {
  const m = /\/cricket\/series\/(\d+)\/game\/\d+\/[a-z0-9-]*?-(\d+)(?:st|nd|rd|th)-(odi|t20i|test)-\d+\/?$/i.exec(sourceUrl.split("?")[0]);
  if (!m) return null;
  return { seriesId: m[1], gameNo: Number(m[2]), format: m[3].toLowerCase() as Format | "test" };
}

export type Outcome = { kind: "win"; team: string } | { kind: "no-result" } | { kind: "tie" };

// "India won by 5 wickets (with 56 balls remaining) (DLS method)", "No result (abandoned with a toss)", "Match tied". Null when it says none of these.
export function outcomeOf(matchNote: string | null, teams: [string, string]): Outcome | null {
  const note = (matchNote ?? "").trim();
  if (!note) return null;
  if (/^no result\b/i.test(note) || /^abandoned\b/i.test(note)) return { kind: "no-result" };
  if (/\b(match tied|tied)\b/i.test(note) && !/\bwon\b/i.test(note)) return { kind: "tie" };
  for (const t of teams) if (note.toLowerCase().startsWith(`${t.toLowerCase()} won`)) return { kind: "win", team: t };
  return null;
}

// The short line under a match's bars: "India won by 5 wickets (DLS)".
export function noteLine(matchNote: string | null): string | undefined {
  const note = (matchNote ?? "").trim();
  if (!note) return undefined;
  const dls = /\bDLS\b/i.test(note);
  const base = note.replace(/\s*\((?:with|abandoned)[^)]*\)/gi, "").replace(/\s*\(DLS method\)/i, "").trim();
  return dls ? `${base} (DLS)` : base;
}

export interface SeriesChart {
  /** One key per series, format and number of finished matches: the chart for a later match is a new one. */
  key: string;
  /** The article row of the latest finished match (what the post rows hang from). */
  latestArticleId: string;
  finished: number;
  total: number;
  params: ChartReelParams;
  hook: string;
  caption: string;
  subtitle: string;
}

export type SeriesVerdict = { ok: true; chart: SeriesChart } | { ok: false; reason: string };

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => NUM_WORDS[n] ?? String(n);

// Builds the chart for one series and format from its rows, or says why not.
export function buildSeriesChart(rows: SeriesRow[], format: Format, now: Date = new Date(), maxAgeHours = 36): SeriesVerdict {
  const parsed = rows.map((r) => ({ r, g: parseEspnGame(r.sourceUrl) })).filter((x) => x.g && x.g.format === format) as { r: SeriesRow; g: { seriesId: string; gameNo: number; format: Format } }[];
  if (parsed.length === 0) return { ok: false, reason: "no rows of this format" };
  const seriesIds = new Set(parsed.map((x) => x.g.seriesId));
  if (seriesIds.size !== 1) return { ok: false, reason: "rows from more than one series" };
  parsed.sort((a, b) => a.g.gameNo - b.g.gameNo);
  const nos = parsed.map((x) => x.g.gameNo);
  if (new Set(nos).size !== nos.length) return { ok: false, reason: "a game number appears twice" };
  const total = Math.max(...nos);
  if (parsed.length !== total || nos.some((n, i) => n !== i + 1)) return { ok: false, reason: "the series has missing games" };
  const teamSet = new Set<string>();
  for (const { r } of parsed) { if (!r.homeTeam || !r.awayTeam) return { ok: false, reason: "a match has no teams" }; teamSet.add(r.homeTeam); teamSet.add(r.awayTeam); }
  if (teamSet.size !== 2) return { ok: false, reason: "not two teams" };
  const teams = [...teamSet].sort() as [string, string];
  const finishedRows = parsed.filter((x) => x.r.matchStatus === "finished");
  if (finishedRows.length < 2) return { ok: false, reason: "fewer than two finished matches" };

  // The side shown first is the touring/home side named first in the row labels, i.e. the team whose name comes first alphabetically is not meant to
  // matter: the chart always leads with the team that won more, ties alphabetical.
  const tally: Record<string, number> = { [teams[0]]: 0, [teams[1]]: 0 };
  let noResults = 0;
  let ties = 0;
  const perMatch: { label: string; scores: Record<string, { runs: number | null; text: string }>; outcome: Outcome; note?: string }[] = [];
  for (const { r, g } of finishedRows) {
    const o = outcomeOf(r.matchNote, teams);
    if (!o) return { ok: false, reason: `match ${g.gameNo} has no readable result` };
    if (o.kind === "win") tally[o.team]++;
    else if (o.kind === "no-result") noResults++;
    else ties++;
    const home = r.homeTeam as string;
    const away = r.awayTeam as string;
    const scores: Record<string, { runs: number | null; text: string }> = {
      [home]: { runs: runsOf(r.homeScoreText ?? ""), text: (r.homeScoreText ?? "").replace(/\s*\(.*$/, "").trim() },
      [away]: { runs: runsOf(r.awayScoreText ?? ""), text: (r.awayScoreText ?? "").replace(/\s*\(.*$/, "").trim() },
    };
    if (o.kind !== "no-result" && (scores[home].runs === null || scores[away].runs === null)) return { ok: false, reason: `match ${g.gameNo} has a result but no scores` };
    const d = r.kickoffAt ? r.kickoffAt : null;
    const label = `${ordinal(g.gameNo)} ${FORMAT_NAME[format]}${d ? ` · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}`;
    perMatch.push({ label, scores, outcome: o, note: noteLine(r.matchNote) });
  }
  // Latest finished match, and whether it is fresh enough to be news.
  const latest = finishedRows[finishedRows.length - 1];
  const latestAt = latest.r.kickoffAt;
  if (!latestAt || now.getTime() - latestAt.getTime() > maxAgeHours * 3_600_000) return { ok: false, reason: "latest finished match is not recent" };
  if (latestAt.getTime() > now.getTime()) return { ok: false, reason: "latest match is in the future" };

  const [first, second] = tally[teams[0]] === tally[teams[1]] ? teams : tally[teams[0]] > tally[teams[1]] ? teams : ([teams[1], teams[0]] as [string, string]);
  const chartMatches: ChartMatch[] = perMatch.map((m) => ({
    label: m.label,
    a: { runs: m.scores[first]?.runs ?? 0, text: m.outcome.kind === "no-result" ? "–" : m.scores[first].text, won: m.outcome.kind === "win" && m.outcome.team === first },
    b: { runs: m.scores[second]?.runs ?? 0, text: m.outcome.kind === "no-result" ? "–" : m.scores[second].text, won: m.outcome.kind === "win" && m.outcome.team === second },
    note: m.outcome.kind === "no-result" ? "No result" : m.note,
  }));
  const done = finishedRows.length;
  const remaining = total - done;
  const wf = tally[first];
  const ws = tally[second];
  const fmtName = FORMAT_NAME[format];
  const decided = wf > total / 2 || ws > total / 2;
  const level = wf === ws;
  let hook: string;
  if (decided) hook = `${wf > ws ? first : second} win the ${fmtName} series ${Math.max(wf, ws)}–${Math.min(wf, ws)}`;
  else if (level) hook = `${first} v ${second}: ${fmtName} series level at ${wf}–${ws}`;
  else hook = `${first} lead ${second} ${wf}–${ws} in the ${fmtName} series`;
  const extra = [noResults ? `${noResults} no result${noResults > 1 ? "s" : ""}` : "", ties ? `${ties} tied` : ""].filter(Boolean).join(", ");
  const subtitle = `Cricket · ${latest.r.leagueLabel ?? `${first} v ${second}`}`;
  const progress = remaining > 0 ? `${word(done)} of ${word(total)} matches played${extra ? ` (${extra})` : ""}` : `${word(total)} matches played${extra ? ` (${extra})` : ""}`;
  const caption = `📊 ${hook}, ${progress}. The runs, match by match. ${remaining > 0 ? "Who takes the rest of the series?" : "Who impressed you most?"} Tell us in the comments.`;
  const params: ChartReelParams = {
    title: hook,
    subtitle,
    teamA: first,
    teamB: second,
    codeA: code(first),
    codeB: code(second),
    matches: chartMatches,
    footnote: `${progress[0].toUpperCase()}${progress.slice(1)}. Scores as recorded; rain-affected matches use DLS targets.`,
  };
  return { ok: true, chart: { key: `${[...seriesIds][0]}-${format}-g${done}`, latestArticleId: latest.r.id, finished: done, total, params, hook, caption, subtitle } };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const CODES: Record<string, string> = { India: "IND", "New Zealand": "NZ", Australia: "AUS", England: "ENG", Pakistan: "PAK", "South Africa": "SA", "Sri Lanka": "SL", Bangladesh: "BAN", Afghanistan: "AFG", "West Indies": "WI", Ireland: "IRE", Zimbabwe: "ZIM" };
export const code = (team: string): string => CODES[team] ?? team.slice(0, 3).toUpperCase();

// Rows of one tour grouped by series id and format: [seriesId, format] -> rows.
export function groupBySeries(rows: SeriesRow[]): Map<string, { seriesId: string; format: Format; rows: SeriesRow[] }> {
  const out = new Map<string, { seriesId: string; format: Format; rows: SeriesRow[] }>();
  for (const r of rows) {
    const g = parseEspnGame(r.sourceUrl);
    if (!g || g.format === "test") continue;
    const k = `${g.seriesId}:${g.format}`;
    (out.get(k) ?? out.set(k, { seriesId: g.seriesId, format: g.format, rows: [] }).get(k)!).rows.push(r);
  }
  return out;
}

