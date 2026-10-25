import type { RawMatchItem } from "./footballData";
import { buildMatchKey, slugifyTeam } from "../scores/matchKey";

// A knockout fixture is stored while its teams are still "TBA"/"TBC", and
// such placeholders are rejected (a "TBA vs TBA" page is not worth showing).
// When the source later names the real teams — the Asian Games semi-finals,
// 2026-09-29/30 — the row must follow: before this, a refresh updated the
// score and match key but never the teams, title or status, so India v Sri
// Lanka stayed "TBA vs TBA" and rejected, and was missing from the scoreboard
// while it was being played.
const PLACEHOLDER_TEAM = /^(tba|tbc|tbd)$/i;
// An undecided playoff slot named by its candidates: MLB's Division Series
// listed "SD/CHC", "ATL/PHI", "NYY/BOS" until the Wild Card round was over
// (2026-10-02) and the rows kept those names, and a Saturday start time
// that was a placeholder too, after the teams were known.
const UNDECIDED_SLOT = /^[A-Z]{2,4}(\/[A-Z]{2,4})+$/;
const isPlaceholderName = (n: string | null | undefined): boolean => Boolean(n) && (PLACEHOLDER_TEAM.test(n!.trim()) || UNDECIDED_SLOT.test(n!.trim()));

export interface ExistingMatchRow {
  homeTeam: string | null;
  awayTeam: string | null;
  status: string | null;
  rejectionReason: string | null;
  // The stored start time (see rescheduledKickoff).
  kickoffAt?: Date | null;
}

// A match can move: the Asian Games semi-final India v Sri Lanka was stored
// for 05:00 UTC and ESPN later gave 04:30, but the stored start was never
// touched, so a game already being played showed as "upcoming" until the old
// time passed. While a match has not finished, the source's start time wins
// when it differs by more than a couple of minutes (feeds jitter by seconds).
// Finished matches keep theirs: a result's date should not wander.
const RESCHEDULE_THRESHOLD_MS = 2 * 60 * 1000;
export function rescheduledKickoff(existing: ExistingMatchRow | undefined, item: RawMatchItem, existingMatchStatus: string | null): Date | null {
  if (!existing?.kickoffAt || !item.kickoffAt || existingMatchStatus === "finished" || item.matchStatus === "finished") return null;
  return Math.abs(item.kickoffAt.getTime() - existing.kickoffAt.getTime()) > RESCHEDULE_THRESHOLD_MS ? item.kickoffAt : null;
}

// Pure, unit-tested. null unless the stored row has a placeholder team and the
// source now reports two real ones.
export function placeholderResolution(existing: ExistingMatchRow | undefined, item: RawMatchItem, now: Date) {
  if (!existing) return null;
  if (!isPlaceholderName(existing.homeTeam) && !isPlaceholderName(existing.awayTeam)) return null;
  if (!item.homeTeam || !item.awayTeam || isPlaceholderName(item.homeTeam) || isPlaceholderName(item.awayTeam)) return null;
  // Only a row rejected for being a placeholder is reopened (for the normal
  // auto-approve step to publish); its page was never public, so it can take a
  // slug that names the real teams. Any other status is left alone.
  const reopen = existing.status === "rejected" && /placeholder/i.test(existing.rejectionReason ?? "");
  return {
    homeTeam: item.homeTeam,
    awayTeam: item.awayTeam,
    homeCrestUrl: item.homeCrestUrl,
    awayCrestUrl: item.awayCrestUrl,
    title: item.title,
    summary: item.summary,
    body: item.body,
    ...(reopen
      ? { status: "pending_review" as const, rejectionReason: null, slug: `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${now.getTime()}` }
      : {}),
  };
}

// The column values written when a match-data source reports on a game we
// already have a row for. Shared by full ingestion (runIngest.ts) and the
// fast live-score refresh (scores/liveRefresh.ts) so the two can never
// disagree about what a refresh writes.
//
// Score/status/clock refresh on every poll. title/summary/body only change
// at the scheduled -> finished transition (a live game keeps its preview
// text; its score lives in the score fields), except CricketData.org, whose
// summary/body carry the live situation and so refresh every poll.
export function matchRefreshValues(item: RawMatchItem, existingMatchStatus: string | null, now: Date = new Date(), existing?: ExistingMatchRow) {
  const justFinished = existingMatchStatus !== "finished" && item.matchStatus === "finished";
  const isCricketData = item.sourceName === "CricketData.org";
  // A scheduled match's page date is its start time for the sources that
  // set publishedAt = kickoff, so it moves with it (otherwise the match stays
  // filed under, and sorted by, the old date).
  const moved = rescheduledKickoff(existing, item, existingMatchStatus);
  return {
    matchStatus: item.matchStatus,
    homeScore: item.homeScore,
    awayScore: item.awayScore,
    homeScoreText: item.homeScoreText,
    awayScoreText: item.awayScoreText,
    venue: item.venue,
    // Standard scoreboard fields (src/lib/scores/). undefined = source
    // doesn't provide it (Drizzle leaves the column alone); null = clear it.
    leagueLabel: item.leagueLabel,
    matchClock: item.matchClock,
    matchNote: item.matchNote,
    homeRecord: item.homeRecord,
    awayRecord: item.awayRecord,
    broadcast: item.broadcast,
    matchKey: buildMatchKey(item.category, item.kickoffAt, item.homeTeam, item.awayTeam),
    ...(isCricketData || justFinished ? { summary: item.summary, body: item.body } : {}),
    ...(justFinished && !isCricketData ? { title: item.title } : {}),
    ...placeholderResolution(existing, item, now),
    ...(moved ? { kickoffAt: moved, ...(item.publishedAt.getTime() === moved.getTime() ? { publishedAt: moved } : {}) } : {}),
    updatedAt: now,
  };
}

// The values written when a higher-priority provider (matchDataSources.ts
// `supersedes`) reports on a match another provider stored: its score,
// status and live text, with the row's identity (title, teams, league,
// matchKey) left to the owner. Scores are mapped by team, since providers
// can list home/away the other way round.
export function supersedingRefreshValues(
  item: RawMatchItem,
  row: { homeTeam: string | null },
  now: Date = new Date()
) {
  const sameOrder = !row.homeTeam || !item.homeTeam || slugifyTeam(row.homeTeam) === slugifyTeam(item.homeTeam);
  return {
    matchStatus: item.matchStatus,
    homeScore: sameOrder ? item.homeScore : item.awayScore,
    awayScore: sameOrder ? item.awayScore : item.homeScore,
    homeScoreText: (sameOrder ? item.homeScoreText : item.awayScoreText) ?? null,
    awayScoreText: (sameOrder ? item.awayScoreText : item.homeScoreText) ?? null,
    matchClock: item.matchClock,
    matchNote: item.matchNote,
    summary: item.summary,
    body: item.body,
    scoreSource: item.sourceName,
    updatedAt: now,
  };
}
