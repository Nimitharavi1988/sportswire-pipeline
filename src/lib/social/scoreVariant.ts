// The test split for the score on photo posts: among the stories that have a verified score, half (by article id, stable)
// get the score on the image ("strip"), half keep the plain photo ("plain", the control). The outcome is recorded in the
// decision log (kind "photo") so reach and reactions can be compared per group (decisionLog.ts).
export type ScoreGroup = "strip" | "plain";

export function photoScoreGroupFor(articleId: string): ScoreGroup {
  let h = 0;
  for (const c of `${articleId}|photo-score`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "strip" : "plain";
}
