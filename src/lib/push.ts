import webpush from "web-push";
import { prisma } from "./db";

let configured = false;

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** שליחת התראה לכל המכשירים הרשומים. מנויים שפגו (404/410) נמחקים. */
export async function sendPushToAll(payload: PushPayload): Promise<{ configured: boolean; sent: number; failed: number }> {
  if (!ensureConfigured()) return { configured: false, sent: 0, failed: 0 };
  const subs = await prisma.pushSubscription.findMany();
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 12 * 60 * 60 },
        );
        sent++;
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        } else {
          console.error("push failed", status, (e as Error).message);
        }
      }
    }),
  );
  return { configured: true, sent, failed };
}
