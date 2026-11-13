/**
 * MLB box score from MLB's own free stats API (statsapi.mlb.com, no key):
 * the line score (runs by inning, R/H/E), every batter's and pitcher's game
 * line, and team totals. MLB matches are stored with an mlb.com/gameday link
 * ("https://www.mlb.com/gameday/849848"), which carries the game id the API
 * wants — no lookup needed. Shapes checked live 2026-09-30. Output is the
 * same BoxScore the other sports use (espnBoxScore.ts), so one component
 * draws it.
 */
import type { BoxScore, StatGroup, TeamBox } from "./espnBoxScore";

export function mlbGamePk(sourceUrl: string): string | null {
  return sourceUrl.match(/mlb\.com\/gameday\/(\d+)/i)?.[1] ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- MLB's payload is untyped JSON; every access below is optional-chained */
const text = (v: unknown): string => (v === undefined || v === null || v === "" || v === "-.--" || v === ".---" ? "" : String(v));

const BATTING_LABELS = ["AB", "R", "H", "RBI", "BB", "SO", "AVG"];
const PITCHING_LABELS = ["IP", "H", "R", "ER", "BB", "SO", "HR", "ERA"];

// Batters in batting order; a substitute shares his slot's number (100, then
// 101, 102 …), so a plain numeric sort keeps each replacement right under the
// player he replaced.
function battingGroup(side: any): StatGroup {
  const players: any[] = Object.values(side?.players ?? {});
  const batters = players
    .filter((p) => p.battingOrder && p.stats?.batting && Object.keys(p.stats.batting).length > 0)
    .sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder));
  const t = side?.teamStats?.batting ?? {};
  return {
    title: "Batting",
    labels: BATTING_LABELS,
    rows: batters.map((p) => {
      const s = p.stats.batting;
      const pos = p.position?.abbreviation ?? "";
      const sub = Number(p.battingOrder) % 100 !== 0;
      return {
        name: p.person?.fullName ?? "",
        detail: sub ? `${pos} · substitute` : pos,
        stats: [text(s.atBats), text(s.runs), text(s.hits), text(s.rbi), text(s.baseOnBalls), text(s.strikeOuts), text(p.seasonStats?.batting?.avg)],
      };
    }),
    totals: [text(t.atBats), text(t.runs), text(t.hits), text(t.rbi), text(t.baseOnBalls), text(t.strikeOuts), text(t.avg)],
  };
}

function pitchingGroup(side: any): StatGroup {
  const ids: number[] = side?.pitchers ?? [];
  const t = side?.teamStats?.pitching ?? {};
  return {
    title: "Pitching",
    labels: PITCHING_LABELS,
    rows: ids.flatMap((id) => {
      const p = side.players?.["ID" + id];
      const s = p?.stats?.pitching;
      if (!s) return [];
      return [
        {
          name: p.person?.fullName ?? "",
          detail: s.note || "",
          stats: [text(s.inningsPitched), text(s.hits), text(s.runs), text(s.earnedRuns), text(s.baseOnBalls), text(s.strikeOuts), text(s.homeRuns), text(p.seasonStats?.pitching?.era)],
        },
      ];
    }),
    totals: [text(t.inningsPitched), text(t.hits), text(t.runs), text(t.earnedRuns), text(t.baseOnBalls), text(t.strikeOuts), text(t.homeRuns), ""],
  };
}

// Pure, unit-tested: MLB boxscore + linescore -> the shared BoxScore.
// `over`: the game is finished, so an inning the home side never batted in
// (it was already ahead) reads "X" rather than blank.
export function parseMlbBoxScore(boxscore: any, linescore: any, over = false): BoxScore {
  const sides = [boxscore?.teams?.away, boxscore?.teams?.home];
  const teams: TeamBox[] = sides.map((side) => ({
    team: side?.team?.name ?? "",
    groups: [battingGroup(side), pitchingGroup(side)].filter((g) => g.rows.length > 0),
  }));

  const played: any[] = linescore?.innings ?? [];
  // A game shows at least nine innings, more when it goes to extras.
  const count = Math.max(9, played.length);
  const rowFor = (key: "away" | "home", name: string) => ({
    team: name,
    values: Array.from({ length: count }, (_, i) => {
      const runs = played[i]?.[key]?.runs;
      if (runs !== undefined) return String(runs);
      return over && key === "home" && i === played.length - 1 && played[i]?.away?.runs !== undefined ? "X" : "";
    }),
    totals: [text(linescore?.teams?.[key]?.runs) || "0", text(linescore?.teams?.[key]?.hits) || "0", text(linescore?.teams?.[key]?.errors) || "0"],
  });
  const hasLine = played.length > 0;

  return {
    source: "MLB",
    statTeams: ["", ""],
    teamStats: [],
    teams,
    events: [],
    lineups: [],
    lineScore: hasLine
      ? { innings: Array.from({ length: count }, (_, i) => String(i + 1)), rows: [rowFor("away", teams[0].team), rowFor("home", teams[1].team)] }
      : undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Live games refresh quickly; finished ones barely change.
export async function fetchMlbBoxScore(gamePk: string, inPlay: boolean): Promise<BoxScore | null> {
  const next = { revalidate: inPlay ? 30 : 900 };
  try {
    const [box, line] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`, { next }),
      fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/linescore`, { next }),
    ]);
    if (!box.ok) return null;
    const parsed = parseMlbBoxScore(await box.json(), line.ok ? await line.json() : null, !inPlay);
    return parsed.teams.some((t) => t.groups.length > 0) || parsed.lineScore ? parsed : null;
  } catch {
    // A box score is a bonus — never an error page.
    return null;
  }
}
