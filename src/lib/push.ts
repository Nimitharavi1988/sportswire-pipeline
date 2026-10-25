import webpush from "web-push";
import { db } from "@/db";
import { pushSubscription } from "@/db/schema";
import { eq } from "drizzle-orm";

// Sends one push notification to every stored subscription for a genuinely
// big story — admin-triggered only (see admin/actions.ts's
// sendPushNotificationManually), never automatic. Push notifications
// interrupt a reader's phone directly, unlike a Facebook post they scroll
// past; auto-firing on every highlight-worthy article would train people to
// disable notifications entirely. Returns how many actually went out vs.
// failed, for the admin UI to report back.
export async function sendPushToAllSubscribers(article: {
  title: string;
  slug: string;
}): Promise<{ sent: number; failed: number }> {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    throw new Error("VAPID keys not configured");
  }

  webpush.setVapidDetails("mailto:contact@hyperianai.com", publicKey, privateKey);

  const subscribers = await db.select().from(pushSubscription);
  if (subscribers.length === 0) return { sent: 0, failed: 0 };

  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  const payload = JSON.stringify({
    title: article.title,
    body: "Tap to read the full story on Sports Wire Live.",
    url: `${siteUrl}/article/${article.slug}`,
  });

  let sent = 0;
  let failed = 0;

  // Sequential + best-effort per subscriber, same isolation principle as
  // the Facebook/Instagram posters — one dead/expired subscription must
  // never block the rest of the send.
  for (const sub of subscribers) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      failed++;
      // 404/410 means the browser has revoked or expired this subscription
      // — the endpoint will never work again, so clean it up now instead
      // of retrying it (and failing) on every future notification.
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      }
    }
  }

  return { sent, failed };
}
