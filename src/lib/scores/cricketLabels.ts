// Pure helper (no DB imports) so it can be unit-tested — cricketData.ts
// itself needs a database connection just to load.
// CricketData match names are "<Team> vs <Team>, <stage>, <competition>"
// (e.g. "Kent vs Gloucestershire, 53rd Match, County Championship Division
// One 2026") — the competition is everything after the stage.
export function cricketLeagueLabel(matchName: string): string | undefined {
  const parts = matchName.split(", ");
  const competition = parts.slice(2).join(", ").trim();
  return competition || undefined;
}

interface CricketInning {
  inning?: string;
  r?: number;
  w?: number;
  o?: number;
}

// CricketData labels innings inconsistently (confirmed live 2026-09-25):
// one team's innings carry just its name ("leicestershire Inning 1"), the
// other team's carry BOTH names ("Warwickshire,Leicestershire Inning 1").
// A plain "label contains team name" check matched that second label for
// both teams, so 8 of 37 stored matches showed one team's score for both.
// Checked against CricketData's own notes (Warwickshire "lead by 5" with
// 130 vs 125; Hampshire "trail by 189" with 55 vs 244; Yorkshire "won by
// 185" with 212+275 vs 201+101): a two-name innings belongs to the team
// that has no single-name innings of its own.
function inningsOwner(label: string): string | null {
  const name = label.replace(/\s+inning\s+\d+\s*$/i, "").trim();
  return name && !name.includes(",") ? name.toLowerCase() : null;
}

function formatInning(i: CricketInning, withOvers: boolean): string {
  const runs = i.r ?? "?";
  const score = i.w === 10 ? `${runs}` : `${runs}/${i.w ?? "?"}`;
  return withOvers && i.o !== undefined ? `${score} (${i.o})` : score;
}

// One team's score line, Google-style: "212 & 275" for two completed
// innings, "130/4 (47)" for a single innings in progress (overs shown on
// the team's latest innings only). undefined when it can't be attributed.
export function cricketTeamScore(score: unknown, teamName: string, otherTeamName: string): string | undefined {
  if (!Array.isArray(score)) return undefined;
  const innings = score.filter((s): s is CricketInning => typeof s?.inning === "string");
  const team = teamName.toLowerCase();
  const other = otherTeamName.toLowerCase();
  const owners = innings.map((i) => inningsOwner(i.inning!));
  const teamHasOwn = owners.includes(team);
  const otherHasOwn = owners.includes(other);

  const mine = innings.filter((_, idx) => {
    const owner = owners[idx];
    if (owner) return owner === team;
    // Two-name label: only attributable when exactly one side has its own
    // single-name innings.
    return !teamHasOwn && otherHasOwn;
  });
  if (mine.length === 0) return undefined;
  return mine.map((i, idx) => formatInning(i, idx === mine.length - 1 && i.w !== 10)).join(" & ");
}
