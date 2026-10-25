// The score panel drawn on photo posts: the status ("FINAL" or the live clock) and league on one line, then the two teams
// with their scores. Same data and same accuracy rules as the reel's strip (reelScore.ts): it is only drawn when the
// story clearly names the one match, and the score comes from our own match rows. Long cricket scores shrink instead of
// wrapping. Plain Node only (Satori), like the poster and the reel.
import type { ReelScore } from "./reelScore";

const ACCENT = "#12a35e";

export function ScoreBand({ score, width }: { score: ReelScore; width: number }) {
  const long = Math.max(score.homeScore.length, score.awayScore.length) > 8;
  const nameSize = long ? 28 : 34;
  const scoreSize = long ? 34 : 48;
  const row = (name: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", color: "white", fontSize: nameSize, fontWeight: 600, maxWidth: width - 220 }}>{name.length > 22 ? name.slice(0, 21) + "…" : name}</div>
      <div style={{ display: "flex", color: "white", fontSize: scoreSize, fontWeight: 700 }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width, padding: "16px 28px 18px 28px", borderRadius: 18, background: "rgba(11,23,18,0.9)", border: "2px solid rgba(255,255,255,0.14)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", color: ACCENT, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{score.label}</div>
        <div style={{ display: "flex", color: "rgba(255,255,255,0.65)", fontSize: 20, fontWeight: 600, textTransform: "uppercase" }}>{score.league.length > 30 ? score.league.slice(0, 29) + "…" : score.league}</div>
      </div>
      {row(score.home, score.homeScore)}
      {row(score.away, score.awayScore)}
    </div>
  );
}
