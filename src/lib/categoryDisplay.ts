// Readable label + a distinct (but still muted/brand-consistent) accent color
// per category, so cards are scannable by sport at a glance rather than all
// showing the same plain outlined chip regardless of category. Shared across
// the homepage and article pages — was duplicated per-page before.
// `emoji` leads social posts (was three separate copies in facebook.ts,
// instagram.ts and socialPoster.ts) — one registry, so a new sport is
// added once.
const CATEGORY_CHIP: Record<string, { label: string; color: string; emoji?: string }> = {
  football: { label: "Football", color: "#1d6b3f", emoji: "⚽" },
  "football/world-cup": { label: "World Cup", color: "#3d5a73" },
  // #935b20 (was #b8752e, 3.7:1 on white): 5.6:1, readable as small text.
  cricket: { label: "Cricket", color: "#935b20", emoji: "🏏" },
  "american-football": { label: "NFL", color: "#6b3fa0", emoji: "🏈" },
  "college-football": { label: "College Football", color: "#8e2a2a", emoji: "🏈" },
  athletics: { label: "Athletics", color: "#a02b5c", emoji: "🏃" },
  baseball: { label: "MLB", color: "#c0392b", emoji: "⚾" },
  basketball: { label: "NBA", color: "#e67e22", emoji: "🏀" },
  wnba: { label: "WNBA", color: "#127369", emoji: "🏀" },
  rugby: { label: "Rugby", color: "#2e7d5b", emoji: "🏉" },
  hockey: { label: "NHL", color: "#1a5276", emoji: "🏒" },
  volleyball: { label: "Volleyball", color: "#8e44ad", emoji: "🏐" },
  "formula-1": { label: "Formula 1", color: "#b7950b", emoji: "🏎️" },
  tennis: { label: "Tennis", color: "#5d8a1f", emoji: "🎾" },
  boxing: { label: "Boxing", color: "#a93226", emoji: "🥊" },
  mma: { label: "MMA", color: "#4a4a4a", emoji: "🥋" },
  motogp: { label: "MotoGP", color: "#d35400", emoji: "🏍️" },
  cycling: { label: "Cycling", color: "#2471a3", emoji: "🚴" },
  golf: { label: "Golf", color: "#1e8449", emoji: "⛳" },
  padel: { label: "Padel", color: "#17a2b8", emoji: "🎾" },
};

// Dark mode (2026-10-15). These colours were each checked for readable text on white;
// on a dark card most are too dark (17 of 20 under 4.5:1). `darkColor` is the same hue
// lightened toward white until it reaches 4.5:1 on the dark card colour, so every sport
// keeps its own colour. `color` stays as it was (backgrounds, social posts, light mode).
const DARK_CARD = "#1c201d";

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mixWithWhite(hex: string, amount: number): string {
  const part = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
}

export function darkTextColor(hex: string, background: string = DARK_CARD): string {
  let amount = 0;
  let candidate = hex;
  while (contrastRatio(candidate, background) < 4.5 && amount < 1) {
    amount += 0.05;
    candidate = mixWithWhite(hex, amount);
  }
  return candidate;
}

export interface CategoryChipStyle {
  label: string;
  color: string;
  darkColor: string;
  emoji?: string;
}

const chipCache = new Map<string, CategoryChipStyle>();

export function categoryChipStyle(category: string): CategoryChipStyle {
  const cached = chipCache.get(category);
  if (cached) return cached;
  const entry = CATEGORY_CHIP[category] ?? { label: category, color: "#6b6b6b" };
  const style = { ...entry, darkColor: darkTextColor(entry.color) };
  chipCache.set(category, style);
  return style;
}

// sx fragments: the sport colour as text (and as an outline) in light mode, its lightened
// version when the browser is dark. Spread into an sx object: sx={{ ...chipTextSx(chip) }}.
export function chipTextSx(chip: CategoryChipStyle) {
  return { color: chip.color, "[data-dark] &": { color: chip.darkColor } };
}

export function chipOutlineSx(chip: CategoryChipStyle) {
  return {
    color: chip.color,
    borderColor: chip.color,
    "[data-dark] &": { color: chip.darkColor, borderColor: chip.darkColor },
  };
}

export function categoryEmoji(category: string): string {
  return CATEGORY_CHIP[category]?.emoji ?? "🏆";
}
