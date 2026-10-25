import { espnFetch } from "../espnFetch";
/**
 * Cricket group tables from ESPN's standings API (free, no key), e.g. the
 * Asian Games men's competition. Fetched at render time with a 10-minute
 * cache, like the site's other standings. Shape checked live 2026-09-26:
 * children[] = groups, each with standings.entries[] of { team, stats[] }
 * where stats carry abbreviations M, W, L, N/R, PT, NRR.
 */
export interface CricketStandingsRow {
  teamId: string;
  team: string;
  logo: string | null;
  played: string;
  won: string;
  lost: string;
  noResult: string;
  points: string;
  nrr: string;
}

export interface CricketGroup {
  name: string;
  rows: CricketStandingsRow[];
}

interface EspnEntry {
  team?: { id?: string; displayName?: string; logos?: { href?: string }[] };
  stats?: { abbreviation?: string; displayValue?: string }[];
}

export function parseCricketStandings(data: { children?: { name?: string; standings?: { entries?: EspnEntry[] } }[] }): CricketGroup[] {
  return (data.children ?? []).map((g) => ({
    name: g.name ?? "Group",
    rows: (g.standings?.entries ?? []).map((e) => {
      const stat = (abbr: string) => e.stats?.find((s) => s.abbreviation === abbr)?.displayValue ?? "–";
      return {
        teamId: e.team?.id ?? e.team?.displayName ?? "",
        team: e.team?.displayName ?? "",
        logo: e.team?.logos?.[0]?.href ?? null,
        played: stat("M"),
        won: stat("W"),
        lost: stat("L"),
        noResult: stat("N/R"),
        points: stat("PT"),
        nrr: stat("NRR"),
      };
    }),
  })).filter((g) => g.rows.length > 0);
}

export async function fetchCricketStandings(espnLeagueId: string): Promise<CricketGroup[]> {
  try {
    const res = await espnFetch(`https://site.api.espn.com/apis/v2/sports/cricket/${espnLeagueId}/standings`, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    return parseCricketStandings(await res.json());
  } catch {
    return [];
  }
}
