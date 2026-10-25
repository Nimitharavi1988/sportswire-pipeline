import { postSocialPoster } from "./socialPoster";

// Thin Instagram-only wrapper around the shared poster pipeline
// (socialPoster.ts), used by postInstagramPosterJob.ts (the admin "Post
// Instagram poster" button, via GitHub Actions). autoApprove.ts calls
// postSocialPoster directly since it needs both platforms.
export async function postInstagramPoster(articleId: string): Promise<boolean> {
  const { instagramPosted } = await postSocialPoster(articleId, { instagram: true, facebook: false });
  return instagramPosted;
}
