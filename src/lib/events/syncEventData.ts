/**
 * Refreshes event medal tables (eventHubs.ts) into the EventData table —
 * run with each ingestion (.github/workflows/ingest-cron.yml, its own
 * step). Each snapshot is checked (medalTable.ts) against itself and the
 * last accepted one; a failed check keeps the last good table and logs
 * why, so a bad Wikipedia edit never reaches the site.
 */
import { db } from "@/db";
import { eventData } from "@/db/schema";
import { eq } from "drizzle-orm";
import { EVENT_HUBS } from "./eventHubs";
import { medalTableProblem, parseMedalTable, reviewRejectedTable, type MedalCandidate, type MedalTable } from "./medalTable";
import { syncAthletes } from "./athleteSync";

// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "SportsWireLive/1.0 (https://sportswirelive.com; hyperianaillc@gmail.com)";

export async function syncEventData(): Promise<void> {
  for (const hub of Object.values(EVENT_HUBS)) {
    if (!hub.medalTable) continue;
    const key = `${hub.eventKey}:medals`;
    const page = hub.medalTable.wikipediaPage;
    const sourceUrl = `https://en.wikipedia.org/wiki/${page}`;
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`,
        { headers: { "User-Agent": USER_AGENT } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const table = parseMedalTable((await res.json()).parse?.text ?? "");
      const [prev] = await db.select({ data: eventData.data }).from(eventData).where(eq(eventData.key, key)).limit(1);
      const problem = medalTableProblem(table, (prev?.data as MedalTable | undefined) ?? null);
      const candidateKey = `${key}:candidate`;
      if (problem) {
        // Keep the stored table, but remember this one: if it holds up for a few
        // hours the stored table was the bad one (see medalTable.ts).
        const [stored] = await db.select({ data: eventData.data }).from(eventData).where(eq(eventData.key, candidateKey)).limit(1);
        const review = reviewRejectedTable(table, (stored?.data as MedalCandidate | undefined) ?? null, new Date());
        if (review.candidate) {
          await db.insert(eventData)
            .values({ key: candidateKey, eventKey: hub.eventKey, kind: "medals-candidate", data: review.candidate, sourceUrl, fetchedAt: new Date() })
            .onConflictDoUpdate({ target: eventData.key, set: { data: review.candidate, sourceUrl, fetchedAt: new Date() } });
        } else if (stored) {
          await db.delete(eventData).where(eq(eventData.key, candidateKey));
        }
        if (!review.accept) {
          console.warn(`[events] ${key}: kept last good table — ${problem}`);
          continue;
        }
        console.warn(`[events] ${key}: replacing the stored table — the new one has been consistent since ${review.candidate?.since} (was rejected: ${problem})`);
      }
      await db.delete(eventData).where(eq(eventData.key, candidateKey));
      await db.insert(eventData)
        .values({ key, eventKey: hub.eventKey, kind: "medals", data: table, sourceUrl, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: eventData.key, set: { data: table, sourceUrl, fetchedAt: new Date() } });
      console.log(`[events] ${key}: ${table.rows.length} nations, ${table.totals?.total ?? "?"} medals`);
    } catch (err) {
      console.error(`[events] ${key} failed:`, err);
    }
  }
}

if (require.main === module) {
  // The medal table, then the medallists and their profiles (same Wikipedia sync).
  syncEventData().then(() => syncAthletes()).then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
