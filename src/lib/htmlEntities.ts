// Decodes HTML entities left in feed text. Some publishers encode their
// titles twice — confirmed live 2026-09-26: Yahoo Sports' NFL feed arrives
// from rss-parser as "Nick Bosa&#39;s injury" and "&quot;reinforces&quot;",
// which the site then printed literally (331 published headlines).
//
// One pass, one regex: "&amp;quot;" becomes "&quot;" (what the publisher
// actually wrote), never a quote — chained .replace() calls would decode
// twice. Unknown named entities are left untouched.
const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity] ?? match;
  });
}
