/**
 * פעולות כתיבה על לידים, מגעים ומשימות.
 * כלל מרכזי: nextActionAt של ליד ומשימת NEXT_ACTION חייבים להישאר מסונכרנים.
 */
import type { Lead, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { normalizePhone } from "./phone";
import { ACTION_META, defaultTimeOfDay, type ActionType } from "./categories";
import { leadTitle } from "./utils";
import { addDaysIL, dateAtIL, formatIL, hmIL, ymdIL } from "./dates";
import { addDaysYmd, nextFullWorkdayYmd } from "./hebrew-dates";
import type { LeadInput, TaskInput, TaskPatch, TouchInput, TouchPatch } from "./validation";

type Tx = Prisma.TransactionClient;

function defaultActionType(phone?: string | null): ActionType {
  return phone ? "CALL" : "VISIT";
}

/** ממפה קלט מאומת לנתוני Prisma. ב-partial רק שדות שקיימים בקלט נכנסים. */
function buildLeadData(input: Partial<LeadInput>, existing?: Lead | null): Prisma.LeadUncheckedUpdateInput {
  const data: Prisma.LeadUncheckedUpdateInput = {};
  const has = (k: keyof LeadInput) => input[k] !== undefined;

  const textFields: Array<keyof LeadInput> = [
    "name",
    "descriptor",
    "area",
    "addressNote",
    "category",
    "contactName",
    "contactRole",
    "website",
    "nextActionNote",
    "observation",
    "painPoints",
    "currentTools",
    "notes",
    "closedReason",
  ];
  for (const k of textFields) {
    if (has(k)) {
      const v = input[k] as string | null | undefined;
      (data as Record<string, unknown>)[k] = v && v.trim() ? v.trim() : null;
    }
  }
  if (has("email")) data.email = input.email?.trim() ? input.email.trim().toLowerCase() : null;
  if (has("phone")) data.phone = normalizePhone(input.phone);
  if (has("lat")) data.lat = input.lat ?? null;
  if (has("lng")) data.lng = input.lng ?? null;
  if (has("status")) data.status = input.status;
  if (has("heat")) data.heat = input.heat;
  if (has("nextActionIsApproximate")) data.nextActionIsApproximate = input.nextActionIsApproximate ?? false;
  if (has("nextActionType")) data.nextActionType = input.nextActionType ?? null;
  if (has("nextActionAt")) {
    data.nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : null;
    if (!input.nextActionAt) {
      data.nextActionType = null;
      data.nextActionNote = null;
      data.nextActionIsApproximate = false;
    }
  }

  const category = has("category") ? (input.category ?? null) : (existing?.category ?? null);
  if (has("bestTimeOfDay")) data.bestTimeOfDay = input.bestTimeOfDay;
  else if (has("category") && (!existing || existing.bestTimeOfDay === "ANY" || existing.category !== category)) {
    data.bestTimeOfDay = defaultTimeOfDay(category);
  }

  // ברירת מחדל לסוג הפעולה: אין טלפון → כניסה
  const finalNextAt = has("nextActionAt") ? data.nextActionAt : existing?.nextActionAt;
  const finalType = has("nextActionType") ? input.nextActionType : existing?.nextActionType;
  if (finalNextAt && !finalType) {
    const phone = has("phone") ? (data.phone as string | null) : (existing?.phone ?? null);
    data.nextActionType = defaultActionType(phone);
  }
  return data;
}

/** יוצר/מעדכן/מוחק את משימת ה-NEXT_ACTION של הליד לפי nextActionAt */
export async function syncNextActionTask(tx: Tx, lead: Lead, remindMinutesBefore?: number | null) {
  const open = await tx.task.findFirst({ where: { leadId: lead.id, source: "NEXT_ACTION", done: false } });
  if (!lead.nextActionAt) {
    if (open) await tx.task.delete({ where: { id: open.id } });
    return;
  }
  const type = (lead.nextActionType ?? defaultActionType(lead.phone)) as ActionType;
  const allDay = hmIL(lead.nextActionAt) === "00:00";
  const data = {
    leadId: lead.id,
    title: `${ACTION_META[type].verb} — ${leadTitle(lead)}`,
    dueAt: lead.nextActionAt,
    allDay,
    type,
    notes: lead.nextActionNote,
    isApproximate: lead.nextActionIsApproximate,
    source: "NEXT_ACTION" as const,
    ...(remindMinutesBefore !== undefined ? { remindMinutesBefore } : {}),
  };
  if (open) {
    const moved = open.dueAt.getTime() !== lead.nextActionAt.getTime();
    await tx.task.update({ where: { id: open.id }, data: { ...data, ...(moved ? { notifiedAt: null } : {}) } });
  } else {
    await tx.task.create({ data });
  }
}

export async function createLead(input: LeadInput): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const data = buildLeadData(input) as Prisma.LeadUncheckedCreateInput;
    const status = input.status ?? "NEW";
    const now = new Date();
    const touchAt = input.initialTouch?.at ? new Date(input.initialTouch.at) : now;
    let lead = await tx.lead.create({
      data: {
        ...data,
        status,
        firstSeenAt: touchAt,
        lastTouchAt: touchAt,
        statusHistory: { create: { from: null, to: status, at: now } },
      },
    });
    if (input.initialTouch) {
      await tx.touch.create({
        data: {
          leadId: lead.id,
          type: input.initialTouch.type,
          summary: input.initialTouch.summary,
          withWhom: input.initialTouch.withWhom ?? lead.contactName ?? null,
          outcome: input.initialTouch.outcome ?? null,
          durationMin: input.initialTouch.durationMin ?? null,
          at: touchAt,
        },
      });
    }
    await syncNextActionTask(tx, lead, input.nextActionRemindMinutesBefore);
    lead = await tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
    return lead;
  });
}

export async function updateLead(id: string, patch: Partial<LeadInput>): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findUniqueOrThrow({ where: { id } });
    const data = buildLeadData(patch, existing);
    const now = new Date();
    if (patch.status && patch.status !== existing.status) {
      data.statusChangedAt = now;
      await tx.statusHistory.create({ data: { leadId: id, from: existing.status, to: patch.status, at: now } });
    }
    const lead = await tx.lead.update({ where: { id }, data });
    const touchesNextAction = ["nextActionAt", "nextActionType", "nextActionNote", "nextActionIsApproximate", "name", "descriptor", "phone"].some(
      (k) => (patch as Record<string, unknown>)[k] !== undefined,
    );
    if (touchesNextAction || patch.nextActionRemindMinutesBefore !== undefined) {
      await syncNextActionTask(tx, lead, patch.nextActionRemindMinutesBefore);
    }
    return lead;
  });
}

export async function deleteLead(id: string): Promise<void> {
  await prisma.lead.delete({ where: { id } });
}

/** רישום מגע (ביקור/שיחה) + עדכון אופציונלי של המעקב הבא/סטטוס/חום */
export async function addTouch(leadId: string, input: TouchInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const now = new Date();
    const at = input.at ? new Date(input.at) : now;
    const touch = await tx.touch.create({
      data: {
        leadId,
        type: input.type,
        summary: input.summary,
        withWhom: input.withWhom?.trim() || null,
        outcome: input.outcome?.trim() || null,
        durationMin: input.durationMin ?? null,
        at,
      },
    });

    if (input.completeOpenTasks) {
      await tx.task.updateMany({
        where: { leadId, done: false, dueAt: { lte: addDaysIL(now, 1) } },
        data: { done: true, doneAt: now, outcome: input.outcome?.trim() || input.summary },
      });
    }

    const data: Prisma.LeadUncheckedUpdateInput = {
      lastTouchAt: at > existing.lastTouchAt ? at : existing.lastTouchAt,
    };
    if (input.heat) data.heat = input.heat;
    if (input.status && input.status !== existing.status) {
      data.status = input.status;
      data.statusChangedAt = now;
      await tx.statusHistory.create({ data: { leadId, from: existing.status, to: input.status, at: now } });
    }
    if (input.nextActionAt !== undefined) {
      data.nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : null;
      data.nextActionType = input.nextActionAt ? (input.nextActionType ?? defaultActionType(existing.phone)) : null;
      data.nextActionNote = input.nextActionAt ? (input.nextActionNote?.trim() || null) : null;
      data.nextActionIsApproximate = input.nextActionAt ? (input.nextActionIsApproximate ?? false) : false;
    }
    if (input.withWhom?.trim() && !existing.contactName) data.contactName = input.withWhom.trim();

    const lead = await tx.lead.update({ where: { id: leadId }, data });
    await syncNextActionTask(tx, lead);
    return { touch, lead };
  });
}

/** כפתור "ראיתי שסגור": מגע מהיר + הזזת המעקב ליום העבודה הבא */
export async function markSawClosed(leadId: string, now = new Date()) {
  const nextYmd = nextFullWorkdayYmd(addDaysYmd(ymdIL(now), 1));
  return addTouch(leadId, {
    type: "VISIT",
    summary: "ראיתי שסגור",
    outcome: "סגור",
    completeOpenTasks: true,
    nextActionAt: dateAtIL(nextYmd).toISOString(),
    nextActionType: "VISIT",
    nextActionNote: `היה סגור ב-${formatIL(now, "d.M")} — לנסות שוב`,
    nextActionIsApproximate: false,
  });
}

/** מגע אחרון של הליד = המגע המאוחר ביותר, או firstSeenAt אם אין מגעים */
async function recomputeLastTouch(tx: Tx, leadId: string) {
  const [latest, lead] = await Promise.all([
    tx.touch.findFirst({ where: { leadId }, orderBy: { at: "desc" }, select: { at: true } }),
    tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { firstSeenAt: true } }),
  ]);
  await tx.lead.update({ where: { id: leadId }, data: { lastTouchAt: latest?.at ?? lead.firstSeenAt } });
}

export async function updateTouch(id: string, patch: TouchPatch) {
  return prisma.$transaction(async (tx) => {
    const data: Prisma.TouchUncheckedUpdateInput = {};
    if (patch.at) data.at = new Date(patch.at);
    if (patch.type) data.type = patch.type;
    if (patch.summary !== undefined) data.summary = patch.summary;
    if (patch.withWhom !== undefined) data.withWhom = patch.withWhom?.trim() || null;
    if (patch.outcome !== undefined) data.outcome = patch.outcome?.trim() || null;
    if (patch.durationMin !== undefined) data.durationMin = patch.durationMin;
    const touch = await tx.touch.update({ where: { id }, data });
    await recomputeLastTouch(tx, touch.leadId);
    return touch;
  });
}

export async function deleteTouch(id: string) {
  return prisma.$transaction(async (tx) => {
    const touch = await tx.touch.delete({ where: { id } });
    await recomputeLastTouch(tx, touch.leadId);
  });
}

// ---------- משימות ----------

export async function createTask(input: TaskInput) {
  const dueAt = new Date(input.dueAt);
  return prisma.task.create({
    data: {
      leadId: input.leadId ?? null,
      title: input.title,
      dueAt,
      allDay: input.allDay ?? hmIL(dueAt) === "00:00",
      isApproximate: input.isApproximate ?? false,
      type: input.type ?? null,
      notes: input.notes?.trim() || null,
      remindMinutesBefore: input.remindMinutesBefore ?? null,
      source: "MANUAL",
    },
  });
}

export async function updateTask(id: string, patch: TaskPatch) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id }, include: { lead: true } });
    const now = new Date();
    const data: Prisma.TaskUncheckedUpdateInput = {};

    if (patch.postponeDays) {
      data.dueAt = addDaysIL(task.dueAt, patch.postponeDays);
      data.notifiedAt = null;
    }
    if (patch.dueAt) {
      data.dueAt = new Date(patch.dueAt);
      data.notifiedAt = null;
    }
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.allDay !== undefined) data.allDay = patch.allDay;
    if (patch.isApproximate !== undefined) data.isApproximate = patch.isApproximate;
    if (patch.remindMinutesBefore !== undefined) data.remindMinutesBefore = patch.remindMinutesBefore;

    const completing = patch.done === true && !task.done;
    if (completing) {
      data.done = true;
      data.doneAt = now;
      data.outcome = patch.outcome?.trim() || null;
    } else if (patch.done === false && task.done) {
      data.done = false;
      data.doneAt = null;
    }

    const updated = await tx.task.update({ where: { id }, data });

    if (task.leadId && task.lead) {
      const leadData: Prisma.LeadUncheckedUpdateInput = {};
      if (completing) {
        await tx.touch.create({
          data: {
            leadId: task.leadId,
            type: patch.outcomeTouchType ?? task.type ?? "VISIT",
            summary: patch.outcome?.trim() || `בוצע: ${task.title}`,
            outcome: patch.outcome?.trim() || null,
            at: now,
          },
        });
        leadData.lastTouchAt = now;
        if (task.source === "NEXT_ACTION" && task.lead.nextActionAt && task.lead.nextActionAt.getTime() === task.dueAt.getTime()) {
          leadData.nextActionAt = null;
          leadData.nextActionType = null;
          leadData.nextActionNote = null;
          leadData.nextActionIsApproximate = false;
        }
      }
      if (patch.nextActionAt !== undefined) {
        leadData.nextActionAt = patch.nextActionAt ? new Date(patch.nextActionAt) : null;
        leadData.nextActionType = patch.nextActionAt ? (patch.nextActionType ?? task.type ?? defaultActionType(task.lead.phone)) : null;
        leadData.nextActionNote = patch.nextActionAt ? (patch.nextActionNote?.trim() || null) : null;
        leadData.nextActionIsApproximate = patch.nextActionAt ? (patch.nextActionIsApproximate ?? false) : false;
      } else if ((patch.dueAt || patch.postponeDays) && task.source === "NEXT_ACTION" && !updated.done) {
        leadData.nextActionAt = updated.dueAt;
        if (patch.isApproximate !== undefined) leadData.nextActionIsApproximate = patch.isApproximate;
      }
      if (patch.status && patch.status !== task.lead.status) {
        leadData.status = patch.status;
        leadData.statusChangedAt = now;
        await tx.statusHistory.create({ data: { leadId: task.leadId, from: task.lead.status, to: patch.status, at: now } });
      }
      if (patch.heat) leadData.heat = patch.heat;

      if (Object.keys(leadData).length) {
        const lead = await tx.lead.update({ where: { id: task.leadId }, data: leadData });
        await syncNextActionTask(tx, lead);
      }
    }
    return tx.task.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteTask(id: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id }, include: { lead: true } });
    await tx.task.delete({ where: { id } });
    if (task.leadId && task.source === "NEXT_ACTION" && !task.done && task.lead?.nextActionAt?.getTime() === task.dueAt.getTime()) {
      await tx.lead.update({
        where: { id: task.leadId },
        data: { nextActionAt: null, nextActionType: null, nextActionNote: null, nextActionIsApproximate: false },
      });
    }
  });
}
