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
import { readableDescription } from "./sentences";
import { sportKeywordFor, withSportKeyword } from "./reelKeyword";
import { applySpeechNames } from "./speechNames";
import { speakScores } from "./speechScores";

const execFileAsync = promisify(execFile);

// Male voices that passed the listening test; one is picked per story. British ones use British pronunciation.
export const VOICES = ["bm_george", "bm_fable", "bm_lewis", "bm_daniel", "am_michael", "am_adam"] as const;
// Spanish (2026-11-10): Kokoro's Spanish men's voices. A speech-to-text check on the generated audio heard them almost word for word (0 to 13%
// word error); a Spanish speaker has not listened, so the Spanish Page starts at a small share ("es:4" in VOICEOVER_PAGES = 1 story in 4).
export const VOICES_ES = ["em_alex", "em_santa"] as const;
export function pickVoice(articleId: string, language: "en" | "es" = "en"): string {
  let h = 11;
  for (const c of articleId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const list = language === "es" ? VOICES_ES : VOICES;
  return list[(h >>> 3) % list.length];
}
// Kokoro's language code for a voice: "e..." voices are Spanish, "b..." British English, the rest American.
export const voiceLang = (voice: string) => (voice.startsWith("e") ? "es" : voice.startsWith("b") ? "en-gb" : "en-us");

// The voice must end before the end card: the reel is about 11.8 s and the voice starts a beat in.
export const MAX_VOICE_SECONDS = 10.2;

// "INDvNZ" is read letter by letter by a voice, so the cricket codes are spelled out; "XI" is "eleven".
const NATION_NAMES: Record<string, string> = { IND: "India", PAK: "Pakistan", AUS: "Australia", ENG: "England", SA: "South Africa", NZ: "New Zealand", WI: "West Indies", SL: "Sri Lanka", BAN: "Bangladesh", AFG: "Afghanistan", ZIM: "Zimbabwe", IRE: "Ireland" };

// Topic Page keys with the voice switched on (comma separated), e.g. "cricketlive". Empty = off everywhere.
// An entry may carry a share: "es:4" voices 1 story in 4 of that Page (default 2 = half), used for the Spanish Page until someone has listened.
const entries = (env: Record<string, string | undefined>) => (env.VOICEOVER_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export function voiceoverPages(env: Record<string, string | undefined> = process.env): string[] {
  return entries(env).map((e) => e.split(":")[0]);
}
export function voiceShare(key: string, env: Record<string, string | undefined> = process.env): number {
  const e = entries(env).find((x) => x.split(":")[0] === key);
  const n = Number(e?.split(":")[1]);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

// The YouTube channels (2026-11-07): the key "youtube" in VOICEOVER_PAGES gives every English Short the commentary voice, also the ones
// made from main Page stories; "youtube-es" does the same for the Spanish channel (optionally with a share, "youtube-es:4"). Only the
// Short's own render has it; the main Page's and main Instagram's files stay as they are.
export function youtubeVoiceOn(env: Record<string, string | undefined> = process.env, language: "en" | "es" = "en", articleId = ""): boolean {
  const key = language === "es" ? "youtube-es" : "youtube";
  const entry = entries(env).find((x) => x.split(":")[0] === key);
  if (!entry) return false;
  // No share written ("youtube") = every Short; "youtube-es:4" = one Short in four.
  const share = Number(entry.split(":")[1]);
  if (!entry.includes(":") || !Number.isInteger(share) || share <= 1 || !articleId) return true;
  let h = 13;
  for (const c of articleId) h = (h * 37 + c.charCodeAt(0)) >>> 0;
  return h % share === 0;
}

// Half the stories (by id) of a listed Page get the voice, the rest stay silent as the comparison. The main Page and main Instagram
// reels count as the Page "main" (2026-11-10): list it in VOICEOVER_PAGES to voice half of them.
export function voiceoverFor(topicKey: string | undefined, articleId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!topicKey || !voiceoverPages(env).includes(topicKey)) return false;
  let h = 7;
  for (const c of articleId) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % voiceShare(topicKey, env) === 0;
}

// Text as it should be spoken: no emoji or symbols, "vs" as "versus", codes spelled out, ending in a full stop. Names are NOT
// respelled here (see forVoice), so this stays the real spelling.
export function spokenText(raw: string, category = "", language: "en" | "es" = "en"): string {
  if (language === "es") {
    const es = speakScores(raw, category, "es")
      .replace(/[^\p{L}\p{N}\s.,'’:;!?¡¿%&/\-–—]/gu, " ")
      .replace(/\bvs?\.?(?=\s)/gi, "contra")
      .replace(/\s*[–—]\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\s,;:]+$/, "");
    return es && !/[.!?]$/.test(es) ? es + "." : es;
  }
  const cleaned = speakScores(raw, category)
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
const SPOKEN_LEADS: Record<string, string> = { mma: "mixed martial arts" };
// The opener, joined to the sentence: "In football, ..." (not a separate "Football news." line, 2026-10-31). Acronym sports keep their capitals.
const SPOKEN_LEADS_ES: Record<string, string> = {
  football: "En fútbol,", cricket: "En críquet,", "american-football": "En la NFL,", "college-football": "En el fútbol americano universitario,", basketball: "En la NBA,",
  wnba: "En la WNBA,", baseball: "En béisbol,", hockey: "En la NHL,", mma: "En artes marciales mixtas,", boxing: "En boxeo,", tennis: "En tenis,", "formula-1": "En la Fórmula 1,",
};
const spokenLead = (category: string, language: "en" | "es" = "en"): string | null => {
  if (language === "es") return SPOKEN_LEADS_ES[category.split("/")[0]] ?? null;
  const word = SPOKEN_LEADS[category.split("/")[0]] ?? sportKeywordFor(category);
  if (!word) return null;
  const name = /^[A-Z]{2,}$/.test(word) ? `the ${word}` : word.toLowerCase();
  return `In ${name},`;
};
// The sentence after the opener starts in lower case when its first word is an ordinary one; a name keeps its capital.
const COMMON_STARTS = new Set(["The", "A", "An", "After", "Before", "As", "With", "Why", "How", "What", "Who", "When", "Will", "Can", "Could", "Is", "Are", "Do", "Does", "Did", "Should", "Would", "Despite", "Following", "Amid", "Ahead", "On", "At", "For", "From", "It", "He", "She", "They", "This", "That", "Two", "Three", "Four", "Five", "New"]);
const COMMON_STARTS_ES = new Set(["El", "La", "Los", "Las", "Un", "Una", "Unos", "Unas", "Tras", "Con", "Después", "Antes", "Por", "Para", "Según", "Cuando", "Cómo", "Qué", "Quién", "Por qué", "Durante", "Ante", "Sin", "Desde", "Hasta", "En", "Así", "Esta", "Este", "Ese", "Esa"]);
const afterOpener = (s: string, language: "en" | "es" = "en") => s.replace(/^(\p{Lu}\p{Ll}*)\b(?!\s+(?:Zealand|York|Orleans|Jersey|England|Delhi|South)\b)/u, (w) => ((language === "es" ? COMMON_STARTS_ES : COMMON_STARTS).has(w) ? w.toLowerCase() : w));

// What is sent to the voice: the spoken text with each hard name respelled for the way it sounds. The respellings are English phonetics,
// so Spanish text goes as written (a Spanish voice reads a name by Spanish rules).
export const forVoice = (spoken: string, language: "en" | "es" = "en") => (language === "es" ? spoken : applySpeechNames(spoken));

// The story's description read aloud: its first sentence (cut at a clause break if long), opened with "In cricket," when that
// sentence never names the sport. Without a description, the on-screen hook. At most about 30 words.
// About 10 seconds of speech: the reel is 11.8 s long and the voice must end before the end card (makeVoice retries faster, then shorter).
export const VOICE_WORDS = 28;

// Spanish runs about 15-20% longer for the same content, so fewer words fit in the same 10 seconds.
export const VOICE_WORDS_ES = 24;

export function buildVoiceScript(content: { hook: string }, category: string, description?: string | null, language: "en" | "es" = "en"): string {
  const lead = spokenLead(category, language);
  // Whole sentences of the description, as many as fit (sentences.ts), then the on-screen hook when nothing readable is left.
  const budget = language === "es" ? VOICE_WORDS_ES : VOICE_WORDS;
  const base = (description?.trim() ? readableDescription(description, budget, shortReelCaption) : "") || content.hook;
  const sentence = spokenText(base, category, language);
  const needsLead = lead && withSportKeyword(sentence, category, language) !== sentence;
  return forVoice(needsLead ? `${lead} ${afterOpener(sentence, language)}` : sentence, language);
}

// The shorter text used when the description will not fit the reel: the sport and the hook.
export function buildShortScript(content: { hook: string }, category: string, language: "en" | "es" = "en"): string {
  const lead = spokenLead(category, language);
  const hook = spokenText(content.hook, category, language);
  return forVoice(lead ? `${lead} ${afterOpener(hook, language)}` : hook, language);
}

// Why the voice read what it read, for the log: the description, or the headline because there was no readable description
// (nothing generated, or only fragments and calls to action), or the headline because the description did not fit the reel's length.
export function voiceSource(spoken: string, content: { hook: string }, category: string, description: string | null | undefined, language: "en" | "es" = "en"): string {
  if (spoken === buildVoiceScript(content, category, description, language)) {
    return description?.trim() && readableDescription(description, language === "es" ? VOICE_WORDS_ES : VOICE_WORDS, shortReelCaption) ? "description" : "headline: no readable description";
  }
  return spoken === buildShortScript(content, category, language) ? "headline: description too long" : "other";
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
    const lang = voiceLang(voice);
    await execFileAsync(env.KOKORO_PYTHON ?? "python3", ["-c", KOKORO_PY, model, voices, voice, lang, String(speed), out, String(seed), text], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    return out;
  } catch (err) {
    console.warn("[voiceover] synthesis failed, reel goes out silent:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}

// A voice track that fits the reel: the description at its natural pace, then the short sport-and-hook text at the same pace, and only then
// a little faster. Until 2026-11-14 a long description was sped up to 1.2 first, which sounds rushed; shorter words at a natural pace read
// better than more words said fast. VOICE_TRIES are the (script, speed) steps, unit-tested.
export const VOICE_TRIES: ["full" | "short", number][] = [["full", 1.05], ["short", 1.05], ["short", 1.12]];
export async function makeVoice(script: string, shortScript: string, voice: string, seed?: number): Promise<{ path: string; seconds: number; text: string; speed: number; voice: string } | null> {
  for (const [which, speed] of VOICE_TRIES) {
    const text = which === "full" ? script : shortScript;
    const path = await synthesizeVoice(text, voice, speed, seed);
    if (!path) return null;
    const seconds = wavSeconds(await readFile(path));
    if (seconds > 0 && seconds <= MAX_VOICE_SECONDS) return { path, seconds, text, speed, voice };
    console.log(`[voiceover] ${seconds.toFixed(1)} s is too long at speed ${speed}; trying a shorter take`);
  }
  return null;
}
