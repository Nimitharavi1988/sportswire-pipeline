import { categoryChipStyle } from "@/lib/categoryDisplay";
import type { Dict } from "./dictionary";

// Small helpers that read a dictionary. Kept apart from dictionary.ts so the
// dictionary files (en.ts, es.ts) never import it back (no import cycle).

/** Display name for a category in this language (falls back to the English label). */
export function categoryLabel(category: string, t: Dict): string {
  return t.categoryLabels[category] ?? categoryChipStyle(category).label;
}

export function formatShortDate(d: Date, t: Dict, withYear = false): string {
  return d.toLocaleDateString(t.dateLocale, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}
