import webpush from "web-push";
import { prisma } from "./db";
import { canNotifyAt } from "./notify-gate";
import type { BlackoutReason } from "./hebrew-dates";

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

export interface PushSendResult {
  configured: boolean;
  sent: number;
  failed: number;
  /** נחסם על ידי השער (שבת/חג) — לא נשלח דבר */
  blocked?: boolean;
  reason?: BlackoutReason | null;
}

/** שליחת התראה לכל המכשירים הרשומים — דרך השער. מנויים שפגו (404/410) נמחקים. */
export async function sendPushToAll(payload: PushPayload, opts: { at?: Date } = {}): Promise<PushSendResult> {
  const gate = await canNotifyAt(opts.at ?? new Date());
  if (!gate.allowed) return { configured: pushConfigured(), sent: 0, failed: 0, blocked: true, reason: gate.reason };
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
