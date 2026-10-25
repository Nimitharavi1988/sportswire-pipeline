/**
 * What matters most on the scoreboard right now (pure, unit-tested).
 *
 * Two ideas, both derived from data the cards already carry:
 *  - Priority: a game's rank is its state (in play beats starting soon beats
 *    just finished beats later), the prominence of its competition, how
 *    close a live game is, and a short boost when something just happened.
 *  - Events: diffing the previous and next copy of a card shows what
 *    happened between two polls (kick-off, goal, wicket, full time). The
 *    source feeds don't store play-by-play, so this is the only reliable
 *    signal — and it needs no extra provider calls.
 */
import type { ScoreMatch } from "./scoreboardModel";

// How long a fresh event keeps its game pinned near the top.
export const EVENT_HOT_MS = 3 * 60 * 1000;

export type MatchEventKind = "kickoff" | "score" | "wicket" | "final";

export interface MatchEvent {
  kind: MatchEventKind;
  // "Goal · Arsenal 2–1 Chelsea"
  label: string;
  at: number;
}

const STATE_BASE = { live: 1000, paused: 700, started: 600, upcoming: 200, final: 100 } as const;

// Competitions readers look for first. Matched against the league label
// (football-data / ESPN names), so a new competition just needs a pattern.
const TIER_1 =
  /\b(premier league|champions league|europa league|world cup|euro(pean)? championship|euros|la liga|primera division|bundesliga|serie a|ligue 1|nfl|nba|mlb|nhl|ipl|indian premier|the ashes|ashes|test|odi|t20i?|international|nations league)\b/i;
const TIER_2 = /\b(college football|wnba|mls|liga mx|libertadores|concacaf champions|liga profesional|betplay|championship|eredivisie|primeira liga|conference league|big bash|the hundred|psl|county|brasileir)/i;

// Cricket that is never a headline however it is labelled: women's and
// age-group sides, qualifiers, domestic and "A" tours. Checked before the
// tiers so "ICC T20 World Cup Sub Regional Qualifier" is not a World Cup.
const MINOR_CRICKET = /\b(women'?s?|under-?\d+|u-?\d\d|qualifier|sub regional|emerging|domestic|pro20|academy|second xi)\b|\b\w+ A tour\b/i;

// US sports the audience is mostly here for (explicit request 2026-10-02: most
// viewers are in the US, but a live minor cricket or volleyball game outranked
// tonight's NHL and college football games on the home scores strip, because
// "in play" scored 1000 and an upcoming game 200). Applied only to a league
// that already rates tier 1 or 2, so a minor US league gets nothing.
const US_SPORTS = new Set(["american-football", "college-football", "baseball", "hockey", "basketball", "wnba"]);
const US_AUDIENCE_BOOST = 600;
// A result is news for half a day; a game is relevant from 36h ahead.
const US_FINAL_FRESH_MS = 12 * 60 * 60 * 1000;
const US_UPCOMING_WINDOW_MS = 36 * 60 * 60 * 1000;

export function usAudienceBoost(m: ScoreMatch, now: number): number {
  if (!US_SPORTS.has(m.sport) || leagueWeight(m.leagueLabel, m.sport) < 200) return 0;
  const kickoff = m.kickoffAt ? Date.parse(m.kickoffAt) : null;
  if (m.state === "final") return kickoff !== null && now - kickoff <= US_FINAL_FRESH_MS ? US_AUDIENCE_BOOST / 2 : 0;
  if (m.state === "upcoming") return kickoff !== null && kickoff - now <= US_UPCOMING_WINDOW_MS ? US_AUDIENCE_BOOST : 0;
  // A game in play already outranks the minor games that were beating tonight's
  // US schedule (1000 + its league tier), and a fresh marquee result must keep
  // sitting above a live game (see the marquee tests) — so no boost there.
  return m.state === "started" ? US_AUDIENCE_BOOST : 0;
}

// Higher-profile competitions first; unknown leagues still rank, just last.
export function leagueWeight(label: string, sport?: string): number {
  if (sport === "cricket" && MINOR_CRICKET.test(label)) return 100;
  if (TIER_1.test(label)) return 300;
  if (TIER_2.test(label)) return 200;
  return 100;
}

// Teams that make a game a marquee fixture. Cricket: the senior men's
// sides that tour and play ICC events (exact names, so "India A" and "India
// Women" do not count). Football: clubs with a worldwide audience (matched
// by name, as providers add "FC" and the like).
const CRICKET_MAJOR = new Set(["india", "australia", "england", "pakistan", "south africa", "new zealand", "sri lanka", "west indies", "bangladesh", "afghanistan"]);
const FOOTBALL_MAJOR = [
  "manchester city", "manchester united", "liverpool", "arsenal", "chelsea", "tottenham", "real madrid", "barcelona", "atletico madrid", "atlético madrid",
  "bayern", "borussia dortmund", "paris saint-germain", "psg", "juventus", "inter milan", "internazionale", "ac milan", "napoli",
];

// National teams in football (Nations League, friendlies), exact names: a substring
// match would make "New England Revolution" an England game.
const FOOTBALL_NATIONS = new Set(["england", "france", "germany", "spain", "italy", "portugal", "netherlands", "belgium", "croatia", "brazil", "argentina", "united states", "mexico"]);

export function isMajorTeam(sport: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (sport === "cricket") return CRICKET_MAJOR.has(n);
  if (sport === "football") return FOOTBALL_NATIONS.has(n) || FOOTBALL_MAJOR.some((t) => n.includes(t));
  return false;
}

// Two major sides (India v West Indies, Liverpool v Arsenal) outrank any
// minor game even a live one; one major side, or India alone, lifts a game
// part way. Applies in every state, so a big result stays up after full time.
export function teamBoost(m: ScoreMatch): number {
  const home = isMajorTeam(m.sport, m.home.name);
  const away = isMajorTeam(m.sport, m.away.name);
  if (home && away) return 1200;
  if (!home && !away) return 0;
  return m.sport === "cricket" && (m.home.name === "India" || m.away.name === "India") ? 400 : 250;
}

// Leading integer of a display score: "24" -> 24, "287/6 (48.2 ov)" -> 287.
function runs(score: string | null): number | null {
  const n = score ? Number.parseInt(score, 10) : Number.NaN;
  return Number.isNaN(n) ? null : n;
}

// Cricket wickets from "287/6 (48.2 ov)"; 0 when none shown.
function wickets(score: string | null): number {
  const w = score?.match(/\/(\d+)/)?.[1];
  return w ? Number(w) : 0;
}

// Live games decided by little are worth more attention (points levels
// differ by sport; cricket isn't comparable between innings, so it's skipped).
function closeness(m: ScoreMatch): number {
  if (m.state !== "live" || m.sport === "cricket") return 0;
  const h = runs(m.home.score);
  const a = runs(m.away.score);
  if (h === null || a === null) return 0;
  const gap = Math.abs(h - a);
  const tight = m.sport === "basketball" || m.sport === "wnba" || m.sport === "american-football" || m.sport === "college-football" ? 8 : 1;
  return gap <= tight ? 60 : gap <= tight * 2 ? 30 : 0;
}

// A marquee result stays at the top for 12 hours after the game; after that
// it still outranks minor results but no longer sits above live games, which
// are what readers open the scores to find.
const MARQUEE_FRESH_MS = 12 * 60 * 60 * 1000;
function marqueeBoost(m: ScoreMatch, now: number): number {
  const boost = teamBoost(m);
  if (m.state === "final" && m.kickoffAt && now - Date.parse(m.kickoffAt) > MARQUEE_FRESH_MS) return Math.min(boost, 300);
  return boost;
}

export function matchPriority(m: ScoreMatch, now: number, event?: MatchEvent): number {
  let p = STATE_BASE[m.state] + leagueWeight(m.leagueLabel, m.sport) + marqueeBoost(m, now) + closeness(m) + usAudienceBoost(m, now);
  if (m.state === "upcoming" && m.kickoffAt) {
    // Starting within two hours outranks a game later in the window.
    const until = Date.parse(m.kickoffAt) - now;
    if (until <= 2 * 60 * 60 * 1000) p += 200;
    // Beyond a day and a half a game sits below everything in play; only a
    // marquee one still clears minor games and old results.
    else if (until > 36 * 60 * 60 * 1000) p -= 500;
  }
  // An old result only stays up if it was a marquee game (teamBoost).
  if (m.state === "final" && m.kickoffAt && now - Date.parse(m.kickoffAt) > 36 * 60 * 60 * 1000) p -= 150;
  if (event && now - event.at < EVENT_HOT_MS) p += 500;
  return p;
}

const SIDE_LABEL = (m: ScoreMatch) => `${m.home.name} ${m.home.score ?? 0}–${m.away.score ?? 0} ${m.away.name}`;

// Scoring in these happens too often (basketball, volleyball) for each
// change to be an "event"; those only flag kick-off and full time.
const SCORE_EVENT_WORD: Record<string, string> = {
  football: "Goal",
  hockey: "Goal",
  baseball: "Run scores",
  "american-football": "Score",
  "college-football": "Score",
};

// What changed between two copies of the same card, if anything notable.
export function detectEvent(prev: ScoreMatch, next: ScoreMatch, now: number): MatchEvent | null {
  if (prev.id !== next.id) return null;
  if (next.state === "final" && prev.state !== "final") {
    return { kind: "final", label: `Full time · ${SIDE_LABEL(next)}`, at: now };
  }
  if (next.state === "live" && (prev.state === "upcoming" || prev.state === "started")) {
    return { kind: "kickoff", label: `Under way · ${next.home.name} v ${next.away.name}`, at: now };
  }
  if (next.state !== "live") return null;

  if (next.sport === "cricket") {
    const side = wickets(next.home.score) > wickets(prev.home.score) ? next.home : wickets(next.away.score) > wickets(prev.away.score) ? next.away : null;
    if (side) return { kind: "wicket", label: `Wicket · ${side.name} ${side.score ?? ""}`.trim(), at: now };
    return null;
  }
  const word = SCORE_EVENT_WORD[next.sport];
  if (!word) return null;
  const moved = (a: string | null, b: string | null) => runs(a) !== null && runs(b) !== null && (runs(b) as number) > (runs(a) as number);
  if (moved(prev.home.score, next.home.score) || moved(prev.away.score, next.away.score)) {
    return { kind: "score", label: `${word} · ${SIDE_LABEL(next)}`, at: now };
  }
  return null;
}

// Events across a whole poll: previous cards vs next cards.
export function detectEvents(prev: ScoreMatch[], next: ScoreMatch[], now: number): Map<string, MatchEvent> {
  const before = new Map(prev.map((m) => [m.id, m]));
  const found = new Map<string, MatchEvent>();
  for (const m of next) {
    const old = before.get(m.id);
    const ev = old ? detectEvent(old, m, now) : null;
    if (ev) found.set(m.id, ev);
  }
  return found;
}

// Comparator for "most important first" lists (the score strip, the
// homepage panel). Finals read newest-first; ties fall back to kickoff.
export function byPriority(now: number) {
  const kickoff = (m: ScoreMatch) => (m.kickoffAt ? Date.parse(m.kickoffAt) : 0);
  return (a: ScoreMatch, b: ScoreMatch): number => {
    const diff = matchPriority(b, now) - matchPriority(a, now);
    if (diff !== 0) return diff;
    return a.state === "final" ? kickoff(b) - kickoff(a) : kickoff(a) - kickoff(b);
  };
}
