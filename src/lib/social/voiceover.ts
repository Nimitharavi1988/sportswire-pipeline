// Spoken reels (pilot, 2026-10-31). Platforms transcribe a reel's audio, and ours had music only, so nothing was said aloud: no
// sport, no name. A topic Page's reel can now carry a short voice that opens with the sport ("Cricket news. ...") and reads the
// hook and the first fact, the same checked text that is on screen. Free offline voice: Piper with a public-domain voice
// (LJSpeech). Off unless VOICEOVER_PAGES lists the Page; on for half the stories of a listed Page (by story id) so the same Page
// compares voiced and silent reels. Any failure returns null and the reel goes out silent. Never used for the main Page.
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sportKeywordFor } from "./reelKeyword";

const execFileAsync = promisify(execFile);

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

// Runs Piper (PIPER_MODEL = path to the voice's .onnx) and returns the WAV path, or null when anything is missing or fails.
export async function synthesizeVoice(text: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const model = env.PIPER_MODEL;
  if (!model || !text.trim()) return null;
  try {
    const out = join(await mkdtemp(join(tmpdir(), "voice-")), "voice.wav");
    await execFileAsync(env.PIPER_PYTHON ?? "python3", ["-m", "piper", "-m", model, "-f", out, "--", text], { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    return out;
  } catch (err) {
    console.warn("[voiceover] synthesis failed, reel goes out silent:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}
