import { postReel } from "./postReel";
import { TOPIC_DESTINATIONS } from "./facebookDestinations";
import { REEL_MUSIC_STYLE_NAMES, type ReelMusicStyle } from "./reelMusic";
import { REEL_THEME_NAMES, REEL_FONT_NAMES, type ReelTheme, type ReelFont } from "./reelThemes";

// Entry point for .github/workflows/post-reel.yml, triggered from the admin
// "Post reel" button (postReelManually in admin/actions.ts). MUSIC is a
// style name from reelMusic.ts, or "auto" for the story's own pick.
async function main() {
  const articleId = process.env.ARTICLE_ID;
  if (!articleId) throw new Error("ARTICLE_ID env var is required");
  const musicInput = process.env.MUSIC || "auto";
  if (musicInput !== "auto" && !REEL_MUSIC_STYLE_NAMES.includes(musicInput as ReelMusicStyle)) {
    throw new Error(`Unknown MUSIC "${musicInput}" (expected auto or ${REEL_MUSIC_STYLE_NAMES.join(", ")})`);
  }
  const music = musicInput === "auto" ? undefined : (musicInput as ReelMusicStyle);
  // THEME: a colour theme from reelThemes.ts, or "auto"/empty to rotate by sport (reelThemeFor).
  const themeInput = process.env.THEME && process.env.THEME !== "auto" ? process.env.THEME : undefined;
  if (themeInput && !REEL_THEME_NAMES.includes(themeInput as ReelTheme)) {
    throw new Error(`Unknown THEME "${themeInput}" (expected ${REEL_THEME_NAMES.join(", ")})`);
  }
  const theme = themeInput as ReelTheme | undefined;
  // FONT: a headline font from reelThemes.ts; empty for Poppins.
  const fontInput = process.env.FONT || undefined;
  if (fontInput && !REEL_FONT_NAMES.includes(fontInput as ReelFont)) {
    throw new Error(`Unknown FONT "${fontInput}" (expected ${REEL_FONT_NAMES.join(", ")})`);
  }
  const font = fontInput as ReelFont | undefined;

  // TOPIC_PAGE: a topic Page key (facebookDestinations.ts) — post the reel to that Page only.
  const topicKey = process.env.TOPIC_PAGE && process.env.TOPIC_PAGE !== "none" ? process.env.TOPIC_PAGE : undefined;
  const topicPage = topicKey ? TOPIC_DESTINATIONS.find((d) => d.key === topicKey) : undefined;
  if (topicKey && !topicPage) throw new Error(`Unknown TOPIC_PAGE "${topicKey}"`);

  const { instagramPosted, facebookPosted, youtubePosted } = await postReel(articleId, topicPage
    ? { instagram: false, facebook: true, topicPage, music, theme, font, fanOut: true }
    : { instagram: true, facebook: true, youtube: true, music, theme, font, fanOut: true });
  console.log(`Instagram: ${instagramPosted ? "posted" : "not posted"}. Facebook: ${facebookPosted ? "posted" : "not posted"}.`);
  // Fail the run when nothing went out, so it shows red in Actions.
  if (youtubePosted) console.log("YouTube: posted.");
  if (!instagramPosted && !facebookPosted && !youtubePosted) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reel job failed:", err);
    process.exit(1);
  });
