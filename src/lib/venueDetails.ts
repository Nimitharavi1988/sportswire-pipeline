import { fetchWikipediaPageImage } from "./ingestion/wikimediaImages";
import type { Venue, VenueDetails } from "./venues";

// Wikipedia's page summary for a venue (lead paragraph, short description)
// plus its lead photo when freely licensed — run by the ingestion job
// (snapshots/sync.ts), shown on /venue/[slug] with attribution. null when
// Wikipedia doesn't answer, so the stored copy is kept.
const USER_AGENT = "TheSportsWireLiveBot/1.0 (sports news aggregator)";

export async function fetchVenueDetails(venue: Venue): Promise<VenueDetails | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(venue.wikipedia)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const page = (await res.json()) as { title?: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
  if (!page.extract) return null;
  const image = await fetchWikipediaPageImage(venue.wikipedia, 1200).catch(() => null);
  return {
    title: page.title ?? venue.name,
    description: page.description ?? null,
    extract: page.extract,
    wikipediaUrl: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${venue.wikipedia}`,
    image,
  };
}
