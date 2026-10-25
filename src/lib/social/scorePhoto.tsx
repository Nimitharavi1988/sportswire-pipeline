// A square photo with the score panel on it, for the Facebook photo posts (facebookDestinations.ts style "photo-question").
// Plain Node only: next/og's ImageResponse (Satori + WASM) cannot run in the deployed Worker, so this is imported only by
// the posting job (topicPosting.ts), never by anything a route renders.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadHeroImageDataUri } from "./instagramPoster";
import { ScoreBand } from "./scoreBand";
import type { ReelScore } from "./reelScore";

const SIZE = 1080;

export async function renderPhotoWithScore(params: { heroImageUrl: string; score: ReelScore }): Promise<Buffer> {
  const fontsDir = join(process.cwd(), "src/assets/fonts");
  const [bold, semibold] = await Promise.all([readFile(join(fontsDir, "Poppins-Bold.ttf")), readFile(join(fontsDir, "Poppins-SemiBold.ttf"))]);
  const bg = await loadHeroImageDataUri(params.heroImageUrl);
  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Poppins", background: "#0b1712" }}>
        <img src={bg} width={SIZE} height={SIZE} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover", objectPosition: "center" }} />
        <div style={{ position: "absolute", left: 0, bottom: 0, width: SIZE, height: 380, display: "flex", background: "linear-gradient(180deg, rgba(11,23,18,0) 0%, rgba(11,23,18,0.75) 100%)" }} />
        <div style={{ position: "absolute", left: 44, bottom: 44, display: "flex" }}>
          <ScoreBand score={params.score} width={620} />
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      fonts: [
        { name: "Poppins", data: bold, weight: 700, style: "normal" },
        { name: "Poppins", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
  return Buffer.from(await image.arrayBuffer());
}
