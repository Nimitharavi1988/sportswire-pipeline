// Profanity check shared by the ingestion quality checks and the fan
// feedback / Fan Voices moderation (kept import-free so routes stay light).
/**
 * Lightweight built-in profanity filter — replaces the `bad-words` package,
 * which had a broken/corrupted install on this machine. Zero dependencies.
 *
 * Add to this list any time you spot something it missed in the "Flagged"
 * section of the admin queue — treat it as a living config, not a finished
 * list.
 */
const PROFANITY_LIST = [
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "horseshit",
  "bitch", "asshole", "arsehole", "bastard", "dick", "dickhead",
  "piss", "pissed", "cunt", "whore", "slut", "damn", "goddamn", "crap",
  "twat", "wanker", "bollocks", "bugger", "prick", "douche",
  "douchebag", "cock", "cocksucker", "pussy",
  "jackass", "dumbass", "dipshit", "nigger", "nigga", "faggot", "fag",
  "retard", "retarded", "spastic", "tranny", "chink", "spic", "wetback",
  "gook", "kike", "paki", "raghead", "shithead", "shitty",
  "asswipe", "dumbfuck", "motherfucking", "goddamned",
];

// Common evasion patterns, all handled without ever letting two separate
// words merge into an accidental match (each check works within a single
// token/word, never across whitespace):
//   1. Digit/symbol-for-letter substitution ("sh1t", "a$$hole")
//   2. A censor symbol standing in for one letter ("f*ck", "f#*k")
//   3. Punctuation splitting up the letters ("f-u-c-k", "f.u.c.k")
//   4. Letter-spam ("fuuuuuck")
const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i",
};

function applyLeetSubstitution(text: string): string {
  let result = text.toLowerCase();
  for (const [from, to] of Object.entries(LEET_MAP)) {
    result = result.split(from).join(to);
  }
  return result;
}

const obfuscationPatternCache = new Map<string, RegExp>();

// Builds a regex where each letter of the word may repeat (letter-spam) or
// be stood in for by exactly one arbitrary punctuation/symbol character
// (a censor mark), with optional filler punctuation between letters. A
// clean English token can only match this if its letters already spell the
// word — the wildcard branch only ever fires on tokens that contain
// non-alphanumeric characters in the first place, which is the obfuscation
// signal itself.
function obfuscationPattern(word: string): RegExp {
  let cached = obfuscationPatternCache.get(word);
  if (cached) return cached;

  const letters = word.split("");
  const body = letters.map((l) => `(?:${l}+|[^a-z0-9\\s])`).join("[^a-z0-9\\s]*");
  cached = new RegExp(`^${body}$`);
  obfuscationPatternCache.set(word, cached);
  return cached;
}

export function containsProfanity(text: string): { flagged: boolean; matched: string[] } {
  const matched = new Set<string>();

  const plainLower = text.toLowerCase();
  const leetLower = applyLeetSubstitution(text);

  for (const word of PROFANITY_LIST) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(plainLower) || pattern.test(leetLower)) matched.add(word);
  }

  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    for (const word of PROFANITY_LIST) {
      if (obfuscationPattern(word).test(token)) matched.add(word);
    }
  }

  return { flagged: matched.size > 0, matched: [...matched] };
}

