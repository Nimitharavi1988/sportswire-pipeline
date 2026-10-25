/**
 * Generic stock photography from Pexels, for articles that have no real
 * image of their own (RSS-sourced news has no crest/photo). Fetches a small
 * pool per category once per ingestion run rather than once per article, to
 * stay well within Pexels' free-tier rate limits (200 req/hr, 20k/month).
 *
 * Docs: https://www.pexels.com/api/documentation/
 * Free tier: attribution required — "Photo by {photographer} on Pexels",
 * linking to the photographer's profile.
 */

export interface StockImage {
  url: string;
  credit: string;
  creditUrl: string;
}

const CATEGORY_QUERIES: Record<string, string> = {
  football: "football stadium",
  cricket: "cricket stadium",
  "american-football": "american football stadium",
  baseball: "baseball stadium",
  basketball: "basketball arena",
  "college-football": "college football stadium",
  wnba: "basketball arena",
  // hockey/volleyball/formula-1 articles almost always already carry a real
  // image (team crests for hockey/volleyball, RSS-embedded photos for F1 —
  // see nhlData.ts/volleyballData.ts/rssFeeds.ts), so this is a safety net
  // for the rare miss rather than a primary source, same role it plays for
  // the categories above.
  hockey: "ice hockey arena",
  volleyball: "volleyball court",
  "formula-1": "formula 1 race track",
  // Pre-existing gap, not introduced this pass — rugby/athletics never had
  // a stock-photo fallback either, closing it now for full coverage across
  // every nav category rather than just the newly-added ones.
  rugby: "rugby stadium",
  tennis: "tennis court",
  boxing: "boxing ring",
  mma: "mixed martial arts octagon",
  motogp: "motorcycle racing",
  cycling: "road cycling race",
  golf: "golf course",
  padel: "padel court",
  athletics: "athletics track",
};

async function searchPexels(apiKey: string, query: string, count: number): Promise<StockImage[]> {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}`,
    { headers: { Authorization: apiKey } }
  );

  if (!res.ok) {
    console.error(`Pexels fetch failed for "${query}": ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.photos ?? []).map((photo: any) => ({
    url: photo.src?.large ?? photo.src?.medium,
    credit: `Photo by ${photo.photographer} on Pexels`,
    creditUrl: photo.photographer_url,
  }));
}

export async function fetchStockImagePools(): Promise<Record<string, StockImage[]>> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn("PEXELS_API_KEY not set — skipping stock image assignment");
    return {};
  }

  // 24 rather than the original 10 — a single ingestion run can produce
  // dozens of cricket articles alone (domestic franchise/county matches have
  // no team-crest data available, see cricketData.ts), and a small pool
  // picked at random was producing visible, jarring repeats (the exact same
  // photo showing up on several unrelated matches). One extra Pexels call
  // per category per run either way, so raising per_page is free.
  const pools: Record<string, StockImage[]> = {};
  for (const [category, query] of Object.entries(CATEGORY_QUERIES)) {
    pools[category] = await searchPexels(apiKey, query, 24);
  }
  return pools;
}

/**
 * A stateful picker that cycles through a shuffled copy of each category's
 * pool before repeating any photo, instead of picking independently at
 * random each time (birthday-paradox math means pure `Math.random()` picks
 * produce visible back-to-back repeats well before the pool is exhausted —
 * e.g. ~20 picks from a 10-item pool reliably repeats several photos).
 * Reshuffles and starts a new cycle once a category's pool is exhausted, so
 * every photo in the pool gets used before any repeat within a run.
 */
export function createStockImagePicker(pools: Record<string, StockImage[]>) {
  const cycles: Record<string, StockImage[]> = {};

  function shuffled(pool: StockImage[]): StockImage[] {
    const copy = [...pool];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  return {
    pick(category: string): StockImage | null {
      const key = Object.keys(pools).find((k) => category.startsWith(k));
      const pool = key ? pools[key] : null;
      if (!pool || pool.length === 0) return null;

      if (!cycles[key!] || cycles[key!].length === 0) {
        cycles[key!] = shuffled(pool);
      }
      return cycles[key!].pop()!;
    },
  };
}

/**
 * Single-image lookup for render-time use (e.g. the homepage hero banner),
 * as opposed to fetchStockImagePools' bulk per-category pool used during
 * ingestion. Safe to call from a page with `revalidate` set — it only
 * actually hits Pexels once per revalidation window, not per request.
 */
export async function fetchOneStockImage(category: string): Promise<StockImage | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const key = Object.keys(CATEGORY_QUERIES).find((k) => category.startsWith(k));
  const query = key ? CATEGORY_QUERIES[key] : "sports stadium";
  const results = await searchPexels(apiKey, query, 1);
  return results[0] ?? null;
}
