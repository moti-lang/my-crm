/**
 * ייבוא לידים מקובץ JSON (למשל leads-seed.json). תאריכים בפורמט YYYY-MM-DD בשעון ישראל.
 * לידים קיימים (אותו שם/תיאור + אזור) מדולגים — אפשר להריץ שוב בבטחה.
 */
import { z } from "zod";
import { prisma } from "./db";
import { ACTION_TYPES, HEATS, LEAD_STATUSES, TIMES_OF_DAY } from "./categories";
import { dateAtIL } from "./dates";
import { createLead } from "./lead-service";
import type { LeadInput } from "./validation";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "תאריך בפורמט YYYY-MM-DD");
const text = z.string().nullable().optional();

const touchSchema = z.object({
  at: ymd.optional(),
  type: z.enum(ACTION_TYPES).optional(),
  withWhom: text,
  summary: z.string().min(1),
  outcome: text,
  durationMin: z.number().int().min(0).nullable().optional(),
});

const leadSchema = z
  .object({
    name: text,
    descriptor: text,
    area: text,
    addressNote: text,
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    category: text,
    bestTimeOfDay: z.enum(TIMES_OF_DAY).optional(),
    contactName: text,
    contactRole: text,
    phone: text,
    email: text,
    website: text,
    status: z.enum(LEAD_STATUSES).optional(),
    heat: z.enum(HEATS).optional(),
    nextActionAt: ymd.nullable().optional(),
    nextActionTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    nextActionType: z.enum(ACTION_TYPES).nullable().optional(),
    nextActionNote: text,
    isApproximate: z.boolean().optional(),
    nextActionIsApproximate: z.boolean().optional(),
    observation: text,
    painPoints: text,
    currentTools: text,
    notes: text,
    closedReason: text,
    firstSeenAt: ymd.optional(),
    touches: z.array(touchSchema).optional(),
  })
  .refine((l) => Boolean(l.name?.trim() || l.descriptor?.trim()), { message: "חובה name או descriptor" });

export const importFileSchema = z.union([z.object({ leads: z.array(leadSchema) }), z.array(leadSchema)]);
export type ImportLead = z.infer<typeof leadSchema>;

export interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ lead: string; error: string }>;
}

const title = (l: { name?: string | null; descriptor?: string | null }) => (l.name?.trim() || l.descriptor?.trim() || "").toLowerCase();
const key = (l: { name?: string | null; descriptor?: string | null; area?: string | null }) => `${title(l)}|${(l.area ?? "").trim().toLowerCase()}`;

export async function importLeads(raw: unknown): Promise<ImportResult> {
  const parsed = importFileSchema.parse(raw);
  const leads = Array.isArray(parsed) ? parsed : parsed.leads;
  const existing = await prisma.lead.findMany({ select: { name: true, descriptor: true, area: true } });
  const seen = new Set(existing.map(key));
  const result: ImportResult = { total: leads.length, created: 0, skipped: 0, errors: [] };

  for (const l of leads) {
    const k = key(l);
    if (seen.has(k)) {
      result.skipped++;
      continue;
    }
    try {
      const touches = [...(l.touches ?? [])].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
      const first = touches[0];
      const firstSeen = l.firstSeenAt ?? first?.at;
      const input: LeadInput = {
        name: l.name ?? null,
        descriptor: l.descriptor ?? null,
        area: l.area ?? null,
        addressNote: l.addressNote ?? null,
        lat: l.lat ?? null,
        lng: l.lng ?? null,
        category: l.category ?? null,
        bestTimeOfDay: l.bestTimeOfDay,
        contactName: l.contactName ?? null,
        contactRole: l.contactRole ?? null,
        phone: l.phone ?? null,
        email: l.email ?? null,
        website: l.website ?? null,
        status: l.status,
        heat: l.heat,
        nextActionAt: l.nextActionAt ? dateAtIL(l.nextActionAt.slice(0, 10), l.nextActionTime ?? "00:00").toISOString() : null,
        nextActionType: l.nextActionType ?? null,
        nextActionNote: l.nextActionNote ?? null,
        nextActionIsApproximate: l.nextActionIsApproximate ?? l.isApproximate ?? false,
        observation: l.observation ?? null,
        painPoints: l.painPoints ?? null,
        currentTools: l.currentTools ?? null,
        notes: l.notes ?? null,
        closedReason: l.closedReason ?? null,
        initialTouch: first
          ? {
              type: first.type ?? "VISIT",
              summary: first.summary,
              withWhom: first.withWhom ?? null,
              outcome: first.outcome ?? null,
              durationMin: first.durationMin ?? null,
              at: first.at ? dateAtIL(first.at.slice(0, 10), "09:00").toISOString() : undefined,
            }
          : null,
      };
      const lead = await createLead(input);

      for (const t of touches.slice(1)) {
        await prisma.touch.create({
          data: {
            leadId: lead.id,
            type: t.type ?? "VISIT",
            summary: t.summary,
            withWhom: t.withWhom ?? null,
            outcome: t.outcome ?? null,
            durationMin: t.durationMin ?? null,
            at: t.at ? dateAtIL(t.at.slice(0, 10), "09:00") : new Date(),
          },
        });
      }
      const lastTouch = touches.length ? touches[touches.length - 1].at : undefined;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(firstSeen ? { firstSeenAt: dateAtIL(firstSeen.slice(0, 10), "09:00"), statusChangedAt: dateAtIL(firstSeen.slice(0, 10), "09:00") } : {}),
          ...(lastTouch ? { lastTouchAt: dateAtIL(lastTouch.slice(0, 10), "09:00") } : {}),
        },
      });
      seen.add(k);
      result.created++;
    } catch (e) {
      result.errors.push({ lead: l.name ?? l.descriptor ?? "?", error: (e as Error).message });
    }
  }
  return result;
}
