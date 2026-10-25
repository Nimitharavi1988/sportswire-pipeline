/**
 * Grounds with their own page (/venue/[slug]): details from Wikipedia
 * (synced into DataSnapshot by snapshots/sync.ts), the matches played there
 * (Article.venue, as the score providers write it) and the stories tagged
 * with it. Config — a new ground is a new entry here; `matchTerms` are the
 * distinctive words providers use for it (checked against ESPN's venue
 * strings, e.g. "Greenfield International Stadium, Thiruvananthapuram").
 */
export interface Venue {
  slug: string;
  name: string;
  city: string;
  country: string;
  sport: "cricket";
  // Exact English Wikipedia page title (all checked 2026-09-26).
  wikipedia: string;
  matchTerms: string[];
}

export const VENUES: Venue[] = [
  { slug: "greenfield-international-stadium", name: "Greenfield International Stadium", city: "Thiruvananthapuram", country: "India", sport: "cricket", wikipedia: "Greenfield_International_Stadium", matchTerms: ["Greenfield"] },
  { slug: "barsapara-cricket-stadium", name: "Barsapara Cricket Stadium", city: "Guwahati", country: "India", sport: "cricket", wikipedia: "Barsapara_Cricket_Stadium", matchTerms: ["Barsapara", "Assam Cricket Association Stadium"] },
  { slug: "maharaja-yadavindra-singh-stadium", name: "Maharaja Yadavindra Singh International Cricket Stadium", city: "New Chandigarh", country: "India", sport: "cricket", wikipedia: "Maharaja_Yadavindra_Singh_International_Cricket_Stadium", matchTerms: ["Maharaja Yadavindra Singh"] },
  { slug: "ekana-cricket-stadium", name: "Ekana Cricket Stadium", city: "Lucknow", country: "India", sport: "cricket", wikipedia: "Ekana_Cricket_Stadium", matchTerms: ["Ekana"] },
  { slug: "jsca-international-stadium", name: "JSCA International Stadium Complex", city: "Ranchi", country: "India", sport: "cricket", wikipedia: "JSCA_International_Stadium_Complex", matchTerms: ["JSCA International"] },
  { slug: "holkar-stadium", name: "Holkar Stadium", city: "Indore", country: "India", sport: "cricket", wikipedia: "Holkar_Stadium", matchTerms: ["Holkar"] },
  { slug: "rajiv-gandhi-international-stadium", name: "Rajiv Gandhi International Cricket Stadium", city: "Hyderabad", country: "India", sport: "cricket", wikipedia: "Rajiv_Gandhi_International_Cricket_Stadium", matchTerms: ["Rajiv Gandhi International"] },
  { slug: "eden-gardens", name: "Eden Gardens", city: "Kolkata", country: "India", sport: "cricket", wikipedia: "Eden_Gardens", matchTerms: ["Eden Gardens"] },
  { slug: "wankhede-stadium", name: "Wankhede Stadium", city: "Mumbai", country: "India", sport: "cricket", wikipedia: "Wankhede_Stadium", matchTerms: ["Wankhede"] },
  { slug: "m-chinnaswamy-stadium", name: "M. Chinnaswamy Stadium", city: "Bengaluru", country: "India", sport: "cricket", wikipedia: "M._Chinnaswamy_Stadium", matchTerms: ["Chinnaswamy"] },
  { slug: "ma-chidambaram-stadium", name: "M. A. Chidambaram Stadium", city: "Chennai", country: "India", sport: "cricket", wikipedia: "M._A._Chidambaram_Stadium", matchTerms: ["Chidambaram", "Chepauk"] },
  { slug: "narendra-modi-stadium", name: "Narendra Modi Stadium", city: "Ahmedabad", country: "India", sport: "cricket", wikipedia: "Narendra_Modi_Stadium", matchTerms: ["Narendra Modi Stadium"] },
  { slug: "arun-jaitley-stadium", name: "Arun Jaitley Cricket Stadium", city: "New Delhi", country: "India", sport: "cricket", wikipedia: "Arun_Jaitley_Cricket_Stadium", matchTerms: ["Arun Jaitley", "Feroz Shah Kotla"] },
];

export function venueBySlug(slug: string): Venue | undefined {
  return VENUES.find((v) => v.slug === slug);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The venue a provider's venue text refers to ("Greenfield International
// Stadium, Thiruvananthapuram" -> Greenfield). Whole words only, and a
// ground's practice/secondary pitch ("... B Ground") isn't the main venue.
export function matchVenue(text: string | null | undefined): Venue | undefined {
  if (!text || /\bB Ground\b/i.test(text)) return undefined;
  return VENUES.find((v) => v.matchTerms.some((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(text)));
}

// Wikipedia details for a venue page (snapshot "venue:<slug>").
export interface VenueDetails {
  title: string;
  description: string | null;
  extract: string;
  wikipediaUrl: string;
  image: { url: string; credit: string; creditUrl: string } | null;
}
