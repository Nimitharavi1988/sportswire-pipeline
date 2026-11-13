// Scores and figures as people say them aloud (2026-10-31: "we say two zero victory, the voice says two dash zero"). A voice reads a
// hyphen between numbers as "dash", "3/10" as a fraction and "87-run" as "87 dash run". This turns them into speech before the text
// goes to the voice; the caption and on-screen text keep the real symbols. Pure, unit-tested.

import { speakScoresEs } from "./speechScoresEs";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
// Both numbers in words when both are small ("two zero"); otherwise both stay digits ("27 19"), so a pair never mixes the two.
const isSmall = (n: string) => String(Number(n)) === n && Number(n) <= 20;

// category: the story's category ("cricket" reads 6-26 as "six for twenty-six" and 259/7 as "259 for 7").
export function speakScores(text: string, category = "", language: "en" | "es" = "en"): string {
  if (language === "es") return speakScoresEs(text);
  const cricket = category.split("/")[0] === "cricket";
  let out = text;
  // Cricket scores and bowling figures: 259/7, 144/4 -> "259 for 7"; 6-26 -> "6 for 26" (wickets 10 or fewer, then runs 10 or more).
  if (cricket) {
    // Overs: 8.2 overs -> "8 point 2 overs" (a voice read "8.2" as "eight. Two", a sentence break, in the 2026-11-12 round trip).
    out = out.replace(/\b(\d{1,2})\.(\d)(?=\s+overs?\b)/gi, "$1 point $2");
    out = out.replace(/\b(\d{2,3})\/(\d{1,2})\b/g, "$1 for $2");
    out = out.replace(/\b(\d{1,2})[-–](\d{2,3})\b/g, (m, a: string, b: string) => (Number(a) <= 10 && Number(b) >= 10 ? `${a} for ${b}` : m));
  }
  // Ratings and marks: 3/10 -> "3 out of 10".
  out = out.replace(/\b(\d{1,2})\/(5|10|20|100)\b/g, "$1 out of $2");
  // A number joined to a word by a hyphen: 87-run win, 25-point lead, 10-wicket haul -> "87 run win".
  out = out.replace(/\b(\d+)[-–](?=\p{L})/gu, "$1 ");
  // Scores: 2-0, 3–1, 27-19 -> "two zero", "three one", "27 19". A time like 14:30 or a date like 10/31 is left alone.
  out = out.replace(/\b(\d{1,3})\s?[-–]\s?(\d{1,3})\b/g, (_m, a: string, b: string) => (isSmall(a) && isSmall(b) ? `${WORDS[Number(a)]} ${WORDS[Number(b)]}` : `${a} ${b}`));
  return speakFigures(out);
}

const ORDINALS: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth", "9th": "ninth", "10th": "tenth", "11th": "eleventh", "12th": "twelfth", "13th": "thirteenth", "14th": "fourteenth", "15th": "fifteenth", "16th": "sixteenth", "17th": "seventeenth", "18th": "eighteenth", "19th": "nineteenth", "20th": "twentieth" };
const CURRENCY: Record<string, string> = { "£": "pounds", $: "dollars", "€": "euros" };
const SCALE: Record<string, string> = { m: "million", mn: "million", bn: "billion", b: "billion", k: "thousand" };

// Other written forms a voice reads badly: "1st" -> "first", "No. 1" -> "number one", "£50m" -> "50 million pounds",
// "$10 million" -> "10 million dollars", "45%" -> "45 percent", "&" -> "and".
export function speakFigures(text: string): string {
  let out = text;
  out = out.replace(/\b(\d{1,2}(?:st|nd|rd|th))\b/g, (m) => ORDINALS[m.toLowerCase()] ?? m);
  out = out.replace(/\bNo\.\s?(\d{1,2})\b/g, (_m, n: string) => `number ${isSmall(n) ? WORDS[Number(n)] : n}`);
  out = out.replace(/([£$€])\s?(\d+(?:[.,]\d+)?)\s?(m|mn|bn|b|k|million|billion|thousand)?\b/gi, (_m, c: string, n: string, s?: string) => {
    const scale = s ? SCALE[s.toLowerCase()] ?? s.toLowerCase() : "";
    return `${n}${scale ? " " + scale : ""} ${CURRENCY[c]}`;
  });
  out = out.replace(/(\d)\s?%/g, "$1 percent");
  out = out.replace(/\s&\s/g, " and ");
  return out;
}
