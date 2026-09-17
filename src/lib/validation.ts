import { z } from "zod";
import { ACTION_TYPES, HEATS, LEAD_STATUSES, TIMES_OF_DAY } from "./categories";

const isoDate = z
  .string()
  .min(4)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "תאריך לא תקין" });

const optText = (max = 500) => z.string().trim().max(max).nullable().optional();

const leadBase = z.object({
    name: optText(200),
    descriptor: optText(300),
    area: optText(120),
    addressNote: optText(300),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    category: optText(120),
    bestTimeOfDay: z.enum(TIMES_OF_DAY).optional(),
    contactName: optText(120),
    contactRole: optText(80),
    phone: optText(40),
    email: optText(200),
    website: optText(300),
    status: z.enum(LEAD_STATUSES).optional(),
    heat: z.enum(HEATS).optional(),
    nextActionAt: isoDate.nullable().optional(),
    nextActionType: z.enum(ACTION_TYPES).nullable().optional(),
    nextActionNote: optText(500),
    nextActionIsApproximate: z.boolean().optional(),
    nextActionRemindMinutesBefore: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
    observation: optText(5000),
    painPoints: optText(5000),
    currentTools: optText(500),
    notes: optText(10000),
    closedReason: optText(300),
    /** מגע ראשון שנרשם יחד עם הליד (הוספה מהירה) */
    initialTouch: z
      .object({
        type: z.enum(ACTION_TYPES).default("VISIT"),
        summary: z.string().trim().min(1).max(5000),
        withWhom: optText(120),
        outcome: optText(500),
        durationMin: z.number().int().min(0).max(600).nullable().optional(),
        at: isoDate.optional(),
      })
      .nullable()
      .optional(),
});

export const leadInput = leadBase.refine((v) => (v.name?.trim() || v.descriptor?.trim() ? true : false), {
  message: "חובה שם עסק או תיאור מזהה",
  path: ["descriptor"],
});

export type LeadInput = z.infer<typeof leadInput>;

/** עדכון חלקי — כל השדות אופציונליים */
export const leadPatch = leadBase.partial();

export const touchInput = z.object({
  type: z.enum(ACTION_TYPES),
  summary: z.string().trim().min(1).max(5000),
  withWhom: optText(120),
  outcome: optText(500),
  durationMin: z.number().int().min(0).max(600).nullable().optional(),
  at: isoDate.optional(),
  /** עדכון המעקב הבא באותה פעולה */
  nextActionAt: isoDate.nullable().optional(),
  nextActionType: z.enum(ACTION_TYPES).nullable().optional(),
  nextActionNote: optText(500),
  nextActionIsApproximate: z.boolean().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  heat: z.enum(HEATS).optional(),
  /** סמן משימות פתוחות של הליד כבוצעו */
  completeOpenTasks: z.boolean().optional(),
});
export type TouchInput = z.infer<typeof touchInput>;

export const touchPatch = z.object({
  at: isoDate.optional(),
  type: z.enum(ACTION_TYPES).optional(),
  summary: z.string().trim().min(1).max(5000).optional(),
  withWhom: optText(120),
  outcome: optText(500),
  durationMin: z.number().int().min(0).max(600).nullable().optional(),
});
export type TouchPatch = z.infer<typeof touchPatch>;

export const taskInput = z.object({
  leadId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(300),
  dueAt: isoDate,
  allDay: z.boolean().optional(),
  isApproximate: z.boolean().optional(),
  type: z.enum(ACTION_TYPES).nullable().optional(),
  notes: optText(5000),
  remindMinutesBefore: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const taskPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  dueAt: isoDate.optional(),
  postponeDays: z.number().int().min(-365).max(365).optional(),
  allDay: z.boolean().optional(),
  isApproximate: z.boolean().optional(),
  type: z.enum(ACTION_TYPES).nullable().optional(),
  notes: optText(5000),
  remindMinutesBefore: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
  done: z.boolean().optional(),
  /** בסימון "בוצע": מה התוצאה? → נוצר Touch */
  outcome: optText(5000),
  outcomeTouchType: z.enum(ACTION_TYPES).optional(),
  /** התאריך הבא המוצע אחרי ביצוע */
  nextActionAt: isoDate.nullable().optional(),
  nextActionType: z.enum(ACTION_TYPES).nullable().optional(),
  nextActionNote: optText(500),
  nextActionIsApproximate: z.boolean().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  heat: z.enum(HEATS).optional(),
});
export type TaskPatch = z.infer<typeof taskPatch>;

export const pushSubscriptionInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});

export const parseInput = z.object({
  text: z.string().trim().min(2).max(4000),
});
