import { db } from "@/db";
import { articleTranslation } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { LOCALES, type LocaleConfig } from "./locales";
import { getDict } from "./dictionary";

// English-side switches for the language editions. Everything the English pages
// show about another language (header links, "Read in ..." on articles, hreflang
// tags, the suggestion banner, IndexNow pings) is driven by LIVE_LOCALES, a
// comma list of edition codes (e.g. "es" or "es,pt"), set as a wrangler var.
// Unset/empty = nothing shows, so an edition's code can ship before launch and
// be switched on by adding its code here. TRANSLATION_LOCALES (the translation
// job) is a separate list: translate first, go live later.
export function liveLocales(env: string | undefined = process.env.LIVE_LOCALES): LocaleConfig[] {
  return (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((c) => c in LOCALES)
    .map((c) => LOCALES[c]);
}

export const localeOrigin = (code: string) => `https://${LOCALES[code].host}`;

/** The edition's URL for an English /sport/<category> page, or null if it does not cover that sport. */
export function localeSportUrl(code: string, category: string): string | null {
  return getDict(code).sports.some((s) => s.category === category) ? `${localeOrigin(code)}/sport/${category}` : null;
}

/** Slug of an article's translation in each live edition that has one ({ es: "slug-es" }). */
export async function translatedSlugs(articleId: string): Promise<Record<string, string>> {
  const live = liveLocales();
  if (live.length === 0) return {};
  try {
    const rows = await db
      .select({ locale: articleTranslation.locale, slug: articleTranslation.slug })
      .from(articleTranslation)
      .where(and(eq(articleTranslation.articleId, articleId), eq(articleTranslation.status, "translated")));
    const out: Record<string, string> = {};
    for (const r of rows) if (r.slug && live.some((l) => l.code === r.locale)) out[r.locale] = r.slug;
    return out;
  } catch {
    return {}; // table missing / DB hiccup: simply no translated links
  }
}

/** What the English chrome needs to link to each live edition. */
export function editionLinks() {
  return liveLocales().map((l) => {
    const t = getDict(l.code);
    return {
      code: l.code,
      origin: localeOrigin(l.code),
      name: t.switchTo.name,
      categories: t.sports.map((s) => s.category),
      acceptLang: t.switchTo.acceptLang,
      question: t.switchTo.question,
      go: t.switchTo.go,
      dismiss: t.switchTo.dismiss,
    };
  });
}
