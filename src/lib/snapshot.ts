import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** snapshot יומי של כל הנתונים (בלי קבצי התמונות) — נשמר בטבלה, 30 אחרונים */
export async function createSnapshot(keep = 30) {
  const [leads, tasks, settings] = await Promise.all([
    prisma.lead.findMany({
      include: {
        touches: true,
        tasks: true,
        statusHistory: true,
        photos: { select: { id: true, url: true, caption: true, mimeType: true, size: true, createdAt: true } },
      },
    }),
    prisma.task.findMany({ where: { leadId: null } }),
    prisma.setting.findMany(),
  ]);
  const data = { version: 1, createdAt: new Date().toISOString(), leads, standaloneTasks: tasks, settings };
  const snap = await prisma.snapshot.create({
    data: { data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue, leadCount: leads.length },
    select: { id: true, createdAt: true, leadCount: true },
  });
  const old = await prisma.snapshot.findMany({ orderBy: { createdAt: "desc" }, skip: keep, select: { id: true } });
  if (old.length) await prisma.snapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return snap;
}

export async function exportAll() {
  const [leads, tasks, settings, pushSubs] = await Promise.all([
    prisma.lead.findMany({
      include: {
        touches: true,
        tasks: true,
        statusHistory: true,
        photos: { select: { id: true, url: true, caption: true, mimeType: true, size: true, createdAt: true } },
      },
    }),
    prisma.task.findMany({ where: { leadId: null } }),
    prisma.setting.findMany(),
    prisma.pushSubscription.count(),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), leads, standaloneTasks: tasks, settings, pushSubscriptions: pushSubs };
}
