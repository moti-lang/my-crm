/**
 * מנוע הסבב: "בנה לי סבב" — בוחר את הלידים שדורשים כניסה בטווח, מקבץ לפי זמן יום ורחוב,
 * ומייצר לכל עצירה: מה הבטיחו, מה ראיתי, ומשפט פתיחה.
 */
import { prisma } from "./db";
import { ACTIVE_STATUSES, leadSummarySelect, type RouteLead } from "./leads";
import { addDaysIL, agoLabel, endOfDayIL, startOfDayIL } from "./dates";
import { nearestNeighborOrder } from "./geo";
import { leadTitle, truncate } from "./utils";
import type { TimeOfDay } from "./categories";

export interface PlanInput {
  area: string | null;
  from: Date;
  to: Date;
  hours: number;
  here?: { lat: number; lng: number } | null;
}

export interface PlanStop {
  lead: RouteLead;
  reason: string;
  promised: string | null;
  lastSeen: string | null;
  opener: string;
  overdue: boolean;
}

export interface RoutePlan {
  morning: PlanStop[];
  afternoon: PlanStop[];
  any: PlanStop[];
  candidates: number;
  maxStops: number;
  minutesPerStop: number;
}

const MINUTES_PER_STOP = 20;

function opener(lead: RouteLead, now: Date): string {
  const parts: string[] = [];
  parts.push(`שלום${lead.contactName ? ` ${lead.contactName}` : ""}`);
  const last = lead.touches[0];
  if (last) parts.push(`הייתי אצלכם ${agoLabel(last.at, now)}${last.summary ? ` — ${truncate(last.summary, 60)}` : ""}`);
  else parts.push("אני עובר באזור ורציתי להכיר");
  if (lead.observation) parts.push(`שמתי לב אצלכם ל${truncate(lead.observation, 60)}`);
  if (lead.nextActionNote) parts.push(lead.nextActionNote);
  else if (last?.outcome) parts.push(`דיברנו על: ${truncate(last.outcome, 60)}`);
  else parts.push("רציתי לשמוע איך זה מתנהל אצלכם ואם אפשר לעזור");
  return parts.join(". ") + ".";
}

export async function buildRoutePlan(input: PlanInput, now = new Date()): Promise<RoutePlan> {
  const from = startOfDayIL(input.from);
  const to = endOfDayIL(input.to);
  const leads = (await prisma.lead.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      ...(input.area ? { area: input.area } : {}),
      OR: [
        { nextActionAt: { lt: to }, nextActionType: "VISIT" },
        { nextActionAt: { lt: to }, phone: null },
        { status: "WAITING_THEM", nextActionAt: { lt: addDaysIL(from, -2) } },
        { phone: null, nextActionAt: null, lastTouchAt: { lt: addDaysIL(now, -14) } },
      ],
    },
    select: {
      ...leadSummarySelect,
      touches: { take: 1, orderBy: { at: "desc" }, select: { at: true, summary: true, outcome: true, withWhom: true, type: true } },
    },
  })) as RouteLead[];

  const stops: PlanStop[] = leads.map((lead) => {
    const overdue = Boolean(lead.nextActionAt && lead.nextActionAt < from);
    let reason: string;
    if (lead.status === "WAITING_THEM" && lead.nextActionAt && lead.nextActionAt < addDaysIL(from, -2)) reason = "הבטיחו לחזור ולא חזרו";
    else if (overdue) reason = "מעקב באיחור";
    else if (lead.nextActionAt) reason = "מעקב בטווח";
    else reason = "בלי טלפון — ביקור חוזר";
    return {
      lead,
      reason,
      promised: lead.nextActionNote ?? lead.touches[0]?.outcome ?? null,
      lastSeen: lead.touches[0] ? `${agoLabel(lead.touches[0].at, now)} — ${truncate(lead.touches[0].summary, 80)}` : null,
      opener: opener(lead, now),
      overdue,
    };
  });

  const heatRank = { HOT: 0, WARM: 1, COLD: 2 } as const;
  stops.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const h = heatRank[a.lead.heat as keyof typeof heatRank] - heatRank[b.lead.heat as keyof typeof heatRank];
    if (h) return h;
    return (a.lead.nextActionAt?.getTime() ?? Infinity) - (b.lead.nextActionAt?.getTime() ?? Infinity);
  });

  const maxStops = Math.max(1, Math.floor((input.hours * 60) / MINUTES_PER_STOP));
  const chosen = stops.slice(0, maxStops);

  const groupBy = (slot: TimeOfDay) => {
    const list = chosen.filter((s) => (s.lead.bestTimeOfDay as TimeOfDay) === slot);
    // קיבוץ לפי רחוב, ובתוך הרחוב שכן-קרוב אם יש קואורדינטות
    const byArea = new Map<string, PlanStop[]>();
    for (const s of list) {
      const k = s.lead.area ?? "";
      if (!byArea.has(k)) byArea.set(k, []);
      byArea.get(k)!.push(s);
    }
    const out: PlanStop[] = [];
    const areas = [...byArea.keys()].sort((a, b) => a.localeCompare(b, "he"));
    for (const a of areas) {
      const items = byArea.get(a)!;
      const ordered = nearestNeighborOrder(
        items.map((stop) => ({ lat: stop.lead.lat, lng: stop.lead.lng, stop })),
        input.here ?? null,
      );
      out.push(...ordered.map((o) => o.stop));
    }
    return out;
  };

  return {
    morning: groupBy("MORNING"),
    afternoon: groupBy("AFTERNOON"),
    any: groupBy("ANY"),
    candidates: stops.length,
    maxStops,
    minutesPerStop: MINUTES_PER_STOP,
  };
}

export function stopTitle(s: PlanStop): string {
  return leadTitle(s.lead);
}
