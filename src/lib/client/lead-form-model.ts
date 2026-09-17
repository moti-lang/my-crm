import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { ActionType, Heat, LeadStatus, TimeOfDay } from "@/lib/categories";
import { defaultTimeOfDay } from "@/lib/categories";
import type { ParsedLead } from "@/lib/parse-local";

const TZ = "Asia/Jerusalem";

export interface NextActionValue {
  date: string | null; // YYYY-MM-DD (ישראל)
  time: string | null; // HH:mm
  type: ActionType | null;
  note: string;
  isApproximate: boolean;
}

export interface InitialTouchValue {
  enabled: boolean;
  type: ActionType;
  summary: string;
  durationMin: number | null;
  withWhom: string;
  outcome: string;
}

export interface LeadFormValues {
  name: string;
  descriptor: string;
  area: string;
  addressNote: string;
  lat: number | null;
  lng: number | null;
  category: string;
  bestTimeOfDay: TimeOfDay;
  contactName: string;
  contactRole: string;
  phone: string;
  email: string;
  website: string;
  status: LeadStatus;
  heat: Heat;
  next: NextActionValue;
  observation: string;
  painPoints: string;
  currentTools: string;
  notes: string;
  closedReason: string;
  initialTouch: InitialTouchValue;
}

export const emptyNext = (): NextActionValue => ({ date: null, time: null, type: null, note: "", isApproximate: false });

export function emptyLeadForm(): LeadFormValues {
  return {
    name: "",
    descriptor: "",
    area: "",
    addressNote: "",
    lat: null,
    lng: null,
    category: "",
    bestTimeOfDay: "ANY",
    contactName: "",
    contactRole: "",
    phone: "",
    email: "",
    website: "",
    status: "NEW",
    heat: "WARM",
    next: emptyNext(),
    observation: "",
    painPoints: "",
    currentTools: "",
    notes: "",
    closedReason: "",
    initialTouch: { enabled: false, type: "VISIT", summary: "", durationMin: null, withWhom: "", outcome: "" },
  };
}

export function parsedToForm(p: ParsedLead, raw: string): LeadFormValues {
  const f = emptyLeadForm();
  f.name = p.name ?? "";
  f.descriptor = p.descriptor ?? "";
  f.area = p.area ?? "";
  f.addressNote = p.addressNote ?? "";
  f.category = p.category ?? "";
  f.bestTimeOfDay = p.bestTimeOfDay ?? defaultTimeOfDay(p.category);
  f.contactName = p.contactName ?? "";
  f.contactRole = p.contactRole ?? "";
  f.phone = p.phone ?? "";
  f.email = p.email ?? "";
  f.status = p.status;
  f.heat = p.heat;
  f.next = { date: p.nextActionDate, time: p.nextActionTime, type: p.nextActionType, note: p.nextActionNote ?? "", isApproximate: p.nextActionIsApproximate };
  f.observation = p.observation ?? "";
  f.painPoints = p.painPoints ?? "";
  f.currentTools = p.currentTools ?? "";
  f.initialTouch = { enabled: true, type: "VISIT", summary: p.touchSummary ?? raw, durationMin: p.durationMin, withWhom: p.contactName ?? "", outcome: "" };
  return f;
}

export interface LeadLike {
  name: string | null;
  descriptor: string | null;
  area: string | null;
  addressNote: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  bestTimeOfDay: string;
  contactName: string | null;
  contactRole: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: string;
  heat: string;
  nextActionAt: Date | string | null;
  nextActionType: string | null;
  nextActionNote: string | null;
  nextActionIsApproximate: boolean;
  observation: string | null;
  painPoints: string | null;
  currentTools: string | null;
  notes: string | null;
  closedReason: string | null;
}

export function instantToNext(at: Date | string | null, type: string | null, note: string | null, approx: boolean): NextActionValue {
  if (!at) return emptyNext();
  const d = typeof at === "string" ? new Date(at) : at;
  const time = formatInTimeZone(d, TZ, "HH:mm");
  return { date: formatInTimeZone(d, TZ, "yyyy-MM-dd"), time: time === "00:00" ? null : time, type: (type as ActionType) ?? null, note: note ?? "", isApproximate: approx };
}

export function leadToForm(l: LeadLike): LeadFormValues {
  const f = emptyLeadForm();
  f.name = l.name ?? "";
  f.descriptor = l.descriptor ?? "";
  f.area = l.area ?? "";
  f.addressNote = l.addressNote ?? "";
  f.lat = l.lat;
  f.lng = l.lng;
  f.category = l.category ?? "";
  f.bestTimeOfDay = l.bestTimeOfDay as TimeOfDay;
  f.contactName = l.contactName ?? "";
  f.contactRole = l.contactRole ?? "";
  f.phone = l.phone ?? "";
  f.email = l.email ?? "";
  f.website = l.website ?? "";
  f.status = l.status as LeadStatus;
  f.heat = l.heat as Heat;
  f.next = instantToNext(l.nextActionAt, l.nextActionType, l.nextActionNote, l.nextActionIsApproximate);
  f.observation = l.observation ?? "";
  f.painPoints = l.painPoints ?? "";
  f.currentTools = l.currentTools ?? "";
  f.notes = l.notes ?? "";
  f.closedReason = l.closedReason ?? "";
  return f;
}

export function nextToIso(n: NextActionValue): string | null {
  if (!n.date) return null;
  return fromZonedTime(`${n.date}T${n.time ?? "00:00"}:00`, TZ).toISOString();
}

const t = (s: string) => (s.trim() ? s.trim() : null);

export function formToPayload(v: LeadFormValues, mode: "create" | "edit") {
  const payload: Record<string, unknown> = {
    name: t(v.name),
    descriptor: t(v.descriptor),
    area: t(v.area),
    addressNote: t(v.addressNote),
    lat: v.lat,
    lng: v.lng,
    category: t(v.category),
    bestTimeOfDay: v.bestTimeOfDay,
    contactName: t(v.contactName),
    contactRole: t(v.contactRole),
    phone: t(v.phone),
    email: t(v.email),
    website: t(v.website),
    status: v.status,
    heat: v.heat,
    nextActionAt: nextToIso(v.next),
    nextActionType: v.next.date ? (v.next.type ?? (t(v.phone) ? "CALL" : "VISIT")) : null,
    nextActionNote: v.next.date ? t(v.next.note) : null,
    nextActionIsApproximate: v.next.date ? v.next.isApproximate : false,
    observation: t(v.observation),
    painPoints: t(v.painPoints),
    currentTools: t(v.currentTools),
    notes: t(v.notes),
    closedReason: t(v.closedReason),
  };
  if (mode === "create" && v.initialTouch.enabled && v.initialTouch.summary.trim()) {
    payload.initialTouch = {
      type: v.initialTouch.type,
      summary: v.initialTouch.summary.trim(),
      durationMin: v.initialTouch.durationMin,
      withWhom: t(v.initialTouch.withWhom),
      outcome: t(v.initialTouch.outcome),
    };
  }
  return payload;
}

export function formTitle(v: LeadFormValues): string {
  return v.name.trim() || v.descriptor.trim() || "ליד";
}
