import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, readJson, withErrors } from "@/lib/api-utils";
import { pushConfigured } from "@/lib/push";
import { pushSubscriptionInput } from "@/lib/validation";

export const GET = withErrors(async () => {
  const subscriptions = await prisma.pushSubscription.count();
  return ok({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null, subscriptions });
});

export const POST = withErrors(async (req) => {
  const sub = await readJson(req, pushSubscriptionInput);
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? req.headers.get("user-agent") ?? null },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? req.headers.get("user-agent") ?? null },
  });
  return ok({ ok: true }, { status: 201 });
});

export const DELETE = withErrors(async (req) => {
  const { endpoint } = await readJson(req, z.object({ endpoint: z.string().url() }));
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return ok({ ok: true });
});
