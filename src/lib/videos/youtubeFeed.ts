import { decodeHtmlEntities } from "../htmlEntities";
/**
 * Pure helpers for official YouTube channel feeds (no DB, unit-tested):
 * parsing the public RSS feed, and deciding which match a highlights video
 * belongs to. Feed shape checked live 2026-09-25: Atom <entry> with
 * <yt:videoId>, <title>, <published>, <link rel="alternate">, and
 * <media:thumbnail>; Shorts link to /shorts/<id> (most of what these feeds
 * carry — skipped, a vertical clip reads badly in a 16:9 slot).
 */

export interface FeedVideo {
  youtubeId: string;
  title: string;
  publishedAt: Date;
  thumbnailUrl: string | null;
  isShort: boolean;
}

export function parseYouTubeFeed(xml: string): FeedVideo[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.flatMap((e) => {
    const youtubeId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    const title = e.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!youtubeId || !title || !published) return [];
    const publishedAt = new Date(published);
    if (Number.isNaN(publishedAt.getTime())) return [];
    const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? "";
    const thumbnailUrl = e.match(/<media:thumbnail url="([^"]+)"/)?.[1] ?? null;
    return [{ youtubeId, title: decodeHtmlEntities(title).trim(), publishedAt, thumbnailUrl, isShort: link.includes("/shorts/") }];
  });
}

// Whether a video actually plays in an embedded player on another site,
// read from YouTube's own embed page (https://www.youtube.com/embed/ID),
// whose player config carries previewPlayabilityStatus. oEmbed isn't
// enough: checked live 2026-09-25, NFL/NHL/LaLiga/Sky Sports videos all
// pass oEmbed yet show "Video unavailable — blocked it from display on
// this website" in the player. Anything but an explicit OK counts as not
// playable — a broken player is worse than no video.
export function isPlayableInEmbed(embedHtml: string): boolean {
  const status = embedHtml.match(/previewPlayabilityStatus\\?"\s*:\s*\{\s*\\?"status\\?"\s*:\s*\\?"([A-Z_]+)/)?.[1];
  return status === "OK";
}

// "Official Full Game Highlights", "Match Highlights", "Extended
// Highlights", "HIGHLIGHTS |" — a whole-game recap, not a single-play clip.
export function isHighlightsTitle(title: string): boolean {
  return /\bhighlights?\b/i.test(title);
}

// Words too generic to identify a team on their own.
const GENERIC = new Set(["city", "united", "fc", "town", "county", "club", "real", "sporting", "athletic", "state", "national"]);

// Curated short forms broadcasters use in titles (full name -> aliases).
const EXTRA_ALIASES: Record<string, string[]> = {
  "Manchester City": ["Man City"],
  "Manchester United": ["Man Utd", "Man United"],
  "Tottenham Hotspur": ["Spurs", "Tottenham"],
  "Wolverhampton Wanderers": ["Wolves"],
  "Paris Saint-Germain": ["PSG"],
  "Bayern Munich": ["Bayern", "FC Bayern"],
  "Borussia Dortmund": ["Dortmund", "BVB"],
  "Inter Milan": ["Inter"],
  "Atlético Madrid": ["Atletico Madrid", "Atlético", "Atletico"],
};

// Not college-football: college nicknames repeat across schools (Wildcats,
// Tigers, Bulldogs), so college teams match on their full names only.
const US_LEAGUES = new Set(["american-football", "basketball", "wnba", "baseball", "hockey"]);

// How a team can appear in a video title. US leagues' team nicknames are
// unique ("Orioles", "Chargers") and broadcasters use them alone
// ("ORIOLES vs. YANKEES"); elsewhere only the full name or a curated alias
// counts, since "City" or "United" alone could be anyone.
export function teamAliases(team: string, category: string): string[] {
  const aliases = new Set<string>([team, ...(EXTRA_ALIASES[team] ?? [])]);
  const words = team.split(/\s+/);
  if (US_LEAGUES.has(category.split("/")[0]) && words.length > 1) {
    const nickname = words[words.length - 1];
    if (nickname.length >= 4 && !GENERIC.has(nickname.toLowerCase())) aliases.add(nickname);
    // Two-word nicknames: "Red Sox", "White Sox", "Blue Jays", "Maple Leafs".
    if (words.length > 2) aliases.add(words.slice(-2).join(" "));
  }
  return [...aliases];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function titleMentionsTeam(title: string, team: string, category: string): boolean {
  const folded = fold(title);
  return teamAliases(team, category).some((alias) => new RegExp(`\\b${escapeRegex(fold(alias))}\\b`, "i").test(folded));
}

export interface MatchCandidate {
  id: string;
  category: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
}

// Highlights are posted after the game: accept matches that kicked off
// within this long before the upload (covers a late upload of a Test day).
export const HIGHLIGHTS_MAX_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

// The match a highlights video is about: same sport, both teams named in
// the title, kicked off before the upload and not too long before. When a
// pair meet twice in the window (a series), the latest game before the
// upload wins. null when nothing qualifies — a video is never attached to
// a guess.
export function pickMatchForVideo(
  video: { title: string; publishedAt: Date; category: string },
  candidates: MatchCandidate[]
): string | null {
  if (!isHighlightsTitle(video.title)) return null;
  const sport = video.category.split("/")[0];
  const fits = candidates.filter((c) => {
    if (c.category.split("/")[0] !== sport) return false;
    const delay = video.publishedAt.getTime() - c.kickoffAt.getTime();
    if (delay < 0 || delay > HIGHLIGHTS_MAX_DELAY_MS) return false;
    return titleMentionsTeam(video.title, c.homeTeam, c.category) && titleMentionsTeam(video.title, c.awayTeam, c.category);
  });
  if (fits.length === 0) return null;
  fits.sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
  return fits[0].id;
}
