import { postInstagramPoster } from "./postInstagramPoster";

// Entry point for .github/workflows/post-instagram-poster.yml, triggered
// on-demand from the admin "Post Instagram poster" button
// (postInstagramPosterManually in admin/actions.ts). See
// postInstagramPoster.ts for the actual logic and why this has to run here
// (plain Node) instead of in the deployed app.
async function main() {
  const articleId = process.env.ARTICLE_ID;
  if (!articleId) throw new Error("ARTICLE_ID env var is required");

  const posted = await postInstagramPoster(articleId);
  console.log(posted ? "Posted." : "Skipped (already posted, or not eligible — missing image/body).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Instagram poster job failed:", err);
    process.exit(1);
  });
