import type { Lead } from "@prisma/client";
import { formatIL } from "./dates";
import { actionLabel, HEAT_META, statusLabel, TIME_OF_DAY_META, type Heat, type TimeOfDay } from "./categories";
import { displayPhone } from "./phone";

const COLUMNS: Array<[string, (l: Lead) => string | number | null | undefined]> = [
  ["מזהה", (l) => l.id],
  ["שם עסק", (l) => l.name],
  ["תיאור", (l) => l.descriptor],
  ["אזור", (l) => l.area],
  ["כתובת/הערת מיקום", (l) => l.addressNote],
  ["קו רוחב", (l) => l.lat],
  ["קו אורך", (l) => l.lng],
  ["תחום", (l) => l.category],
  ["זמן ביקור מועדף", (l) => TIME_OF_DAY_META[l.bestTimeOfDay as TimeOfDay]?.short],
  ["איש קשר", (l) => l.contactName],
  ["תפקיד", (l) => l.contactRole],
  ["טלפון", (l) => displayPhone(l.phone)],
  ["טלפון (בינלאומי)", (l) => l.phone],
  ["מייל", (l) => l.email],
  ["אתר", (l) => l.website],
  ["סטטוס", (l) => statusLabel(l.status)],
  ["חום", (l) => HEAT_META[l.heat as Heat]?.label],
  ["מעקב הבא — תאריך", (l) => (l.nextActionAt ? formatIL(l.nextActionAt, "yyyy-MM-dd HH:mm") : "")],
  ["מעקב הבא — סוג", (l) => actionLabel(l.nextActionType)],
  ["מעקב הבא — הערה", (l) => l.nextActionNote],
  ["תאריך משוער", (l) => (l.nextActionIsApproximate ? "כן" : "")],
  ["מה ראיתי", (l) => l.observation],
  ["כאבים", (l) => l.painPoints],
  ["במה עובדים היום", (l) => l.currentTools],
  ["הערות", (l) => l.notes],
  ["סיבת סגירה", (l) => l.closedReason],
  ["נראה לראשונה", (l) => formatIL(l.firstSeenAt, "yyyy-MM-dd")],
  ["מגע אחרון", (l) => formatIL(l.lastTouchAt, "yyyy-MM-dd")],
  ["נוצר", (l) => formatIL(l.createdAt, "yyyy-MM-dd HH:mm")],
];

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV עם BOM כדי שאקסל יזהה עברית (UTF-8) */
export function leadsToCsv(leads: Lead[]): string {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(",")];
  for (const l of leads) lines.push(COLUMNS.map(([, fn]) => cell(fn(l))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
