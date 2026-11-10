// Spanish scores and figures as they are said aloud (2026-11-10, Spanish voice): "2-0" is "dos cero", not "dos guion cero"; "3/10" is
// "3 sobre 10"; "45%" is "45 por ciento". A pair of small numbers is said in words, a pair with a large one stays in digits so a pair never
// mixes the two. The caption and on-screen text keep the symbols. Pure, unit-tested.

const WORDS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte"];
const isSmall = (n: string) => String(Number(n)) === n && Number(n) <= 20;

export function speakScoresEs(text: string): string {
  let out = text;
  out = out.replace(/\b(\d{1,2})\/(5|10|20|100)\b/g, "$1 sobre $2");
  out = out.replace(/\b(\d+)[-–](?=\p{L})/gu, "$1 ");
  out = out.replace(/\b(\d{1,3})\s?[-–]\s?(\d{1,3})\b/g, (_m, a: string, b: string) => (isSmall(a) && isSmall(b) ? `${WORDS[Number(a)]} ${WORDS[Number(b)]}` : `${a} ${b}`));
  out = out.replace(/(\d)\s?%/g, "$1 por ciento");
  out = out.replace(/\s&\s/g, " y ");
  return out;
}
