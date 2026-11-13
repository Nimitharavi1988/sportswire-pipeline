// The frames of a match stats reel (matchStats.ts): both teams' names and score, then one two-sided bar per stat that grows in from the middle.
// Plain Node only; see chartReel.tsx for the video pipeline.
import type { ReactElement } from "react";
import { AMBER, BG, BLUE, GREEN, H, W, renderAnimated } from "./chartReel";
import type { StatsReel } from "./matchStats";

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function StatsFrame({ r, progress }: { r: StatsReel; progress: number }): ReactElement {
  const score = r.score;
  const HALF = 440; // pixels for a full half of the bar
  const row = (b: StatsReel["bars"][number], i: number) => {
    const grow = ease(progress * 1.5 - i * 0.12);
    const total = b.home + b.away;
    const hw = Math.round((b.home / total) * HALF * 2 * grow);
    const aw = Math.round((b.away / total) * HALF * 2 * grow);
    const homeBetter = b.lowerIsBetter ? b.home < b.away : b.home > b.away;
    const awayBetter = b.lowerIsBetter ? b.away < b.home : b.away > b.home;
    return (
      <div key={b.name} style={{ display: "flex", flexDirection: "column", marginBottom: 54 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", color: "white", fontSize: 48, fontWeight: 700, opacity: grow > 0.5 ? 1 : 0 }}>{b.homeText}</div>
          <div style={{ display: "flex", color: "rgba(255,255,255,0.8)", fontSize: 32, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>{b.name}</div>
          <div style={{ display: "flex", color: "white", fontSize: 48, fontWeight: 700, opacity: grow > 0.5 ? 1 : 0 }}>{b.awayText}</div>
        </div>
        <div style={{ display: "flex", width: HALF * 2, height: 34, background: "rgba(255,255,255,0.08)", borderRadius: 17, overflow: "hidden", justifyContent: "space-between" }}>
          <div style={{ display: "flex", width: hw, height: 34, background: BLUE, opacity: homeBetter ? 1 : 0.55 }} />
          <div style={{ display: "flex", width: aw, height: 34, background: AMBER, opacity: awayBetter ? 1 : 0.55 }} />
        </div>
      </div>
    );
  };
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: BG, fontFamily: "Poppins", padding: "90px 100px 120px 100px" }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700, color: "white" }}>
        <div style={{ display: "flex", width: 10, height: 40, background: GREEN, borderRadius: 3, marginRight: 14 }} />
        <div style={{ display: "flex" }}>Sports Wire</div>
        <div style={{ display: "flex", color: GREEN, marginLeft: 10 }}>Live</div>
      </div>
      <div style={{ display: "flex", marginTop: 56, color: "rgba(255,255,255,0.7)", fontSize: 32, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>{r.subtitle} · The match in numbers</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 44 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 330 }}>
          <div style={{ display: "flex", width: 90, height: 12, background: BLUE, borderRadius: 6, marginBottom: 16 }} />
          <div style={{ display: "flex", color: "white", fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{r.home}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", width: 300, color: "white", fontSize: 84, fontWeight: 700 }}>
          <div style={{ display: "flex" }}>{score[0]}</div>
          <div style={{ display: "flex", margin: "0 8px" }}>–</div>
          <div style={{ display: "flex" }}>{score[1]}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 330, alignItems: "flex-end" }}>
          <div style={{ display: "flex", width: 90, height: 12, background: AMBER, borderRadius: 6, marginBottom: 16 }} />
          <div style={{ display: "flex", color: "white", fontSize: 40, fontWeight: 700, lineHeight: 1.1, textAlign: "right" }}>{r.away}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 90 }}>{r.bars.map(row)}</div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", color: "rgba(255,255,255,0.55)", fontSize: 24, fontWeight: 600 }}>Data: {r.source}</div>
    </div>
  );
}

export async function renderStatsReel(r: StatsReel): Promise<Buffer> {
  return renderAnimated((progress) => <StatsFrame r={r} progress={progress} />, "drive");
}
