// One entry per site language (see PLAN.md, "Spanish-language site"). Adding a
// language = a new entry here + DNS for its host + a dictionary + glossary;
// the translation job, routing and SEO code all read this table, never a
// hard-coded "es".

export interface LocaleConfig {
  code: string;
  // Hostname the language is served on (Phase 2 middleware maps host -> locale).
  host: string;
  // Name for the translation prompt.
  promptName: string;
  // Sport categories (Article.category) worth translating for this audience.
  categories: string[];
  // Terms that must be rendered a fixed way; injected into the prompt.
  glossary: string[];
  // Headlines mentioning these jump the translation queue (this audience's
  // clubs/leagues/players), so the best-fit stories are translated first
  // when the per-run cap bites.
  priorityTerms: string[];
  // Max NEW translations per sport per rolling 24h. The English site publishes
  // ~700 stories a day in these sports (about half NFL), far more than a
  // Spanish front page needs; caps keep the site balanced across sports and
  // bound the Gemini spend. A sport not listed is uncapped.
  dailyCaps: Record<string, number>;
  // One-off backfill (TRANSLATE_BACKFILL=1): max translations per sport for the
  // whole run, replacing dailyCaps. Sized so a launch has depth in every sport
  // without drowning the thin ones in NFL/baseball.
  backfillCaps: Record<string, number>;
  // Max NEW translations a day of noindex short write-ups of other outlets'
  // news (thinContent.ts), spread over the day's hours (cap / 24 an hour).
  // They were 97% of translations (2026-10-04: 545 of 566 in a day) yet never
  // reach search; this keeps the most relevant ones for the edition's front
  // page and Facebook Page. Indexed stories (the writers' pieces, enriched
  // reports) and match score cards (their sport's dailyCaps) are not
  // counted. Not applied to backfills.
  thinDailyCap: number;
  // The same for short write-ups that have a real photo: the ones the edition's Facebook Page and
  // Instagram can post (a post needs a photo). A separate, larger allowance, since the free AI
  // tiers have room for it (2026-10-09: Mistral 9% of its day used, Groq 10% of requests) and a
  // photo-less short rewrite only fills the page. Spread over the day's hours (cap / 24 an hour).
  thinPhotoDailyCap: number;
}

export const LOCALES: Record<string, LocaleConfig> = {
  es: {
    code: "es",
    host: "es.sportswirelive.com",
    promptName: "NEUTRAL Spanish for a mixed audience of US Hispanic, Latin American and Spanish readers (no regional slang)",
    // Sports the Spanish edition serves — a SELECTION from the English site's full list
    // (see memory: multilanguage-sports-approach). Added 2026-10-03: volleyball, rugby,
    // hockey (NHL), WNBA — popular in Latin America / Spain or with US Hispanic fans.
    categories: ["football", "football/world-cup", "basketball", "baseball", "american-football", "college-football", "formula-1", "athletics", "volleyball", "rugby", "hockey", "wnba", "tennis", "boxing", "mma", "motogp", "cycling", "golf", "padel"],
    glossary: [
      'soccer -> "fútbol"; NFL / American football -> "fútbol americano"; college football / NCAA football -> "fútbol americano universitario"; baseball -> "béisbol"; basketball -> "baloncesto"; volleyball -> "voleibol"; ice hockey / NHL -> "hockey sobre hielo" ("hockey" alone is fine in NHL context); rugby union -> "rugby"; tennis -> "tenis"; boxing -> "boxeo"; MMA / UFC stay "MMA" / "UFC"; MotoGP stays "MotoGP"; cycling -> "ciclismo"; golf -> "golf"; padel -> "pádel" (with the accent)',
      'match preview articles ("Preview: A vs B — date") -> "Previa: A vs B — date" (always "Previa", feminine)',
      'Formula 1 -> "Fórmula 1" (with accent); "long runs" (F1) -> "tandas largas"; "pole position" stays "pole position"; "Grand Prix" -> "Gran Premio"',
      'Never write "Los Los Angeles": team names that already start with "Los"/"Las"/"El" take no extra article',
      "Keep clock times and time zones as written (e.g. 7:00 PM UTC); translate month names (Oct -> oct.)",
    ],
    backfillCaps: { football: 400, "football/world-cup": 60, basketball: 200, "formula-1": 150, athletics: 100, baseball: 250, "american-football": 300, "college-football": 150, volleyball: 60, rugby: 60, hockey: 120, wnba: 100, tennis: 150, boxing: 100, mma: 100, motogp: 80, cycling: 80, golf: 80, padel: 120 },
    thinDailyCap: 50,
    thinPhotoDailyCap: 120,
    dailyCaps: { football: 120, "football/world-cup": 40, basketball: 60, "formula-1": 40, athletics: 20, baseball: 40, "american-football": 60, "college-football": 30, volleyball: 20, rugby: 20, hockey: 30, wnba: 30, tennis: 30, boxing: 20, mma: 20, motogp: 15, cycling: 15, golf: 15, padel: 25 },
    priorityTerms: [
      "la liga", "real madrid", "barcelona", "barça", "atlético", "atletico", "sevilla", "valencia", "villarreal", "athletic club",
      "liga mx", "mexico", "méxico", "argentina", "brazil", "brasil", "colombia", "uruguay", "chile",
      "messi", "vinicius", "vinícius", "yamal", "mbappé", "mbappe", "lewandowski", "alcaraz", "sainz", "alonso",
      "world cup", "champions league", "copa", "mls", "inter miami",
      "liga mx", "libertadores", "concacaf", "boca", "river plate", "chivas", "club américa", "los pumas", "pumas", "alcaraz", "nadal", "djokovic", "sinner", "swiatek", "canelo", "álvarez", "topuria", "márquez", "marquez", "bagnaia", "pogačar", "pogacar", "vingegaard", "rahm", "scheffler", "premier padel", "pádel", "padel", "galán", "lebrón", "coello", "tapia", "chingotto", "stupaczuk", "sanz", "ari sánchez", "uruguay", "españa", "spain",
    ],
  },
};

// Kill switch: TRANSLATION_LOCALES="es" (comma list) turns the job on for those
// languages; unset/empty = the job does nothing. Lets the code ship dormant.
export function enabledLocales(env: string | undefined = process.env.TRANSLATION_LOCALES): LocaleConfig[] {
  return (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((c) => c in LOCALES)
    .map((c) => LOCALES[c]);
}
