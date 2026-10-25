// One Facebook reel per story across our Pages: repeated videos get less
// reach. A topic Page skips a story the main Page (or it itself) already has.
// The main Page and Instagram are left exactly as they were: the main Page does
// not look at the topic Pages' reels. `existing` = this story's posted reel rows.
export const MAIN_REEL_DESTINATION = "reel";

export interface ExistingReel {
  platform: string;
  destination: string;
}

export function reelNeeds(
  existing: ExistingReel[],
  want: { instagram: boolean; facebook: boolean; topicKey?: string; fanOut?: boolean }
): { needInstagram: boolean; needFacebook: boolean } {
  const ownKey = want.topicKey ? `${want.topicKey}-reel` : null;
  // fanOut (a big match-day story, matchDay.ts): every related account gets its own reel, so only THIS account's own history
  // counts (the main Page's destination is MAIN_REEL_DESTINATION, a topic Page's is "<key>-reel").
  if (want.fanOut) {
    const own = ownKey ?? MAIN_REEL_DESTINATION;
    return {
      needInstagram: want.instagram && !existing.some((p) => p.platform === "instagram" && p.destination === own),
      needFacebook: want.facebook && !existing.some((p) => p.platform === "facebook" && p.destination === own),
    };
  }
  // A topic Page's own Instagram account keeps its own history too ("<key>-reel").
  const needInstagram = want.instagram && !existing.some((p) => p.platform === "instagram" && (p.destination === MAIN_REEL_DESTINATION || p.destination === ownKey));
  const needFacebook =
    want.facebook &&
    !existing.some((p) => p.platform === "facebook" && (p.destination === MAIN_REEL_DESTINATION || p.destination === ownKey));
  return { needInstagram, needFacebook };
}
