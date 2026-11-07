// Our own team badge: a coloured circle with a short code. Used instead of a logo from ESPN, football-data.org, MLB or any other provider
// (those logos are trademarked artwork we hold no licence for; they were hotlinked from the providers' servers). Pure helpers, shared by the
// page component (TeamCrest) and the share-image routes.

const SKIP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "cd", "ud", "fk", "sk", "the", "de", "of", "club", "women", "w", "u21", "u23", "ii"]);

// 2-3 letters that identify the team: initials of a multi-word name ("Real Madrid" -> "RM", "Manchester City" -> "MC"), first three letters of a
// one-word name ("Liverpool" -> "LIV"). Accents are removed first ("Málaga" -> "MAL").
export function teamCode(name: string | null | undefined): string {
  const words = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

// Deep colours that keep white text readable (contrast >= 4.5:1 on each).
export const TEAM_BADGE_COLORS = ["#1d6b3f", "#8a4b12", "#2f4f6b", "#7a2e3b", "#4a3f7a", "#2d6a6a", "#6b5a14", "#5a3a2a"];

export function teamBadgeColor(name: string | null | undefined): string {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TEAM_BADGE_COLORS[Math.abs(h) % TEAM_BADGE_COLORS.length];
}

// How many letters fit a badge of this size (px).
export function teamBadgeLetters(code: string, size: number): string {
  return code.slice(0, size < 24 ? 2 : 3);
}
