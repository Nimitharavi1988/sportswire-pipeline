// Colour themes for reels (reel.tsx), picked in admin next to the music.
// Plain data so the admin page can list them without pulling in the
// renderer. `accent` colours the sport tag, fact cards, underline and
// progress bar; `tint` is the dark shade behind text (RGB, used with
// varying opacity); `glow` lights the end card. The wordmark stays brand
// green on every theme.
export const REEL_THEMES = {
  green: { accent: "#12a35e", tint: [11, 23, 18], glow: "#173a2a" },
  blue: { accent: "#2f80ed", tint: [9, 17, 31], glow: "#16305a" },
  orange: { accent: "#f08a24", tint: [24, 15, 8], glow: "#4a2a10" },
  red: { accent: "#e5484d", tint: [24, 9, 11], glow: "#4a1519" },
  purple: { accent: "#8b5cf6", tint: [16, 11, 30], glow: "#2e1f5a" },
  gold: { accent: "#d4a72c", tint: [20, 17, 8], glow: "#4a3a12" },
} satisfies Record<string, { accent: string; tint: [number, number, number]; glow: string }>;

export type ReelTheme = keyof typeof REEL_THEMES;
export const REEL_THEME_NAMES = Object.keys(REEL_THEMES) as ReelTheme[];
export const DEFAULT_REEL_THEME: ReelTheme = "green";

// Colour per story, chosen like the music is: stable for a story (so Instagram, Facebook and
// YouTube show the same colour and a rerun keeps it), rotating across the feed. Each sport has a
// small pool of colours that suit it; about 1 story in 4 stays brand green so the feed still reads
// as Sports Wire Live. Every Page uses this (the topic Pages used to stay green; changed 2026-10-12).
const THEME_POOLS: [string, ReelTheme[]][] = [
  ["american-football", ["blue", "red", "gold"]],
  ["college-football", ["gold", "red", "blue"]],
  ["cricket", ["blue", "orange", "purple"]],
  ["football", ["orange", "purple", "red"]],
  ["baseball", ["red", "blue", "gold"]],
  ["basketball", ["orange", "purple", "gold"]],
  ["wnba", ["orange", "purple", "gold"]],
  ["volleyball", ["orange", "purple", "blue"]],
  ["hockey", ["blue", "purple", "red"]],
  ["mma", ["red", "gold", "purple"]],
  ["boxing", ["red", "gold", "purple"]],
  ["formula-1", ["red", "gold", "blue"]],
];
const OTHER_THEMES: ReelTheme[] = ["blue", "orange", "red", "purple", "gold"];

export function reelThemeFor(id: string, category?: string | null): ReelTheme {
  let h = 0;
  for (const c of id + "|theme") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (h % 4 === 0) return "green";
  const cat = category ?? "";
  const pool = THEME_POOLS.find(([c]) => cat === c || cat.startsWith(c + "/"))?.[1] ?? OTHER_THEMES;
  return pool[Math.floor(h / 4) % pool.length];
}

// Headline fonts for reels: the hook, the fact values and the end card's
// question. Labels and small text stay Poppins. `file` is in
// src/assets/fonts (null = Poppins Bold, already loaded); `scale` evens out
// how big each font looks at the same size; Bebas Neue has no lowercase.
export const REEL_FONTS = {
  poppins: { label: "Poppins", family: "Poppins", file: null, weight: 700, scale: 1, letterSpacing: -0.5, uppercase: false },
  oswald: { label: "Oswald", family: "Oswald", file: "Oswald-Bold.woff", weight: 700, scale: 1.12, letterSpacing: 0, uppercase: true },
  bebas: { label: "Bebas Neue", family: "Bebas Neue", file: "BebasNeue-Regular.woff", weight: 400, scale: 1.3, letterSpacing: 1, uppercase: true },
  montserrat: { label: "Montserrat", family: "Montserrat", file: "Montserrat-ExtraBold.woff", weight: 800, scale: 0.95, letterSpacing: -0.5, uppercase: false },
} satisfies Record<string, { label: string; family: string; file: string | null; weight: 400 | 700 | 800; scale: number; letterSpacing: number; uppercase: boolean }>;

export type ReelFont = keyof typeof REEL_FONTS;
export const REEL_FONT_NAMES = Object.keys(REEL_FONTS) as ReelFont[];
export const DEFAULT_REEL_FONT: ReelFont = "poppins";
