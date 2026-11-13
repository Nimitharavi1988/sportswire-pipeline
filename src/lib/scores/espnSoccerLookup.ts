/**
 * Finds a match's ESPN game for competitions we get from football-data.org
 * (Premier League, La Liga, Champions League, ...). Those rows carry no ESPN
 * id, so the match is found on ESPN's scoreboard for its day by teams and
 * kickoff, then its summary gives the box score (espnBoxScore.ts).
 *
 * Providers name clubs differently ("Real Sociedad de Fútbol" / "Real
 * Sociedad", "Sport Lisboa e Benfica" / "Benfica", "FC Internazionale Milano"
 * / "Inter Milan"), so names are compared as sets of significant words, with
 * a few spellings folded together. If the names don't settle it, a game that
 * kicks off within half an hour with one team matching is accepted — but only
 * when it is the single such candidate. No match means no box score, never a
 * wrong one.
 */
import { espnFetch } from "../espnFetch";

// football-data.org competition name -> ESPN league code.
export const SOCCER_LEAGUE_CODES: Record<string, string> = {
  "Premier League": "eng.1",
  Championship: "eng.2",
  "Primera Division": "esp.1",
  "La Liga": "esp.1",
  "UEFA Champions League": "uefa.champions",
  "Serie A": "ita.1",
  Bundesliga: "ger.1",
  "Ligue 1": "fra.1",
  "Primeira Liga": "por.1",
  Eredivisie: "ned.1",
  "Campeonato Brasileiro Série A": "bra.1",
  "European Championship": "uefa.euro",
  "FIFA World Cup": "fifa.world",
  MLS: "usa.1",
  "Liga MX": "mex.1",
  "Liga Profesional Argentina": "arg.1",
  "Liga BetPlay Colombia": "col.1",
  "Copa Libertadores": "conmebol.libertadores",
  "Concacaf Champions Cup": "concacaf.champions",
};

// Words that carry no identity (club-type tags, articles, years).
const STOP = new Set(["fc", "afc", "cf", "sc", "ac", "as", "cd", "rc", "ud", "ca", "ec", "cr", "fk", "sk", "club", "clube", "de", "da", "do", "del", "di", "the", "and", "e", "1", "1899", "07", "04", "05", "09", "1904", "balompie", "futbol", "calcio"]);
// Same club, different spelling.
const FOLD: Record<string, string> = { milano: "milan", internazionale: "inter", munchen: "munich", koln: "cologne", saint: "st", germain: "germain", utd: "united" };

export function nameWords(name: string): Set<string> {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => FOLD[w] ?? w);
  return new Set(words);
}

// One name's words fully inside the other's: "Marseille" in "Olympique de
// Marseille", "Real Sociedad" in "Real Sociedad de Fútbol".
export function sameClub(a: string, b: string): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
}

export interface EspnScoreboardEvent {
  id: string;
  date: string;
  competitions?: { competitors?: { team?: { displayName?: string } }[] }[];
}

const HALF_HOUR_MS = 30 * 60 * 1000;

// Pure, unit-tested: the ESPN event for this fixture, or null.
export function pickEvent(events: EspnScoreboardEvent[], kickoffMs: number, home: string, away: string): EspnScoreboardEvent | null {
  const teams = (e: EspnScoreboardEvent) => (e.competitions?.[0]?.competitors ?? []).map((c) => c.team?.displayName ?? "");
  const hits = (e: EspnScoreboardEvent) => {
    const t = teams(e);
    return { home: t.some((n) => sameClub(n, home)), away: t.some((n) => sameClub(n, away)) };
  };
  const both = events.filter((e) => hits(e).home && hits(e).away);
  if (both.length === 1) return both[0];
  if (both.length > 1) {
    // Two meetings in the window (a replay, a two-legged tie): the nearer kickoff.
    return [...both].sort((a, b) => Math.abs(Date.parse(a.date) - kickoffMs) - Math.abs(Date.parse(b.date) - kickoffMs))[0];
  }
  const close = events.filter((e) => Math.abs(Date.parse(e.date) - kickoffMs) <= HALF_HOUR_MS && (hits(e).home || hits(e).away));
  return close.length === 1 ? close[0] : null;
}

// ESPN's scoreboard days run on US Eastern time, so a late kickoff can sit on
// the previous date: look at the kickoff's UTC day and the day before.
function dateParam(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

export interface SoccerRef {
  path: string;
  id: string;
}

export async function resolveEspnSoccerGame(leagueLabel: string, kickoffIso: string | null, home: string, away: string): Promise<SoccerRef | null> {
  const code = SOCCER_LEAGUE_CODES[leagueLabel];
  const kickoff = kickoffIso ? Date.parse(kickoffIso) : Number.NaN;
  if (!code || Number.isNaN(kickoff)) return null;
  try {
    const days = await Promise.all(
      [kickoff, kickoff - 24 * 60 * 60 * 1000].map(async (ms) => {
        // A finished day never changes; today's can still gain games.
        const settled = Date.now() - ms > 24 * 60 * 60 * 1000;
        const res = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${dateParam(ms)}`, { next: { revalidate: settled ? 3600 : 120 } });
        return res.ok ? (((await res.json()).events ?? []) as EspnScoreboardEvent[]) : [];
      })
    );
    const event = pickEvent(days.flat(), kickoff, home, away);
    return event ? { path: `soccer/${code}`, id: event.id } : null;
  } catch {
    return null;
  }
}
