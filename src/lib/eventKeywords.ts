// Words that mark a headline as high-interest by EVENT TYPE (transfers,
// records, deaths, milestones) regardless of who the story is about.
// Shared between ingestion-time trending scoring (trending.ts) and the
// homepage's "Transfers & Big News" section selection (page.tsx) so the
// two never drift apart. Living config — add to it as gaps are found in
// the review queue.
export const EVENT_KEYWORDS = [
  "transfer", "sign", "signing", "signs", "deal", "retire", "retirement",
  "retires", "quits", "quit", "move to", "confirmed", "departure", "leave",
  "leaves", "exit", "farewell",
  // Deaths/tributes of sports figures are exactly the kind of major story
  // this list exists to surface — real sports journalism, not gossip.
  "dies", "dead at", "death of", "passes away", "obituary", "tribute",
  "tributes",
  // Records/milestones — another class of story that's always high-interest
  // regardless of which player it's about.
  "record", "milestone", "history", "historic", "breaks", "first player",
  "youngest", "oldest", "hat-trick", "hat trick",
  // India vs Afghanistan T20I series (Sept 2026) — match reports/previews
  // often don't name a single tracked player in the title, so without this
  // they'd miss isHighlightWorthy entirely despite being exactly the kind
  // of high-interest, high-traffic content this list exists to surface.
  "ind vs afg", "india vs afghanistan", "afghanistan t20i", "afghanistan t20",
  // Public statements and disputes (added 2026-10-01 for reach): what big
  // names say about each other and the game, controversies, discipline.
  // Deliberately NOT included: allegation/accused/investigation (legal
  // risk), reportedly/insider (rumour), and "fired" (matches "backfired").
  "slams", "blasts", "lashes out", "hits out", "calls out", "fires back",
  "breaks silence", "backlash", "controvers", "feud", "apolog", "outrage",
  "snub", "blames", "ultimatum", "criticis", "admits", "reveals",
  "suspended", "suspension", "sacked",
];
