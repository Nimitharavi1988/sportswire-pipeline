// When each sport's stories should go out on the main account (2026-11-11): in the local daytime and evening of the people who follow that
// sport, not at one set of hours for everything. Cricket for India at India time, the NFL and NBA for the US at US time, football (soccer) and
// F1 for Europe at European time. Measured audience of the main accounts: Facebook followers 92% India and 7% US; Instagram reach this
// month 47% India and 34% US, engagement 61% India and 26% US; the site's own visitors are mostly US.
//
// It is a weight on a story's selection score, so it changes only which story goes next: nothing is excluded, no daily cap changes and a much
// bigger story still wins out of its hours. It replaces two older special cases in autoApprove.ts (cricket down-weighted in US hours, the NFL
// down-weighted 03:00 to 11:00 UTC), which are the same idea for two sports. REGION_SCHEDULE=off turns it off. Pure, unit-tested.

export type Region = "india" | "us" | "europe";

const ZONES: Record<Region, string> = { india: "Asia/Kolkata", us: "America/New_York", europe: "Europe/London" };

// How strongly each sport belongs to each region (1 = home audience). A sport also gets a smaller weight in the other regions where it has
// followers: the NFL and WNBA did best on the main Facebook Page at India daytime hours (its followers are in India), so US sports keep a
// real India share instead of vanishing from the Indian day.
export const SPORT_REGIONS: Record<string, Partial<Record<Region, number>>> = {
  cricket: { india: 1, europe: 0.5 },
  football: { europe: 1, india: 0.8, us: 0.5 },
  "formula-1": { europe: 1, india: 0.7, us: 0.6 },
  motogp: { europe: 1, india: 0.5 },
  tennis: { europe: 1, us: 0.7, india: 0.5 },
  "american-football": { us: 1, india: 0.6 },
  "college-football": { us: 1, india: 0.6 },
  basketball: { us: 1, india: 0.6 },
  wnba: { us: 1, india: 0.6 },
  baseball: { us: 1, india: 0.3 },
  hockey: { us: 1, europe: 0.5, india: 0.3 },
  mma: { us: 1, india: 0.4 },
  boxing: { us: 1, europe: 0.6, india: 0.3 },
  golf: { us: 1, europe: 0.7 },
  volleyball: { us: 1, europe: 0.5 },
  rugby: { europe: 1 },
  cycling: { europe: 1 },
  athletics: { europe: 1, us: 0.6 },
  padel: { europe: 1 },
};
const DEFAULT_REGIONS: Partial<Record<Region, number>> = { us: 1, europe: 0.7, india: 0.5 };

// How busy a region's audience is at a local hour: the morning commute and the lunch hour and the evening are the peaks.
const LOCAL_HOUR_WEIGHT = [
  0.1, 0.1, 0.1, 0.1, 0.1, 0.15, // 00-05
  0.4, // 06
  1, 1, 1, // 07-09
  0.8, 0.8, // 10-11
  1, 1, 1, // 12-14
  0.7, 0.7, 0.7, // 15-17
  1, 1, 1, 1, 1, // 18-22
  0.5, // 23
];

export const MIN_REGION_WEIGHT = 0.15;

function localHour(now: Date, zone: string): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now));
  return Number.isFinite(h) ? h % 24 : 12;
}

export function regionHourWeight(region: Region, now: Date): number {
  return LOCAL_HOUR_WEIGHT[localHour(now, ZONES[region])];
}

// The weight for a story of this category right now (the best of its regions), never below MIN_REGION_WEIGHT.
export function regionTimingWeight(category: string, now: Date, env: Record<string, string | undefined> = process.env): number {
  if (env.REGION_SCHEDULE?.trim().toLowerCase() === "off") return 1;
  const regions = SPORT_REGIONS[category.split("/")[0]] ?? DEFAULT_REGIONS;
  let best = 0;
  for (const [region, strength] of Object.entries(regions) as [Region, number][]) best = Math.max(best, strength * regionHourWeight(region, now));
  return Math.max(MIN_REGION_WEIGHT, best);
}

// Whether India's audience is awake (07:00 to 23:00 IST): the hours cricket keeps its reserved slot on the main Page.
export function indiaAwake(now: Date): boolean {
  const h = localHour(now, ZONES.india);
  return h >= 7 && h < 23;
}

// India and the US take turns on the main reels while both audiences are at a peak hour (2026-11-14, user's request: "equal preference with
// cricket during India peak and USA morning"). Both already get full weight then, so cricket's higher-scoring stories took nearly every slot
// (no US reel 11:44 to 14:02 UTC that morning). In those hours the next reel goes to the side (India sports or US sports, by each sport's
// home region in SPORT_REGIONS) that had fewer of the last six reels, ties going to the side that did not post last. Only the first candidate
// moves; outside shared peaks, or when the wanted side has nothing waiting, the order is unchanged. REEL_TURNS=off turns it off.
export function homeRegion(category: string): Region | undefined {
  const regions = SPORT_REGIONS[category.split("/")[0]] ?? DEFAULT_REGIONS;
  return (Object.entries(regions) as [Region, number][]).find(([, s]) => s >= 1)?.[0];
}
export const sharedIndiaUsPeak = (now: Date): boolean => regionHourWeight("india", now) >= 1 && regionHourWeight("us", now) >= 1;

// recentCategories: the last reels' sports, newest first. Pure, unit-tested.
export function takeIndiaUsTurns<T extends { category: string }>(ordered: T[], recentCategories: string[], now: Date, env: Record<string, string | undefined> = process.env): T[] {
  if (env.REEL_TURNS?.trim().toLowerCase() === "off" || env.REGION_SCHEDULE?.trim().toLowerCase() === "off" || !sharedIndiaUsPeak(now)) return ordered;
  const sides = recentCategories.slice(0, 6).map(homeRegion);
  const india = sides.filter((r) => r === "india").length;
  const us = sides.filter((r) => r === "us").length;
  const lastSide = sides.find((r) => r === "india" || r === "us");
  const wanted: Region = india < us ? "india" : us < india ? "us" : lastSide === "us" ? "india" : "us";
  const i = ordered.findIndex((a) => homeRegion(a.category) === wanted);
  if (i <= 0) return ordered;
  return [ordered[i], ...ordered.slice(0, i), ...ordered.slice(i + 1)];
}
