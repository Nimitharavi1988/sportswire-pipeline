/**
 * Box score for a match page, from ESPN's match summary (free, no key — same
 * source as the live scores). One reader for the sports whose summaries share
 * a shape: NBA, WNBA, NHL, NFL and college football (player stat tables per
 * team) and soccer (team stats, key events, lineups). Fetched when the page
 * renders and cached briefly, never stored. Shapes checked live 2026-09-30.
 *
 * Which game: the stored ESPN link (".../nhl/game/_/gameId/401892431") names
 * the sport and game; soccer links carry no league, so that comes from the
 * match's league label. Rows from other providers (football-data.org, MLB's
 * own API) have no ESPN link and so no box score.
 */
import { espnFetch } from "../espnFetch";
import { resolveEspnSoccerGame, SOCCER_LEAGUE_CODES } from "./espnSoccerLookup";
import { fetchMlbBoxScore, mlbGamePk } from "./mlbBoxScore";

export interface StatGroup {
  // "Passing", "Forwards", or "Players" when the sport has one table.
  title: string;
  labels: string[];
  // `detail`: a line under the name (a baseball player's position).
  rows: { name: string; stats: string[]; detail?: string }[];
  totals: string[] | null;
}

export interface TeamBox {
  team: string;
  groups: StatGroup[];
}

export interface MatchEvent {
  clock: string;
  kind: "goal" | "yellow" | "red" | "sub";
  team: string;
  text: string;
}

export interface Lineup {
  team: string;
  formation: string | null;
  starters: { jersey: string; name: string; position: string }[];
  bench: { jersey: string; name: string }[];
}

// Runs by inning with the R/H/E columns (baseball).
export interface LineScore {
  innings: string[];
  rows: { team: string; values: string[]; totals: string[] }[];
}

export interface BoxScore {
  // "ESPN", "MLB" — credited under the box score.
  source: string;
  lineScore?: LineScore;
  // The two teams named in `teamStats`, in column order.
  statTeams: [string, string];
  // Both teams' totals side by side: Possession 50.8 / 49.2.
  teamStats: { label: string; home: string; away: string }[];
  teams: TeamBox[];
  events: MatchEvent[];
  lineups: Lineup[];
}

// ESPN link slug -> API path. Soccer is resolved from the league label.
const PATHS: Record<string, string> = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  nhl: "hockey/nhl",
  nfl: "football/nfl",
  "college-football": "football/college-football",
};

export function espnGameRef(sourceUrl: string, leagueLabel: string): { path: string; id: string } | null {
  const m = sourceUrl.match(/espn\.[a-z.]+\/([a-z-]+)\/(?:game|match)\/_\/gameId\/(\d+)/i);
  if (!m) return null;
  if (m[1] === "soccer") {
    const code = SOCCER_LEAGUE_CODES[leagueLabel];
    return code ? { path: `soccer/${code}`, id: m[2] } : null;
  }
  const path = PATHS[m[1]];
  return path ? { path, id: m[2] } : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- ESPN's payload is untyped JSON; every access below is optional-chained */
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, " $1");

function parseTeams(summary: any): TeamBox[] {
  return (summary?.boxscore?.players ?? []).map((p: any): TeamBox => ({
    team: p.team?.displayName ?? "",
    groups: (p.statistics ?? [])
      .map((g: any): StatGroup => ({
        title: g.text || (g.name ? title(g.name) : "Players"),
        labels: g.labels ?? g.names ?? [],
        rows: (g.athletes ?? []).map((a: any) => ({ name: a.athlete?.displayName ?? "", stats: a.stats ?? [] })),
        totals: Array.isArray(g.totals) && g.totals.some((t: string) => t) ? g.totals : null,
      }))
      .filter((g: StatGroup) => g.rows.length > 0),
  }));
}

function parseTeamStats(summary: any): BoxScore["teamStats"] {
  const [a, b] = summary?.boxscore?.teams ?? [];
  if (!a || !b) return [];
  const away = new Map<string, string>((b.statistics ?? []).map((s: any) => [s.label, s.displayValue]));
  // `a` is whichever ESPN lists first; callers match it to home/away by name.
  return (a.statistics ?? []).flatMap((s: any) => (s.label && away.has(s.label) ? [{ label: s.label, home: s.displayValue, away: away.get(s.label)! }] : []));
}

const EVENT_KINDS: Record<string, MatchEvent["kind"]> = {
  goal: "goal", "penalty---scored": "goal", "own-goal": "goal", "penalty---goal": "goal",
  "yellow-card": "yellow", "red-card": "red", substitution: "sub",
};

function parseEvents(summary: any): MatchEvent[] {
  return (summary?.keyEvents ?? []).flatMap((e: any): MatchEvent[] => {
    const kind = EVENT_KINDS[e.type?.type];
    // ESPN's short text for a substitution is just the player coming on
    // ("Kevin Substitution"); the full sentence says who he replaced.
    const text = kind === "sub" ? e.text || e.shortText : e.shortText || e.text;
    return kind && text ? [{ clock: e.clock?.displayValue ?? "", kind, team: e.team?.displayName ?? "", text }] : [];
  });
}

function parseLineups(summary: any): Lineup[] {
  return (summary?.rosters ?? []).map((r: any): Lineup => {
    const roster: any[] = r.roster ?? [];
    return {
      team: r.team?.displayName ?? "",
      formation: r.formation || null,
      starters: roster.filter((p) => p.starter).map((p) => ({ jersey: p.jersey ?? "", name: p.athlete?.displayName ?? "", position: p.position?.abbreviation ?? "" })),
      bench: roster.filter((p) => !p.starter).map((p) => ({ jersey: p.jersey ?? "", name: p.athlete?.displayName ?? "" })),
    };
  });
}

// Pure, unit-tested: ESPN summary -> what the page shows.
export function parseBoxScore(summary: unknown): BoxScore {
  const names = (summary as any)?.boxscore?.teams?.map((t: any) => t.team?.displayName ?? "") ?? [];
  return { source: "ESPN", statTeams: [names[0] ?? "", names[1] ?? ""], teamStats: parseTeamStats(summary), teams: parseTeams(summary), events: parseEvents(summary), lineups: parseLineups(summary) };
}

// ESPN lists the away team first; the match header puts the home team on the
// left, so put it first here too (team stats columns, player tabs, lineups).
export function homeFirst(box: BoxScore, homeName: string): BoxScore {
  const [a, b] = box.statTeams;
  if (a !== homeName && b === homeName) {
    box = { ...box, statTeams: [b, a], teamStats: box.teamStats.map((s) => ({ label: s.label, home: s.away, away: s.home })) };
  }
  const first = <T extends { team: string }>(items: T[]) => [...items.filter((i) => i.team === homeName), ...items.filter((i) => i.team !== homeName)];
  return { ...box, teams: first(box.teams), lineups: first(box.lineups) };
}

export function hasBoxScore(b: BoxScore): boolean {
  return b.teams.some((t) => t.groups.length > 0) || Boolean(b.lineScore) || b.events.length > 0 || b.lineups.some((l) => l.starters.length > 0);
}

// Live matches refresh quickly; finished ones barely change.
// The match as the page knows it: used to find the ESPN game when the stored
// link isn't an ESPN one (football-data.org rows), and to put the home team first.
export interface MatchContext {
  home: string;
  away: string;
  kickoffAt: string | null;
}

export async function fetchBoxScore(sourceUrl: string, leagueLabel: string, inPlay: boolean, match: MatchContext): Promise<BoxScore | null> {
  // MLB games link to mlb.com and come from MLB's own API.
  const pk = mlbGamePk(sourceUrl);
  if (pk) {
    const box = await fetchMlbBoxScore(pk, inPlay);
    return box ? homeFirst(box, match.home) : null;
  }
  const ref = espnGameRef(sourceUrl, leagueLabel) ?? (await resolveEspnSoccerGame(leagueLabel, match.kickoffAt, match.home, match.away));
  if (!ref) return null;
  try {
    const res = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${ref.path}/summary?event=${ref.id}`, { next: { revalidate: inPlay ? 30 : 900 } });
    if (!res.ok) return null;
    const box = parseBoxScore(await res.json());
    return hasBoxScore(box) ? homeFirst(box, match.home) : null;
  } catch {
    // A box score is a bonus — never an error page.
    return null;
  }
}
