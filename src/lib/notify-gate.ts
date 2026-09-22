/**
 * שער יחיד להתראות: כל שולח (Push, וואטסאפ, דיגסטים) עובר דרך canNotifyAt().
 * בימים חסומים (שבת, יום טוב, ערב שבת, ערב יום טוב, חול המועד לפי הגדרה) — אפס התראות.
 * מה שנחסם נשמר (DeferredNotification) ונכנס לדיגסט הבוקר הראשון שאחרי, מקובץ לפי ליד.
 */
import type { DeferredNotification } from "@prisma/client";
import { prisma } from "./db";
import { getCalendarSettings } from "./calendar-settings";
import { BLACKOUT_LABELS, blackoutReasonAt, type BlackoutReason, type CalendarSettings } from "./hebrew-dates";
import { formatIL, ymdIL } from "./dates";
import { leadTitle } from "./utils";

export interface GateResult {
  allowed: boolean;
  reason: BlackoutReason | null;
  label: string | null;
  ymd: string;
}

/** בדיקה טהורה (בלי DB) — לפי תאריך בשעון ישראל */
export function evaluateGate(at: Date, settings: CalendarSettings): GateResult {
  const reason = blackoutReasonAt(at, settings);
  return { allowed: !reason, reason, label: reason ? BLACKOUT_LABELS[reason] : null, ymd: ymdIL(at) };
}

/** השער: מותר לשלוח התראה ברגע הזה? */
export async function canNotifyAt(at: Date = new Date()): Promise<GateResult> {
  return evaluateGate(at, await getCalendarSettings());
}

export interface DeferredItem {
  kind: "reminder" | "contract" | "evening" | "weekly" | "other";
  title: string;
  body: string;
  url?: string | null;
  leadId?: string | null;
  taskId?: string | null;
}

/** שומר התראה שנחסמה. אותה התראה (סוג+ליד+משימה+כותרת) שנחסמת שוב — מגדילה מונה במקום שורה חדשה. */
export async function deferNotification(item: DeferredItem, gate: GateResult): Promise<DeferredNotification> {
  const existing = await prisma.deferredNotification.findFirst({
    where: { deliveredAt: null, kind: item.kind, leadId: item.leadId ?? null, taskId: item.taskId ?? null, title: item.title },
  });
  if (existing) {
    return prisma.deferredNotification.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, blockedOn: gate.ymd, reason: gate.reason ?? existing.reason, body: item.body },
    });
  }
  return prisma.deferredNotification.create({
    data: {
      kind: item.kind,
      title: item.title,
      body: item.body,
      url: item.url ?? null,
      leadId: item.leadId ?? null,
      taskId: item.taskId ?? null,
      blockedOn: gate.ymd,
      reason: gate.reason ?? "SHABBAT",
    },
  });
}

export async function pendingDeferred(): Promise<DeferredNotification[]> {
  return prisma.deferredNotification.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: "asc" } });
}

export async function markDeferredDelivered(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.deferredNotification.updateMany({ where: { id: { in: ids } }, data: { deliveredAt: new Date() } });
}

type DeferredLike = Pick<DeferredNotification, "kind" | "title" | "body" | "leadId" | "count" | "blockedOn" | "reason">;

/**
 * שורות הדיגסט להתראות שנחסמו — מקובצות לפי ליד (אחרי סוכות מצטבר הרבה).
 * טהור: מקבל את שמות הלידים במפה.
 */
export function groupDeferred(items: DeferredLike[], titles: Map<string, string>): string[] {
  if (!items.length) return [];
  const days = [...new Set(items.map((i) => i.blockedOn))].sort();
  const range = days.length === 1 ? formatYmd(days[0]) : `${formatYmd(days[0])}–${formatYmd(days[days.length - 1])}`;
  const lines: string[] = [`🔕 הצטבר בזמן החסימה (${range}):`];

  const byLead = new Map<string, DeferredLike[]>();
  const noLead: DeferredLike[] = [];
  for (const i of items) {
    if (i.leadId) {
      if (!byLead.has(i.leadId)) byLead.set(i.leadId, []);
      byLead.get(i.leadId)!.push(i);
    } else noLead.push(i);
  }
  for (const [leadId, list] of byLead) {
    const parts = list.map((i) => `${stripEmoji(i.title)}${i.count > 1 ? ` ×${i.count}` : ""}`);
    lines.push(`• ${titles.get(leadId) ?? "ליד"}: ${parts.join(", ")}`);
  }
  for (const i of noLead) {
    lines.push(`• ${stripEmoji(i.title)}${i.count > 1 ? ` ×${i.count}` : ""}${i.body ? ` — ${firstLine(i.body)}` : ""}`);
  }
  return lines;
}

/** גרסה עם DB — טוענת שמות לידים */
export async function buildDeferredSection(items: DeferredNotification[]): Promise<string[]> {
  const ids = [...new Set(items.map((i) => i.leadId).filter((x): x is string => Boolean(x)))];
  const leads = ids.length ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, descriptor: true } }) : [];
  const titles = new Map(leads.map((l) => [l.id, leadTitle(l)]));
  return groupDeferred(items, titles);
}

function formatYmd(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)}.${Number(m)}`;
}
function stripEmoji(s: string): string {
  return s.replace(/^[\p{Extended_Pictographic}\s]+/u, "").trim();
}
function firstLine(s: string): string {
  return s.split("\n")[0].slice(0, 80);
}

export function describeGate(gate: GateResult, at: Date = new Date()): string {
  return gate.allowed ? `היום (${formatIL(at, "d.M")}) ההתראות פעילות` : `היום ${gate.label} — ההתראות מושתקות בכל הערוצים`;
}
