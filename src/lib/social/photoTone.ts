// A smiling portrait under a bad-news headline (2026-11-13: "India lose" with a picture of Virat Kohli smiling). A story's photo is a Wikimedia
// portrait of the player named in it, picked by name with no idea of the mood, so a loss, an injury or a death can carry a cheerful face. For the
// reel such a story takes the sport's own graphic card instead (fallbackCards.ts cardUrlFor: a result or injury card, or both nations' flags for a
// cricket match), which has no face to contradict the headline. Only the reel is changed here; the site and the other posts are untouched. Pure,
// unit-tested.

const NEGATIVE = /\b(lose|loses|lost|loss|losses|defeat\w*|beaten|thrash\w*|crush\w*|humbl\w*|collaps\w*|crash\w*|injur\w*|ruled out|sidelined|dies|died|dead|death|mourn\w*|suspend\w*|banned|fined|sacked|axed|dropped|heartbreak\w*|tragedy|knocked out|eliminated|exit\w*|crisis|disaster|setback|blow)\b/i;

export function isNegativeTone(title: string): boolean {
  return NEGATIVE.test(title);
}

// A photo of a person from Wikimedia (the person-photo lookup is the only thing that stores one; the sport's own cards live on our site).
export function isWikimediaPhoto(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /(^|\.)wikimedia\.org$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function toneMismatch(title: string, heroImageUrl: string | null | undefined): boolean {
  return isNegativeTone(title) && isWikimediaPhoto(heroImageUrl);
}
