/**
 * The one standard match shape every score display uses (score cards on
 * /scores, the match header on article pages), built from an Article match
 * row whatever sport or provider it came from. Pure — no DB imports — so the
 * live/final/upcoming rules are unit-tested (scoreboardModel.test.ts).
 */

import { categoryChipStyle } from "../categoryDisplay";
import { matchDataProvider } from "../matchDataSources";
import { cricketLeagueLabel } from "./cricketLabels";

// "paused": a started match in a scheduled break — cricket stumps, lunch,
// tea, innings break, rain. Not shown as LIVE (nothing is happening), but
// still today's game and not over.
// "started": past its start time with no final, but no live data to show —
// the source hasn't sent in-game scores, or its updates have stopped. Shown
// as "In progress" (with the last known score and when it was updated),
// never as LIVE: LIVE is only ever backed by real, recent data.
export type ScoreState = "live" | "paused" | "started" | "final" | "upcoming";

export interface ScoreSide {
  name: string;
  crestUrl: string | null;
  // Display score: "24" or, for cricket, "287/6 (48.2 ov)". null before play.
  score: string | null;
  record: string | null;
  winner: boolean;
}

export interface ScoreMatch {
  id: string;
  slug: string;
  // Top-level sport category ("football", not "football/world-cup").
  sport: string;
  leagueLabel: string;
  state: ScoreState;
  // Live: "Q3 · 8:42", "67'", "Shootout". Paused: "Stumps · Day 1", "Tea".
  clock: string | null;
  // "India need 93 runs from 70 balls", or null.
  note: string | null;
  kickoffAt: string | null;
  venue: string | null;
  broadcast: string | null;
  home: ScoreSide;
  away: ScoreSide;
  // Provider-independent match identity (matchKey.ts), for live overlays.
  matchKey: string | null;
  // Cricket only: past its start time with no scores and no word of a first ball, so "In progress" would be wrong (rain,
  // a late toss). Shown as "Start delayed" (isStartDelayed).
  delayed?: boolean;
  // Where the data comes from ("ESPN", "MLB") and when this match was last
  // updated from it (ISO) — shown so readers can judge how current it is.
  source: string;
  updatedAt: string;
  // Official highlights of a finished match (YouTube), when one is linked.
  highlight?: { youtubeId: string; title: string } | null;
}

export interface MatchRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  sourceName: string;
  /** Set when a superseding provider supplies the score (Article.scoreSource). */
  scoreSource?: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeCrestUrl: string | null;
  awayCrestUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreText: string | null;
  awayScoreText: string | null;
  matchStatus: string | null;
  kickoffAt: Date | null;
  updatedAt: Date;
  venue: string | null;
  seriesLabel: string | null;
  leagueLabel: string | null;
  matchClock: string | null;
  matchNote: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  broadcast: string | null;
  matchKey?: string | null;
}

// Same windows the existing live displays use (liveMatches.ts,
// liveCricket.ts), so every screen agrees on what's live.
// A started game with no final yet counts as live for this long after
// kickoff (all these sports comfortably finish inside it)...
export const LIVE_WINDOW_MS = 5 * 60 * 60 * 1000;
// ...except cricket, which can run for days (Tests): live only while the
// match is still being updated by its source.
export const CRICKET_STALE_MS = 90 * 60 * 1000;
// Other sports: in-game data older than this no longer counts as LIVE.
// In-play rows are rewritten by the live refresh (every few minutes) and
// by every ingestion run (~15 min, a run taking up to ~12), so a gap past
// 30 minutes means the feed for that game has stopped.
export const LIVE_DATA_STALE_MS = 30 * 60 * 1000;

// A started, unfinished game past these windows has gone quiet without a
// final result — shown as neither live nor final (its state is unknown), so
// callers drop it rather than guess.
export function deriveState(row: MatchRow, now: Date): ScoreState | null {
  if (row.matchStatus === "finished") return "final";
  if (!row.kickoffAt) return null;
  if (row.kickoffAt.getTime() > now.getTime()) return "upcoming";
  // LIVE needs real in-game data (a clock or a score) that is recent.
  // Until 2026-09-26 any started game without a final counted as live by
  // the clock alone — MLB (no in-game feed then) showed "LIVE" with no score.
  const hasLiveData =
    Boolean(row.matchClock) || row.homeScore !== null || row.awayScore !== null || Boolean(row.homeScoreText?.trim() || row.awayScoreText?.trim());
  if (row.category.startsWith("cricket")) {
    // A cricket match runs for days: it stays current only while its source
    // keeps updating it, and is LIVE once there are scores (before the
    // first ball — toss, delayed start — it's "In progress").
    if (now.getTime() - row.updatedAt.getTime() > CRICKET_STALE_MS) return null;
    return hasLiveData ? "live" : "started";
  }
  if (hasLiveData && now.getTime() - row.updatedAt.getTime() <= LIVE_DATA_STALE_MS) return "live";
  return now.getTime() - row.kickoffAt.getTime() <= LIVE_WINDOW_MS ? "started" : null;
}

// Cricket breaks, read from CricketData's own status line (matchNote), e.g.
// "Day 1: Stumps - Worcestershire lead by 131 runs" (seen live 2026-09-25
// on a card that still said LIVE after play had stopped for the day).
export function cricketPauseLabel(note: string | null): string | null {
  if (!note) return null;
  const day = note.match(/\bDay (\d+)\b/i)?.[1];
  if (/\bstumps\b/i.test(note)) return day ? `Stumps · Day ${day}` : "Stumps";
  if (/\blunch\b/i.test(note)) return "Lunch";
  if (/\btea\b/i.test(note)) return "Tea";
  if (/\binnings break\b/i.test(note)) return "Innings break";
  if (/\b(rain|bad light|wet outfield)\b|\bdelayed\b|\binterrupted\b/i.test(note)) return "Play delayed";
  return null;
}

// Multi-day (Test / first-class) cricket in play: "Day 2" from the status
// line, so a live Test reads "LIVE · Day 2". null for one-day games.
export function cricketDayLabel(note: string | null): string | null {
  const day = note?.match(/\bDay (\d+)\b/i)?.[1];
  return day ? `Day ${day}` : null;
}

function displayScore(numeric: number | null, text: string | null): string | null {
  if (text && text.trim()) return text.trim();
  return numeric === null || numeric === undefined ? null : String(numeric);
}

// Cricket results are text ("England won by 25 runs"), so the winner comes
// from the note; everything else compares the numeric scores.
function winners(row: MatchRow, state: ScoreState): { home: boolean; away: boolean } {
  if (state !== "final") return { home: false, away: false };
  if (row.homeScore !== null && row.awayScore !== null && !row.category.startsWith("cricket")) {
    return { home: row.homeScore > row.awayScore, away: row.awayScore > row.homeScore };
  }
  const note = (row.matchNote ?? "").toLowerCase();
  const won = (team: string | null) => Boolean(team) && note.startsWith(`${team!.toLowerCase()} won`);
  return { home: won(row.homeTeam), away: won(row.awayTeam) };
}

// Stored league first; rows stored before leagueLabel existed fall back to
// the series, then (cricket) the competition in the match name, then the
// sport itself — never the data provider's name.
function defaultLeague(row: MatchRow): string {
  return (
    row.leagueLabel?.trim() ||
    row.seriesLabel?.trim() ||
    (row.category.startsWith("cricket") ? cricketLeagueLabel(row.title) : undefined) ||
    categoryChipStyle(row.category).label
  );
}

// CricketData rows stored before matchNote existed: their summary starts
// with CricketData's own status line ("Yorkshire won by 185 runs. ...").
function effectiveNote(row: MatchRow): string | null {
  if (row.matchNote) return row.matchNote;
  if (row.sourceName !== "CricketData.org") return null;
  const first = row.summary.split(". ")[0]?.trim();
  return first && first !== row.summary.trim() ? first : null;
}

// How long past the scheduled start a cricket match may go with no scores before it reads as delayed (a T20 starts on the
// dot; the toss is half an hour earlier). ESPN keeps saying "scheduled to begin" through a rain delay, so this is our
// own call (2026-10-17: the India v West Indies decider showed "In progress" through a delay). Pure, unit-tested.
export const START_DELAY_AFTER_MS = 20 * 60 * 1000;
export function isStartDelayed(row: { category: string; kickoffAt: Date | null }, now: Date): boolean {
  return row.category.startsWith("cricket") && row.kickoffAt !== null && now.getTime() - row.kickoffAt.getTime() >= START_DELAY_AFTER_MS;
}

export function toScoreMatch(rawRow: MatchRow, now: Date): ScoreMatch | null {
  const row = { ...rawRow, matchNote: effectiveNote(rawRow) };
  if (!row.homeTeam || !row.awayTeam) return null;
  const derived = deriveState(row, now);
  if (!derived) return null;
  const pause = derived === "live" && row.category.startsWith("cricket") ? cricketPauseLabel(row.matchNote) : null;
  const state: ScoreState = pause ? "paused" : derived;
  const win = winners(row, state);
  const showScore = state !== "upcoming";
  return {
    id: row.id,
    slug: row.slug,
    sport: row.category.split("/")[0],
    leagueLabel: defaultLeague(row),
    state,
    clock:
      state === "paused"
        ? pause
        : state === "live"
          ? row.matchClock ?? (row.category.startsWith("cricket") ? cricketDayLabel(row.matchNote) : null)
          : null,
    note: state === "upcoming" ? null : row.matchNote,
    kickoffAt: row.kickoffAt ? row.kickoffAt.toISOString() : null,
    venue: row.venue,
    broadcast: state === "upcoming" ? row.broadcast : null,
    matchKey: row.matchKey ?? null,
    delayed: state === "started" && isStartDelayed(row, now),
    source: matchDataProvider(row.scoreSource ?? row.sourceName),
    updatedAt: row.updatedAt.toISOString(),
    home: {
      name: row.homeTeam,
      crestUrl: row.homeCrestUrl,
      score: showScore ? displayScore(row.homeScore, row.homeScoreText) : null,
      record: row.homeRecord,
      winner: win.home,
    },
    away: {
      name: row.awayTeam,
      crestUrl: row.awayCrestUrl,
      score: showScore ? displayScore(row.awayScore, row.awayScoreText) : null,
      record: row.awayRecord,
      winner: win.away,
    },
  };
}
