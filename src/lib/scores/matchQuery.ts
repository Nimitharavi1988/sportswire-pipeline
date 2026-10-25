/**
 * Reads a search box entry as a match query (pure, unit-tested): the team or
 * competition words, plus the intent words that narrow by state, day or sport.
 *
 *   "india west indies"  -> words [india, west, indies]
 *   "live cricket"       -> state live, sport cricket
 *   "arsenal fixtures"   -> words [arsenal], state upcoming
 *   "nba today"          -> sport basketball, day today
 *   "man city results"   -> words [man, city], state final
 *
 * Returns null when nothing in the entry could be a match search (a lone
 * "scores", or text that is all filler), so plain story searches skip it.
 */
import type { ScoreMatch } from "./scoreboardModel";

export type MatchStateFilter = "live" | "upcoming" | "final";
export type MatchDay = "yesterday" | "today" | "tomorrow";

export interface MatchQuery {
  // Team / competition words; every one must appear in the home team, away
  // team or competition name.
  words: string[];
  state?: MatchStateFilter;
  day?: MatchDay;
  // A top-level sport category ("cricket", "american-football").
  sport?: string;
}

const STATE_WORDS: Record<string, MatchStateFilter> = {
  live: "live",
  inplay: "live",
  ongoing: "live",
  upcoming: "upcoming",
  fixtures: "upcoming",
  fixture: "upcoming",
  schedule: "upcoming",
  next: "upcoming",
  results: "final",
  result: "final",
  final: "final",
  finals: "final",
  finished: "final",
  recent: "final",
};

const DAY_WORDS: Record<string, MatchDay> = { today: "today", tonight: "today", yesterday: "yesterday", tomorrow: "tomorrow" };

// Words people use for a sport, and the category they mean.
const SPORT_WORDS: Record<string, string> = {
  cricket: "cricket",
  football: "football",
  soccer: "football",
  nfl: "american-football",
  nba: "basketball",
  basketball: "basketball",
  wnba: "wnba",
  mlb: "baseball",
  baseball: "baseball",
  nhl: "hockey",
  hockey: "hockey",
  volleyball: "volleyball",
};

// What people type for a name the data spells out.
const ALIAS: Record<string, string> = { utd: "united", spurs: "tottenham", barca: "barcelona", bayern: "bayern", psg: "paris" };

// Said of every score search; say nothing about which one.
const FILLER = new Set(["score", "scores", "match", "matches", "game", "games", "vs", "v", "versus", "the", "of", "and"]);

export function parseMatchQuery(raw: string): MatchQuery | null {
  const tokens = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const q: MatchQuery = { words: [] };
  for (const raw of tokens) {
    const t = ALIAS[raw] ?? raw;
    if (t in STATE_WORDS && !q.state) q.state = STATE_WORDS[t];
    else if (t in DAY_WORDS && !q.day) q.day = DAY_WORDS[t];
    else if (t in SPORT_WORDS && !q.sport) q.sport = SPORT_WORDS[t];
    else if (!FILLER.has(t)) q.words.push(t);
  }
  // A one-letter word ("a", "x") would match half the table.
  q.words = q.words.filter((w) => w.length > 1);
  return q.words.length > 0 || q.state || q.day || q.sport ? q : null;
}

// Whether a loaded match fits a query — the /scores filter box, which narrows
// what is already on the page instead of searching the database. Day words are
// ignored there (the day tabs do that); state, sport and team/competition
// words apply, each word having to start a word in a team or competition name.
export function matchFits(m: ScoreMatch, q: MatchQuery): boolean {
  if (q.sport && m.sport !== q.sport) return false;
  if (q.state) {
    const inPlay = m.state === "live" || m.state === "paused" || m.state === "started";
    if (q.state === "live" ? !inPlay : q.state === "upcoming" ? m.state !== "upcoming" : m.state !== "final") return false;
  }
  const hay = [m.home.name, m.away.name, m.leagueLabel]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ");
  return q.words.every((w) => hay.startsWith(w) || hay.includes(" " + w));
}

// "Today" and friends as kickoff windows relative to now. The viewer's time
// zone isn't known on the server, so these are generous half-days either side.
const HOUR = 60 * 60 * 1000;
export function dayWindow(day: MatchDay, now: number): { from: number; to: number } {
  if (day === "today") return { from: now - 12 * HOUR, to: now + 18 * HOUR };
  if (day === "tomorrow") return { from: now + 12 * HOUR, to: now + 42 * HOUR };
  return { from: now - 42 * HOUR, to: now - 12 * HOUR };
}
