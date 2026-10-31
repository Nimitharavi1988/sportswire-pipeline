// Spoken reels (pilot, 2026-10-31). Platforms transcribe a reel's audio, and ours had music only, so nothing was said aloud: no
// sport, no name. A topic Page's reel can carry a voice that reads the story's description (its first sentence, with the sport said
// first when the sentence does not name it). Free offline voice: Kokoro (Apache 2.0), a male voice picked per story from VOICES.
// After the first listening test (2026-10-31): Piper was flat, women's voices did not suit sport, hook + fact was the wrong text and
// names were mispronounced, so now it reads the description, men's voices only, and names go through speechNames.ts.
// Off unless VOICEOVER_PAGES lists the Page; on for half the stories of a listed Page (by story id) so the same Page compares
// voiced and silent reels. Any failure returns null and the reel goes out silent. Never used for the main Page.
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { shortReelCaption } from "./captionVariant";
import { sportKeywordFor, withSportKeyword } from "./reelKeyword";
import { applySpeechNames } from "./speechNames";

const execFileAsync = promisify(execFile);

// Male voices that passed the listening test; one is picked per story. British ones use British pronunciation.
export const VOICES = ["bm_george", "bm_fable", "bm_lewis", "bm_daniel", "am_michael", "am_adam"] as const;
export function pickVoice(articleId: string): string {
  let h = 11;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VOICES[(h >>> 3) % VOICES.length];
}

// The voice must end before the end card: the reel is about 11.8 s and the voice starts a beat in.
export const MAX_VOICE_SECONDS = 10.2;

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

// Text as it should be spoken: no emoji or symbols, "vs" as "versus", codes spelled out, ending in a full stop. Names are NOT
// respelled here (see forVoice), so this stays the real spelling.
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

// The sport as it is said first. A voice spells an acronym out letter by letter with gaps ("M... M... A"), so MMA is said in full.
const SPOKEN_LEADS: Record<string, string> = { mma: "Mixed martial arts" };
const spokenLead = (category: string) => SPOKEN_LEADS[category.split("/")[0]] ?? sportKeywordFor(category);

// What is sent to the voice: the spoken text with each hard name respelled for the way it sounds.
export const forVoice = (spoken: string) => applySpeechNames(spoken);

// The story's description read aloud: its first sentence (cut at a clause break if long), with "Cricket news." first when that
// sentence never names the sport. Without a description, the on-screen hook. At most about 30 words.
export function buildVoiceScript(content: { hook: string }, category: string, description?: string | null): string {
  const lead = spokenLead(category);
  const base = description?.trim() ? shortReelCaption(description, 26) : content.hook;
  const sentence = spokenText(base);
  const needsLead = lead && withSportKeyword(sentence, category) !== sentence;
  return forVoice([needsLead ? `${lead} news.` : "", sentence].filter(Boolean).join(" "));
}

// The shorter text used when the description will not fit the reel: the sport and the hook.
export function buildShortScript(content: { hook: string }, category: string): string {
  const lead = spokenLead(category);
  return forVoice([lead ? `${lead} news.` : "", spokenText(content.hook)].filter(Boolean).join(" "));
}

// Length in seconds of a PCM WAV file (what Kokoro writes), or 0 when it is not one.
export function wavSeconds(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return 0;
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24);
  const bits = wav.readUInt16LE(34);
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") return rate && channels && bits ? Math.min(size, wav.length - off - 8) / (rate * channels * (bits / 8)) : 0;
    off += 8 + size + (size % 2);
  }
  return 0;
}

// Runs Kokoro (KOKORO_MODEL and KOKORO_VOICES = paths to its ONNX model and voice file) in "natural" mode and returns the WAV path,
// or null when anything is missing or fails. Natural mode (chosen after the 2026-10-31 listening test): the text is spoken phrase by
// phrase, each phrase with its own small speed, pitch and loudness variation, and the pauses between them are uneven (shorter after a
// comma, longer after a full stop, each randomised), so it does not sound like one flat read. The variation is seeded from the story,
// so a story always sounds the same.
const KOKORO_PY = `import sys, random, re
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
model, voices, voice, lang, base, out, seed, text = sys.argv[1:9]
base = float(base)
rnd = random.Random(int(seed))
k = Kokoro(model, voices)

def trim(s, sr, thr=0.012, pad=0.03):
    idx = np.where(np.abs(s) > thr)[0]
    if len(idx) == 0:
        return s
    return s[max(0, idx[0] - int(sr * pad)):min(len(s), idx[-1] + int(sr * pad))]

GAPS = {",": (0.12, 0.26), ";": (0.18, 0.30), ":": (0.18, 0.30), ".": (0.32, 0.52), "!": (0.30, 0.50), "?": (0.34, 0.54)}
parts = [p.strip() for p in re.findall(r"[^.,;:!?]+[.,;:!?]?", text) if p.strip()]
chunks = []
sr = 24000
for i, p in enumerate(parts):
    end = p[-1] if p[-1] in GAPS else "."
    sp = base * rnd.uniform(0.96, 1.06)
    if i == 0:
        sp *= 0.96
    if end in ".!?":
        sp *= 0.95
    pitch = 1 + rnd.uniform(-0.03, 0.04)
    s, sr = k.create(p, voice=voice, speed=sp / pitch, lang=lang)
    n = int(len(s) / pitch)
    s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s)
    s = trim(s, sr) * (10 ** (rnd.uniform(-1.2, 1.2) / 20))
    lo, hi = GAPS[end]
    chunks += [s, np.zeros(int(sr * rnd.uniform(lo, hi)))]
sf.write(out, np.concatenate(chunks[:-1]), sr)
`;

function seedFor(text: string): number {
  let h = 5381;
  for (const c of text) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}

export async function synthesizeVoice(text: string, voice: string, speed = 1.05, seed = seedFor(text), env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const model = env.KOKORO_MODEL;
  const voices = env.KOKORO_VOICES;
  if (!model || !voices || !text.trim()) return null;
  try {
    const out = join(await mkdtemp(join(tmpdir(), "voice-")), "voice.wav");
    const lang = voice.startsWith("b") ? "en-gb" : "en-us";
    await execFileAsync(env.KOKORO_PYTHON ?? "python3", ["-c", KOKORO_PY, model, voices, voice, lang, String(speed), out, String(seed), text], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    return out;
  } catch (err) {
    console.warn("[voiceover] synthesis failed, reel goes out silent:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}

// A voice track that fits the reel: the description at its natural pace, then faster, then the short sport-and-hook text.
export async function makeVoice(script: string, shortScript: string, voice: string, seed?: number): Promise<{ path: string; seconds: number; text: string } | null> {
  const tries: [string, number][] = [[script, 1.05], [script, 1.2], [shortScript, 1.1]];
  for (const [text, speed] of tries) {
    const path = await synthesizeVoice(text, voice, speed, seed);
    if (!path) return null;
    const seconds = wavSeconds(await readFile(path));
    if (seconds > 0 && seconds <= MAX_VOICE_SECONDS) return { path, seconds, text };
    console.log(`[voiceover] ${seconds.toFixed(1)} s is too long at speed ${speed}; trying a shorter take`);
  }
  return null;
}
