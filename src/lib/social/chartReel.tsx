// A data reel (2026-11-13, prototype): a chart drawn from real match data instead of a photo with text, e.g. the runs of both sides in each match of a
// series, bars growing in and the winner of each match marked. Built only from numbers the match rows already hold (homeScoreText, awayScoreText and the
// result line), never from an estimate. Frames are drawn with Satori (the same as the other reels) and ffmpeg turns them into a vertical MP4. Plain Node
// only. Not wired into posting yet: scripts/previewSeriesChartReel.mts renders a sample for review.
import { ImageResponse } from "next/og";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";
import { generateReelMusic, type ReelMusicStyle } from "./reelMusic";

const execFileAsync = promisify(execFile);
export const W = 1080;
export const H = 1920;
export const GREEN = "#12a35e";
export const BLUE = "#3b82f6";
export const AMBER = "#f59e0b";
export const BG = "#0b1220";

export interface ChartMatch {
  /** Short label under the bars, e.g. "1st ODI" or "Nov 4". */
  label: string;
  a: { runs: number; text: string; won: boolean };
  b: { runs: number; text: string; won: boolean };
  /** One line on how it ended, shown small: "India won by 5 wickets (DLS)". */
  note?: string;
}
export interface ChartReelParams {
  title: string;
  subtitle: string;
  teamA: string;
  teamB: string;
  /** Short codes beside the bars ("IND", "NZ"); the first letters of the names when not given. */
  codeA?: string;
  codeB?: string;
  matches: ChartMatch[];
  footnote?: string;
  musicStyle?: ReelMusicStyle;
}

// The leading number of a score text: "287/6 (48.2 ov)" -> 287, "89" -> 89. Null when there is none.
export function runsOf(scoreText: string): number | null {
  const m = /^\s*(\d{1,3})\b/.exec(scoreText);
  return m ? Number(m[1]) : null;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function Frame({ p, progress }: { p: ChartReelParams; progress: number }): ReactElement {
  const max = Math.max(...p.matches.flatMap((m) => [m.a.runs, m.b.runs]), 1);
  const BAR_AREA = 600; // pixels for the longest bar
  const bar = (team: { runs: number; text: string; won: boolean }, color: string, name: string, delay: number) => {
    const grow = ease(progress * 1.6 - delay);
    const w = Math.max(12, Math.round((team.runs / max) * BAR_AREA * grow));
    return (
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", width: 110, color: "rgba(255,255,255,0.8)", fontSize: 28, fontWeight: 700 }}>{name}</div>
        <div style={{ display: "flex", width: w, height: 54, borderRadius: 10, background: color, opacity: team.won ? 1 : 0.55 }} />
        <div style={{ display: "flex", marginLeft: 16, color: "white", fontSize: 36, fontWeight: 700, opacity: grow > 0.6 ? 1 : 0 }}>{team.text}</div>
        {team.won && <div style={{ display: "flex", marginLeft: 12, color: GREEN, fontSize: 30, fontWeight: 700, opacity: grow > 0.9 ? 1 : 0 }}>WON</div>}
      </div>
    );
  };
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: BG, fontFamily: "Poppins", padding: "90px 60px 120px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700, color: "white" }}>
        <div style={{ display: "flex", width: 10, height: 40, background: GREEN, borderRadius: 3, marginRight: 14 }} />
        <div style={{ display: "flex" }}>Sports Wire</div>
        <div style={{ display: "flex", color: GREEN, marginLeft: 10 }}>Live</div>
      </div>
      <div style={{ display: "flex", marginTop: 60, color: "rgba(255,255,255,0.7)", fontSize: 32, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>{p.subtitle}</div>
      <div style={{ display: "flex", marginTop: 16, color: "white", fontSize: 76, fontWeight: 700, lineHeight: 1.08 }}>{p.title}</div>
      <div style={{ display: "flex", marginTop: 40, alignItems: "center", fontSize: 30, fontWeight: 600 }}>
        <div style={{ display: "flex", width: 26, height: 26, borderRadius: 6, background: BLUE, marginRight: 12 }} />
        <div style={{ display: "flex", color: "white", marginRight: 36 }}>{p.teamA}</div>
        <div style={{ display: "flex", width: 26, height: 26, borderRadius: 6, background: "#f59e0b", marginRight: 12 }} />
        <div style={{ display: "flex", color: "white" }}>{p.teamB}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
        {p.matches.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: 46 }}>
            <div style={{ display: "flex", color: "rgba(255,255,255,0.85)", fontSize: 30, fontWeight: 700, marginBottom: 12 }}>{m.label}</div>
            {bar(m.a, BLUE, p.codeA ?? p.teamA.slice(0, 3).toUpperCase(), i * 0.22)}
            {bar(m.b, "#f59e0b", p.codeB ?? p.teamB.slice(0, 3).toUpperCase(), i * 0.22 + 0.08)}
            {m.note && <div style={{ display: "flex", color: "rgba(255,255,255,0.65)", fontSize: 26, fontWeight: 600, marginTop: 2, opacity: progress > 0.8 ? 1 : 0 }}>{m.note}</div>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      {p.footnote && <div style={{ display: "flex", color: "rgba(255,255,255,0.55)", fontSize: 24, fontWeight: 600 }}>{p.footnote}</div>}
    </div>
  );
}

function EndFrame(): ReactElement {
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Poppins" }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 60, fontWeight: 700, color: "white" }}>
        <div style={{ display: "flex", width: 15, height: 66, background: GREEN, borderRadius: 3, marginRight: 14 }} />
        <div style={{ display: "flex" }}>Sports Wire</div>
        <div style={{ display: "flex", color: GREEN, marginLeft: 10 }}>Live</div>
      </div>
      <div style={{ display: "flex", width: 160, height: 10, borderRadius: 5, background: GREEN, margin: "56px 0" }} />
      <div style={{ display: "flex", color: "white", fontSize: 76, fontWeight: 700 }}>What's your take?</div>
      <div style={{ display: "flex", color: "rgba(255,255,255,0.85)", fontSize: 44, fontWeight: 600, marginTop: 14 }}>Tell us in the comments</div>
      <div style={{ display: "flex", color: "rgba(255,255,255,0.7)", fontSize: 34, fontWeight: 600, marginTop: 80 }}>Follow for daily sports news</div>
    </div>
  );
}

export async function renderChartReel(p: ChartReelParams, opts: { growSeconds?: number; holdSeconds?: number; fps?: number } = {}): Promise<Buffer> {
  return renderAnimated((progress) => <Frame p={p} progress={progress} />, p.musicStyle ?? "cinematic", opts);
}

// Any animated chart: `node(progress)` draws the frame at progress 0..1 while the bars grow, the last frame is held, then the end card, with generated music.
export async function renderAnimated(node: (progress: number) => ReactElement, musicStyle: ReelMusicStyle, opts: { growSeconds?: number; holdSeconds?: number; fps?: number } = {}): Promise<Buffer> {
  const fps = opts.fps ?? 15;
  const grow = opts.growSeconds ?? 2.6;
  const hold = opts.holdSeconds ?? 4.4;
  const frames = Math.round(grow * fps);
  const fontsDir = join(process.cwd(), "src/assets/fonts");
  const [bold, semibold] = await Promise.all([readFile(join(fontsDir, "Poppins-Bold.ttf")), readFile(join(fontsDir, "Poppins-SemiBold.ttf"))]);
  const fonts = [
    { name: "Poppins", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Poppins", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
  const ffmpegPath = process.env.FFMPEG_PATH || ((await import("ffmpeg-static")).default as unknown as string | null);
  if (!ffmpegPath) throw new Error("ffmpeg not found");
  const dir = await mkdtemp(join(tmpdir(), "chart-reel-"));
  try {
    for (let i = 0; i <= frames; i++) {
      const png = Buffer.from(await new ImageResponse(node(i / frames), { width: W, height: H, fonts }).arrayBuffer());
      await writeFile(join(dir, `f${String(i).padStart(4, "0")}.png`), png);
    }
    await writeFile(join(dir, "end.png"), Buffer.from(await new ImageResponse(<EndFrame />, { width: W, height: H, fonts }).arrayBuffer()));
    const END = 1.9;
    const total = grow + hold + END;
    await writeFile(join(dir, "music.wav"), generateReelMusic(total, musicStyle));
    const out = join(dir, "reel.mp4");
    await execFileAsync(ffmpegPath, [
      "-y", "-framerate", String(fps), "-i", join(dir, "f%04d.png"), "-loop", "1", "-framerate", "30", "-t", String(END), "-i", join(dir, "end.png"), "-i", join(dir, "music.wav"),
      "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${hold},fps=30,format=yuv420p[a];[1:v]fps=30,format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[v]`,
      "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k",
      "-af", `atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,loudnorm=I=-16:TP=-1.5`,
      "-t", total.toFixed(2), "-movflags", "+faststart", out,
    ], { maxBuffer: 32 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
