// The features recorded with a reel decision (decisionLog.ts). Pure, so it can be tested.
import { isStarStory } from "./freshness";

export interface ReelFeatureInput {
  category: string;
  title: string;
  // The Facebook hashtags the reel goes out with, so reach can be compared by tag type later (2026-10-28).
  hashtags?: string[];
  publishedAt: Date | null;
  trendingScore: number | null;
  now: Date;
  theme?: string;
  music?: string;
  font?: string;
  language?: string;
  topicKey?: string;
  captionVariant: string;
  hook: string;
  factRows: number;
  storyType?: string;
  opening?: string;
  hookMeta?: { style: string; by: string; candidates: unknown[] };
}

export function reelFeatures(i: ReelFeatureInput): Record<string, unknown> {
  const ageH = i.publishedAt ? Math.round(((i.now.getTime() - i.publishedAt.getTime()) / 3_600_000) * 10) / 10 : null;
  return {
    sport: i.category.split("/")[0],
    category: i.category,
    ageH,
    hourUtc: i.now.getUTCHours(),
    weekdayUtc: i.now.getUTCDay(),
    trendingScore: i.trendingScore,
    star: isStarStory(i.title),
    theme: i.theme ?? null,
    music: i.music ?? null,
    font: i.font ?? null,
    language: i.language ?? "en",
    topic: i.topicKey ?? "main",
    captionVariant: i.captionVariant,
    hook: i.hook,
    hookWords: i.hook.trim().split(/\s+/).filter(Boolean).length,
    factRows: i.factRows,
    storyType: i.storyType ?? null,
    opening: i.opening ?? null,
    hookStyle: i.hookMeta?.style ?? null,
    hookChosenBy: i.hookMeta?.by ?? null,
    hookCandidates: i.hookMeta?.candidates ?? null,
    hashtags: i.hashtags ?? null,
  };
}
