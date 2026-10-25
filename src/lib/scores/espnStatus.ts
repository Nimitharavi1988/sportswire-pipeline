/**
 * Shared reading of ESPN's public scoreboard JSON (site.api.espn.com) for
 * every ESPN-sourced sport — NFL, NBA, NHL, ESPN football (soccer) leagues,
 * college volleyball. One place turns ESPN's status/period/clock into the
 * standard scoreboard fields (matchClock, records, broadcast) instead of
 * each fetcher (nflData.ts, nbaData.ts, ...) interpreting them its own way.
 *
 * Field shapes checked against the live API on 2026-09-25: status.period +
 * status.displayClock ("8:42"; soccer "67'"), status.type.name
 * ("STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_FINAL", ...),
 * competitor.records[0].summary ("2-0"), competition.broadcasts[].names.
 */

export type EspnState = "pre" | "in" | "post";

export interface EspnStatus {
  period?: number;
  displayClock?: string;
  type?: { state?: string; name?: string; shortDetail?: string; detail?: string; completed?: boolean };
}

export interface EspnCompetitorLike {
  score?: string;
  records?: { type?: string; summary?: string }[];
}

export interface EspnCompetitionLike {
  broadcasts?: { names?: string[] }[];
}

export type EspnClockStyle = "quarters" | "hockey" | "soccer" | "sets";

export function espnState(status: EspnStatus | undefined): EspnState | null {
  const state = status?.type?.state;
  return state === "pre" || state === "in" || state === "post" ? state : null;
}

// Running or final score; a missing/non-numeric value is left unset rather
// than stored as 0 or NaN.
export function espnScore(competitor: EspnCompetitorLike): number | undefined {
  if (competitor.score === undefined || competitor.score.trim() === "") return undefined;
  const n = Number(competitor.score);
  return Number.isFinite(n) ? n : undefined;
}

// Overall win-loss(-tie) record, e.g. "2-0" — only when ESPN sends one.
export function espnRecord(competitor: EspnCompetitorLike): string | undefined {
  const records = competitor.records ?? [];
  const overall = records.find((r) => r.type === "total") ?? records[0];
  const summary = overall?.summary?.trim();
  return summary ? summary : undefined;
}

// First national TV/stream name, e.g. "FOX".
export function espnBroadcast(competition: EspnCompetitionLike | undefined): string | undefined {
  for (const b of competition?.broadcasts ?? []) {
    const name = b.names?.find((n) => n.trim());
    if (name) return name.trim();
  }
  return undefined;
}

function overtimeLabel(overtimeNumber: number): string {
  return overtimeNumber <= 1 ? "OT" : `${overtimeNumber}OT`;
}

// Live clock text for an in-progress game; null for anything not in
// progress, so the stored clock is cleared at the final whistle.
export function espnLiveClock(style: EspnClockStyle, status: EspnStatus | undefined): string | null {
  if (espnState(status) !== "in" || !status) return null;
  const name = status.type?.name ?? "";
  const period = status.period ?? 0;
  const clock = status.displayClock?.trim();

  if (name === "STATUS_HALFTIME") return style === "soccer" ? "HT" : "Halftime";

  if (style === "soccer") return clock && clock !== "0'" ? clock : status.type?.shortDetail ?? "Live";

  if (style === "sets") return period > 0 ? `Set ${period}` : status.type?.shortDetail ?? "Live";

  const regulation = style === "hockey" ? 3 : 4;
  // Regular-season/preseason NHL games go to a shootout after one OT, and
  // ESPN reports it as period 5 with shortDetail "In SO" (confirmed live
  // 2026-09-25, CGY @ SEA) — not a second overtime. Playoff overtimes have
  // no shootout, so the "SO" check (not the period number) decides.
  if (style === "hockey" && period > regulation && /\bSO\b/.test(status.type?.shortDetail ?? "")) return "Shootout";
  const periodLabel =
    period <= 0
      ? null
      : period > regulation
        ? overtimeLabel(period - regulation)
        : style === "hockey"
          ? `P${period}`
          : `Q${period}`;

  if (name === "STATUS_END_PERIOD") return periodLabel ? `End of ${periodLabel}` : status.type?.shortDetail ?? "Live";
  if (periodLabel && clock) return `${periodLabel} · ${clock}`;
  return periodLabel ?? status.type?.shortDetail ?? "Live";
}
