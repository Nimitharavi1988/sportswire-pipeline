// Spoken reels (pilot, 2026-10-31). Platforms transcribe a reel's audio, and ours had music only, so nothing was said aloud: no
// sport, no name. A topic Page's reel can now carry a short voice that opens with the sport ("Cricket news. ...") and reads the
// hook and the first fact, the same checked text that is on screen. Free offline voice: Kokoro (Apache 2.0), a soft voice picked
// per story from SOFT_VOICES (Piper's flat delivery was rejected, 2026-10-31). Off unless VOICEOVER_PAGES lists the Page; on for half the stories of a listed Page (by story id) so the same Page
// compares voiced and silent reels. Any failure returns null and the reel goes out silent. Never used for the main Page.
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sportKeywordFor } from "./reelKeyword";

const execFileAsync = promisify(execFile);

// The soft voices that passed the listening test; one is picked per story. British ones use British pronunciation.
export const SOFT_VOICES = ["af_nicole", "af_sky", "af_heart", "bf_isabella", "bf_lily", "bf_alice", "bf_emma"] as const;
export function pickVoice(articleId: string): string {
  let h = 11;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SOFT_VOICES[(h >>> 3) % SOFT_VOICES.length];
}

// "INDvNZ" is read letter by letter by a voice, so the cricket codes are spelled out; "XI" is "eleven".
const NATION_NAMES: Record<string, string> = { IND: "India", PAK: "Pakistan", AUS: "Australia", ENG: "England", SA: "South Africa", NZ: "New Zealand", WI: "West Indies", SL: "Sri Lanka", BAN: "Bangladesh", AFG: "Afghanistan", ZIM: "Zimbabwe", IRE: "Ireland" };

// Topic Page keys with the voice switched on (comma separated), e.g. "cricketlive". Empty = off everywhere.
export function voiceoverPages(env: Record<string, string | undefined> = process.env): string[] {
  return (env.VOICEOVER_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Half the stories (by id) of a listed Page get the voice, the rest stay silent as the comparison.
export function voiceoverFor(topicKey: string | undefined, articleId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!topicKey || !voiceoverPages(env).includes(topicKey)) return false;
  let h = 7;
  for (const c of articleId) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0;
}

// Text as it should be spoken: no emoji or symbols, "vs" as "versus", one sentence per piece, ending in a full stop.
export function spokenText(raw: string): string {
  const cleaned = raw
    .replace(/\b([A-Z]{2,3})v(?:s)?([A-Z]{2,3})\b/g, (m, a: string, b: string) => (NATION_NAMES[a] && NATION_NAMES[b] ? `${NATION_NAMES[a]} versus ${NATION_NAMES[b]}` : m))
    .replace(/\bXI\b/g, "eleven")
    .replace(/[^\p{L}\p{N}\s.,'’:;!?%&/\-–—]/gu, " ")
    .replace(/\bvs?\.?(?=\s)/gi, "versus")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,;:]+$/, "");
  return cleaned && !/[.!?]$/.test(cleaned) ? cleaned + "." : cleaned;
}

// "Cricket news. <hook> <first fact>" — the sport first, then only text that is already on screen. At most about 35 words.
export function buildVoiceScript(content: { hook: string; rows: { label: string; value: string }[] }, category: string): string {
  const lead = sportKeywordFor(category);
  const parts = [lead ? `${lead} news.` : "", spokenText(content.hook)];
  const row = content.rows[0];
  if (row) parts.push(spokenText(`${row.label}, ${row.value}`));
  const words = parts.filter(Boolean).join(" ").split(" ");
  const text = words.slice(0, 35).join(" ");
  return words.length > 35 ? text.replace(/[\s,;:]+$/, "") + "." : text;
}

// Runs Kokoro (KOKORO_MODEL and KOKORO_VOICES = paths to its ONNX model and voice file) and returns the WAV path, or null when
// anything is missing or fails.
const KOKORO_PY = `import sys, soundfile as sf
from kokoro_onnx import Kokoro
model, voices, voice, lang, speed, out, text = sys.argv[1:8]
k = Kokoro(model, voices)
s, sr = k.create(text, voice=voice, speed=float(speed), lang=lang)
sf.write(out, s, sr)
`;

export async function synthesizeVoice(text: string, voice: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const model = env.KOKORO_MODEL;
  const voices = env.KOKORO_VOICES;
  if (!model || !voices || !text.trim()) return null;
  try {
    const out = join(await mkdtemp(join(tmpdir(), "voice-")), "voice.wav");
    const lang = voice.startsWith("b") ? "en-gb" : "en-us";
    await execFileAsync(env.KOKORO_PYTHON ?? "python3", ["-c", KOKORO_PY, model, voices, voice, lang, "1.0", out, text], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return out;
  } catch (err) {
    console.warn("[voiceover] synthesis failed, reel goes out silent:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}
