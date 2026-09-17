/**
 * שאילתות קריאה: מסך היום, סבב שטח, רשימה, כרטיס ליד, דוחות.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { addDaysIL, endOfDayIL, startOfDayIL, ymdIL } from "./dates";
import { ACTION_META, LEAD_STATUSES, STATUS_META, type ActionType, type LeadStatus } from "./categories";
import { haversineKm } from "./geo";

export const leadSummarySelect = {
  id: true,
  name: true,
  descriptor: true,
  area: true,
  addressNote: true,
  lat: true,
  lng: true,
  category: true,
  bestTimeOfDay: true,
  contactName: true,
  contactRole: true,
  phone: true,
  heat: true,
  status: true,
  nextActionAt: true,
  nextActionType: true,
  nextActionNote: true,
  nextActionIsApproximate: true,
  observation: true,
  lastTouchAt: true,
  firstSeenAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

export type LeadSummary = Prisma.LeadGetPayload<{ select: typeof leadSummarySelect }>;
export type TaskWithLead = Prisma.TaskGetPayload<{ include: { lead: { select: typeof leadSummarySelect } } }>;

export const ACTIVE_STATUSES = LEAD_STATUSES.filter((s) => STATUS_META[s].active) as LeadStatus[];

// ---------- מסך "היום" ----------

export interface TodayBoard {
  overdue: TaskWithLead[];
  today: TaskWithLead[];
  week: Array<{ ymd: string; date: Date; tasks: TaskWithLead[] }>;
  counts: { overdue: number; today: number; week: number };
}

function actionOrder(t: { type: ActionType | null }): number {
  return t.type ? ACTION_META[t.type].order : 5;
}

/** מיון להיום: פגישות עם שעה קודם, אחר כך טלפונים, אחר כך כניסות */
export function sortDayTasks<T extends { allDay: boolean; dueAt: Date; type: ActionType | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
    if (!a.allDay && !b.allDay) return a.dueAt.getTime() - b.dueAt.getTime();
    return actionOrder(a) - actionOrder(b) || a.dueAt.getTime() - b.dueAt.getTime();
  });
}

export async function getTodayBoard(now = new Date()): Promise<TodayBoard> {
  const start = startOfDayIL(now);
  const end = endOfDayIL(now);
  const weekEnd = addDaysIL(start, 8);
  const tasks = await prisma.task.findMany({
    where: { done: false, dueAt: { lt: weekEnd } },
    include: { lead: { select: leadSummarySelect } },
    orderBy: { dueAt: "asc" },
  });
  const overdue = sortDayTasks(tasks.filter((t) => t.dueAt < start));
  const today = sortDayTasks(tasks.filter((t) => t.dueAt >= start && t.dueAt < end));
  const rest = tasks.filter((t) => t.dueAt >= end);
  const byDay = new Map<string, TaskWithLead[]>();
  for (const t of rest) {
    const k = ymdIL(t.dueAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(t);
  }
  const week = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([ymd, list]) => ({ ymd, date: list[0].dueAt, tasks: sortDayTasks(list) }));
  return { overdue, today, week, counts: { overdue: overdue.length, today: today.length, week: rest.length } };
}

// ---------- סבב שטח ----------

export type RouteLead = LeadSummary & {
  touches: Array<{ at: Date; summary: string; outcome: string | null; withWhom: string | null; type: ActionType }>;
  distanceKm?: number;
};

export interface RouteGroups {
  waiting: RouteLead[];
  upcoming: RouteLead[];
  rest: RouteLead[];
  areas: string[];
}

export async function getRouteLeads(
  params: { area?: string | null; lat?: number | null; lng?: number | null; radiusKm?: number; includeClosed?: boolean },
  now = new Date(),
): Promise<RouteGroups> {
  const where: Prisma.LeadWhereInput = {};
  if (!params.includeClosed) where.status = { notIn: ["LOST", "WON"] };
  if (params.area) where.area = params.area;

  const [leads, areasRaw] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        ...leadSummarySelect,
        touches: { take: 1, orderBy: { at: "desc" }, select: { at: true, summary: true, outcome: true, withWhom: true, type: true } },
      },
      orderBy: [{ area: "asc" }, { nextActionAt: { sort: "asc", nulls: "last" } }],
    }),
    prisma.lead.findMany({ where: { area: { not: null } }, distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } }),
  ]);

  let list: RouteLead[] = leads as RouteLead[];
  if (params.lat != null && params.lng != null) {
    const here = { lat: params.lat, lng: params.lng };
    const radius = params.radiusKm ?? 1.5;
    list = list
      .filter((l) => l.lat != null && l.lng != null)
      .map((l) => ({ ...l, distanceKm: haversineKm(here, { lat: l.lat!, lng: l.lng! }) }))
      .filter((l) => (l.distanceKm ?? 0) <= radius)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  const end = endOfDayIL(now);
  const weekEnd = addDaysIL(end, 7);
  const waiting = list.filter((l) => l.nextActionAt && l.nextActionAt < end);
  const upcoming = list.filter((l) => l.nextActionAt && l.nextActionAt >= end && l.nextActionAt < weekEnd);
  const rest = list.filter((l) => !waiting.includes(l) && !upcoming.includes(l));
  return { waiting, upcoming, rest, areas: areasRaw.map((a) => a.area!).filter(Boolean) };
}

// ---------- רשימת לידים ----------

export interface LeadFilters {
  q?: string;
  area?: string;
  status?: string;
  heat?: string;
  category?: string;
  phone?: "yes" | "no";
  due?: "overdue" | "today" | "week" | "none" | "any";
  stuck?: boolean;
  sort?: "next" | "recent" | "name" | "touch" | "created";
  take?: number;
}

export async function listLeads(f: LeadFilters, now = new Date()): Promise<LeadSummary[]> {
  const where: Prisma.LeadWhereInput = {};
  const and: Prisma.LeadWhereInput[] = [];
  if (f.area) and.push({ area: f.area });
  if (f.status && LEAD_STATUSES.includes(f.status as LeadStatus)) and.push({ status: f.status as LeadStatus });
  else if (f.status === "active") and.push({ status: { in: ACTIVE_STATUSES } });
  if (f.heat) and.push({ heat: f.heat as "HOT" | "WARM" | "COLD" });
  if (f.category) and.push({ category: { contains: f.category, mode: "insensitive" } });
  if (f.phone === "yes") and.push({ phone: { not: null } });
  if (f.phone === "no") and.push({ phone: null });
  const start = startOfDayIL(now);
  const end = endOfDayIL(now);
  if (f.due === "overdue") and.push({ nextActionAt: { lt: start } });
  if (f.due === "today") and.push({ nextActionAt: { gte: start, lt: end } });
  if (f.due === "week") and.push({ nextActionAt: { gte: start, lt: addDaysIL(start, 7) } });
  if (f.due === "none") and.push({ nextActionAt: null });
  if (f.due === "any") and.push({ nextActionAt: { not: null } });
  if (f.stuck) and.push({ status: { in: ACTIVE_STATUSES }, lastTouchAt: { lt: addDaysIL(now, -30) } });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const fields = ["name", "descriptor", "area", "addressNote", "category", "contactName", "contactRole", "phone", "email", "observation", "painPoints", "currentTools", "notes", "nextActionNote"] as const;
    and.push({ OR: fields.map((k) => ({ [k]: { contains: q, mode: "insensitive" } })) });
  }
  if (and.length) where.AND = and;

  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    f.sort === "recent"
      ? [{ updatedAt: "desc" }]
      : f.sort === "name"
        ? [{ name: "asc" }, { descriptor: "asc" }]
        : f.sort === "touch"
          ? [{ lastTouchAt: "asc" }]
          : f.sort === "created"
            ? [{ createdAt: "desc" }]
            : [{ nextActionAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];

  return prisma.lead.findMany({ where, select: leadSummarySelect, orderBy, take: f.take ?? 500 });
}

export async function getFilterOptions() {
  const [areas, categories] = await Promise.all([
    prisma.lead.findMany({ where: { area: { not: null } }, distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } }),
    prisma.lead.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  return { areas: areas.map((a) => a.area!).filter(Boolean), categories: categories.map((c) => c.category!).filter(Boolean) };
}

// ---------- כרטיס ליד ----------

export async function getLeadFull(id: string) {
  return prisma.lead.findUnique({
    where: { id },
    include: {
      touches: { orderBy: { at: "desc" } },
      tasks: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
      photos: { select: { id: true, url: true, caption: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { at: "desc" }, take: 20 },
    },
  });
}
export type LeadFull = NonNullable<Awaited<ReturnType<typeof getLeadFull>>>;

// ---------- תקועים ----------

export async function getStuckLeads(now = new Date(), days = 30): Promise<LeadSummary[]> {
  return prisma.lead.findMany({
    where: { status: { in: ACTIVE_STATUSES }, lastTouchAt: { lt: addDaysIL(now, -days) } },
    select: leadSummarySelect,
    orderBy: { lastTouchAt: "asc" },
    take: 200,
  });
}

// ---------- דוחות ----------

const STAGE_RANK: Partial<Record<LeadStatus, number>> = {
  NEW: 0,
  TO_CLARIFY: 1,
  WAITING_THEM: 2,
  SCHEDULED: 3,
  DIAGNOSED: 4,
  PROPOSED: 5,
  CONTRACT: 6,
  WON: 7,
};
export const ADVANCED_STATUSES: LeadStatus[] = ["SCHEDULED", "DIAGNOSED", "PROPOSED", "CONTRACT", "WON"];

export async function getDailyReport(now = new Date()) {
  const start = startOfDayIL(now);
  const end = endOfDayIL(now);
  const [touches, newLeads, doneTasks, statusChanges, openTasks] = await Promise.all([
    prisma.touch.findMany({
      where: { at: { gte: start, lt: end } },
      include: { lead: { select: { id: true, name: true, descriptor: true, area: true } } },
      orderBy: { at: "desc" },
    }),
    prisma.lead.findMany({ where: { createdAt: { gte: start, lt: end } }, select: leadSummarySelect, orderBy: { createdAt: "desc" } }),
    prisma.task.findMany({ where: { doneAt: { gte: start, lt: end } }, include: { lead: { select: leadSummarySelect } } }),
    prisma.statusHistory.findMany({
      where: { at: { gte: start, lt: end } },
      include: { lead: { select: { id: true, name: true, descriptor: true, area: true } } },
    }),
    prisma.task.count({ where: { done: false, dueAt: { lt: end } } }),
  ]);
  const byType: Record<string, number> = {};
  for (const t of touches) byType[t.type] = (byType[t.type] ?? 0) + 1;
  const byArea = new Map<string, { area: string; touches: number; newLeads: number }>();
  const bump = (area: string | null, key: "touches" | "newLeads") => {
    const k = area || "ללא אזור";
    if (!byArea.has(k)) byArea.set(k, { area: k, touches: 0, newLeads: 0 });
    byArea.get(k)![key] += 1;
  };
  for (const t of touches) bump(t.lead.area, "touches");
  for (const l of newLeads) bump(l.area, "newLeads");
  const advanced = statusChanges.filter((c) => ADVANCED_STATUSES.includes(c.to as LeadStatus));
  return {
    date: start,
    touches,
    byType,
    newLeads,
    doneTasks,
    advanced,
    statusChanges,
    openTasks,
    byArea: [...byArea.values()].sort((a, b) => b.touches - a.touches),
  };
}
export type DailyReport = Awaited<ReturnType<typeof getDailyReport>>;

export async function getWeeklyReport(now = new Date()) {
  const end = endOfDayIL(now);
  const start = addDaysIL(startOfDayIL(now), -6);
  const [newLeads, touches, doneTasks, statusChanges, activeCount, totalCount] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { id: true, createdAt: true, area: true } }),
    prisma.touch.findMany({ where: { at: { gte: start, lt: end } }, select: { id: true, at: true, type: true, leadId: true } }),
    prisma.task.findMany({ where: { doneAt: { gte: start, lt: end } }, select: { id: true, doneAt: true } }),
    prisma.statusHistory.findMany({
      where: { at: { gte: start, lt: end } },
      include: { lead: { select: { id: true, name: true, descriptor: true, area: true } } },
    }),
    prisma.lead.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    prisma.lead.count(),
  ]);
  const days: Array<{ ymd: string; date: Date; newLeads: number; touches: number; done: number }> = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysIL(start, i);
    days.push({ ymd: ymdIL(d), date: d, newLeads: 0, touches: 0, done: 0 });
  }
  const idx = (d: Date) => days.findIndex((x) => x.ymd === ymdIL(d));
  for (const l of newLeads) if (idx(l.createdAt) >= 0) days[idx(l.createdAt)].newLeads++;
  for (const t of touches) if (idx(t.at) >= 0) days[idx(t.at)].touches++;
  for (const t of doneTasks) if (t.doneAt && idx(t.doneAt) >= 0) days[idx(t.doneAt)].done++;
  const progressed = statusChanges.filter((c) => {
    const from = c.from ? (STAGE_RANK[c.from as LeadStatus] ?? -1) : -1;
    const to = STAGE_RANK[c.to as LeadStatus] ?? -1;
    return to > from && to >= 3;
  });
  const won = statusChanges.filter((c) => c.to === "WON");
  const lost = statusChanges.filter((c) => c.to === "LOST");
  const uniqueTouchedLeads = new Set(touches.map((t) => t.leadId)).size;
  return {
    start,
    end,
    days,
    totals: { newLeads: newLeads.length, touches: touches.length, touchedLeads: uniqueTouchedLeads, done: doneTasks.length, progressed: progressed.length, won: won.length, lost: lost.length, active: activeCount, total: totalCount },
    progressed,
    won,
    lost,
  };
}
export type WeeklyReport = Awaited<ReturnType<typeof getWeeklyReport>>;

export async function getAreaReport() {
  const leads = await prisma.lead.findMany({ select: { area: true, status: true, lastTouchAt: true, heat: true } });
  const map = new Map<string, { area: string; total: number; active: number; won: number; lost: number; hot: number; lastTouch: Date | null }>();
  for (const l of leads) {
    const k = l.area || "ללא אזור";
    if (!map.has(k)) map.set(k, { area: k, total: 0, active: 0, won: 0, lost: 0, hot: 0, lastTouch: null });
    const r = map.get(k)!;
    r.total++;
    if (STATUS_META[l.status as LeadStatus]?.active) r.active++;
    if (l.status === "WON") r.won++;
    if (l.status === "LOST") r.lost++;
    if (l.heat === "HOT") r.hot++;
    if (!r.lastTouch || l.lastTouchAt > r.lastTouch) r.lastTouch = l.lastTouchAt;
  }
  return [...map.values()]
    .map((r) => ({ ...r, conversion: r.total ? r.won / r.total : 0 }))
    .sort((a, b) => b.total - a.total);
}
export type AreaReport = Awaited<ReturnType<typeof getAreaReport>>;
