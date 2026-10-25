/**
 * Athletes at a Games: who won what, and a bio and photo for each athlete.
 * Runs with the medal-table sync (syncEventData.ts, in ingest-cron.yml) and
 * stores the result for the pages to read — they never ask Wikipedia
 * themselves (see snapshots/read.ts).
 *
 * - Medallists: the country's "X at the 2026 Asian Games" page, its Medalists
 *   section (athletes.ts reads it). A table that doesn't read as a whole keeps
 *   the last good one.
 * - Profiles: Wikipedia's page summary for each athlete's article — description,
 *   opening paragraph, photo — refetched weekly, a few dozen per run so the
 *   first pass fills in over several runs without hammering Wikimedia.
 */
import { db } from "@/db";
import { dataSnapshot } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { EVENT_HUBS } from "./eventHubs";
import { athleteSlug, medalistsProblem, parseMedalists, plainName } from "./athletes";
import { medalistsKey, profileKey, type AthleteProfile, type MedalistsSnapshot } from "./athleteStore";

// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "SportsWireLive/1.0 (https://sportswirelive.com; hyperianaillc@gmail.com)";
const HEADERS = { "User-Agent": USER_AGENT };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILES_PER_RUN = 40;
const CONCURRENCY = 4;

async function upsert(key: string, data: object, sourceUrl: string): Promise<void> {
  const now = new Date();
  await db.insert(dataSnapshot).values({ key, data, sourceUrl, fetchedAt: now }).onConflictDoUpdate({ target: dataSnapshot.key, set: { data, sourceUrl, fetchedAt: now } });
}

async function readMedalistsPage(page: string): Promise<string> {
  const api = (q: string) => `https://en.wikipedia.org/w/api.php?${q}&format=json&formatversion=2`;
  const sections = await fetch(api(`action=parse&page=${encodeURIComponent(page)}&prop=sections`), { headers: HEADERS });
  if (!sections.ok) throw new Error(`sections HTTP ${sections.status}`);
  const index = ((await sections.json()).parse?.sections ?? []).find((s: { line?: string; index?: string }) => s.line === "Medalists")?.index;
  if (!index) throw new Error("no Medalists section");
  const res = await fetch(api(`action=parse&page=${encodeURIComponent(page)}&prop=text&section=${index}`), { headers: HEADERS });
  if (!res.ok) throw new Error(`section HTTP ${res.status}`);
  return (await res.json()).parse?.text ?? "";
}

async function fetchProfile(title: string): Promise<AthleteProfile | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: HEADERS });
  if (!res.ok) return null;
  const s = await res.json();
  // A disambiguation page is not a person.
  if (s.type !== "standard") return null;
  const name = plainName(s.title ?? title);
  return {
    slug: athleteSlug(title),
    name,
    title,
    description: s.description ?? null,
    extract: s.extract ?? null,
    thumbnail: s.thumbnail?.source ?? null,
    pageUrl: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

export async function syncAthletes(): Promise<void> {
  for (const hub of Object.values(EVENT_HUBS)) {
    if (!hub.athletes) continue;
    const { wikipediaPage, country } = hub.athletes;
    const key = medalistsKey(hub.eventKey, country);
    const sourceUrl = `https://en.wikipedia.org/wiki/${wikipediaPage}`;
    try {
      const medals = parseMedalists(await readMedalistsPage(wikipediaPage));
      const [prev] = await db.select({ data: dataSnapshot.data }).from(dataSnapshot).where(eq(dataSnapshot.key, key)).limit(1);
      const problem = medalistsProblem(medals, (prev?.data as MedalistsSnapshot | undefined)?.medals ?? null);
      if (problem) {
        console.warn(`[athletes] ${key}: kept last good list — ${problem}`);
      } else {
        await upsert(key, { country, medals, sourceUrl } satisfies MedalistsSnapshot, sourceUrl);
        console.log(`[athletes] ${key}: ${medals.length} medals`);
      }
    } catch (err) {
      console.error(`[athletes] ${key} failed:`, err);
    }

    // Profiles for the athletes on whatever list is stored now.
    try {
      const [stored] = await db.select({ data: dataSnapshot.data }).from(dataSnapshot).where(eq(dataSnapshot.key, key)).limit(1);
      const list = (stored?.data as MedalistsSnapshot | undefined)?.medals ?? [];
      const titles = [...new Set(list.flatMap((m) => m.athletes.flatMap((a) => (a.title ? [a.title] : []))))];
      if (titles.length === 0) continue;
      const existing = new Map(
        (await db.select({ key: dataSnapshot.key, fetchedAt: dataSnapshot.fetchedAt }).from(dataSnapshot).where(inArray(dataSnapshot.key, titles.map((t) => profileKey(athleteSlug(t)))))).map((r) => [r.key, r.fetchedAt])
      );
      const due = titles.filter((t) => {
        const at = existing.get(profileKey(athleteSlug(t)));
        return !at || Date.now() - at.getTime() > WEEK_MS;
      }).slice(0, PROFILES_PER_RUN);
      let stored_ = 0;
      for (let i = 0; i < due.length; i += CONCURRENCY) {
        await Promise.all(
          due.slice(i, i + CONCURRENCY).map(async (title) => {
            try {
              const profile = await fetchProfile(title);
              if (!profile) return;
              await upsert(profileKey(profile.slug), profile, profile.pageUrl);
              stored_++;
            } catch (err) {
              console.error(`[athletes] profile ${title} failed:`, err instanceof Error ? err.message : err);
            }
          })
        );
      }
      console.log(`[athletes] ${hub.eventKey}: ${stored_} profiles stored (${titles.length} athletes, ${due.length} due)`);
    } catch (err) {
      console.error(`[athletes] profiles for ${hub.eventKey} failed:`, err);
    }
  }
}

if (require.main === module) {
  syncAthletes().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
