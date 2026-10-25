/**
 * Extra data shown on a multi-sport event's page (/series/[key]) and its
 * "Happening now" tile: a medal table and competition standings. Config,
 * not code — the next Games (Olympics, Commonwealth Games) is a new entry
 * here, keyed by the same event key as eventTagging.ts's EVENTS.
 */
export interface EventHub {
  eventKey: string;
  // Name shown on the homepage medal card ("Asian Games").
  label: string;
  // English Wikipedia page holding the event's medal table (see
  // medalTable.ts for why, and the checks every snapshot passes).
  medalTable?: { wikipediaPage: string };
  // Group tables from ESPN's cricket standings (league id from ESPN).
  cricketStandings?: { label: string; espnLeagueId: string }[];
  // A country's medallists and their profiles, from its Wikipedia page "X at the
  // 2026 Asian Games" (athletes.ts, athleteSync.ts). One entry per country shown.
  athletes?: { wikipediaPage: string; country: string };
}

export const EVENT_HUBS: Record<string, EventHub> = {
  "asian-games-2026": {
    eventKey: "asian-games-2026",
    label: "Asian Games",
    medalTable: { wikipediaPage: "2026_Asian_Games_medal_table" },
    // Checked live 2026-09-26: group standings with M/W/L/NR/PT/NRR.
    cricketStandings: [{ label: "Men's cricket", espnLeagueId: "22547" }],
    // India first: the site's audience, and the page with the fullest medallist table (checked 2026-10-02: 63 medals).
    athletes: { wikipediaPage: "India_at_the_2026_Asian_Games", country: "India" },
  },
};
