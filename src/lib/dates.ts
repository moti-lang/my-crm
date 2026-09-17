/**
 * עזרי תאריכים — כל הנתונים נשמרים UTC, כל החישובים "היום/מחר/שבוע" נעשים לפי שעון ישראל.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays as dfAddDays, differenceInCalendarDays } from "date-fns";
import { he } from "date-fns/locale";

export const TZ = "Asia/Jerusalem";

/** 'yyyy-MM-dd' לפי שעון ישראל */
export function ymdIL(d: Date = new Date()): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

/** 'HH:mm' לפי שעון ישראל */
export function hmIL(d: Date): string {
  return formatInTimeZone(d, TZ, "HH:mm");
}

/** רגע מדויק מתוך תאריך (ושעה) בשעון ישראל */
export function dateAtIL(ymd: string, hm: string = "00:00"): Date {
  return fromZonedTime(`${ymd}T${hm}:00`, TZ);
}

/** תחילת היום (00:00 ישראל) של הרגע הנתון */
export function startOfDayIL(d: Date = new Date()): Date {
  return dateAtIL(ymdIL(d));
}

/** תחילת היום הבא */
export function endOfDayIL(d: Date = new Date()): Date {
  return addDaysIL(startOfDayIL(d), 1);
}

/** הוספת ימים קלנדריים לפי שעון ישראל (שומר על שעת היום) */
export function addDaysIL(d: Date, days: number): Date {
  const zoned = toZonedTime(d, TZ);
  const moved = dfAddDays(zoned, days);
  const ymd = formatLocalYmd(moved);
  const hm = `${pad(moved.getHours())}:${pad(moved.getMinutes())}`;
  return dateAtIL(ymd, hm);
}

/** יום בשבוע לפי שעון ישראל: 0=ראשון ... 6=שבת */
export function weekdayIL(d: Date): number {
  return Number(formatInTimeZone(d, TZ, "i")) % 7; // ISO: 1=Mon..7=Sun → 0=Sun
}

export function isSameDayIL(a: Date, b: Date): boolean {
  return ymdIL(a) === ymdIL(b);
}

/** הפרש ימים קלנדריים (ישראל) בין b ל-a. חיובי = b אחרי a */
export function diffDaysIL(a: Date, b: Date): number {
  return differenceInCalendarDays(toZonedTime(b, TZ), toZonedTime(a, TZ));
}

/** פורמט בעברית לפי שעון ישראל */
export function formatIL(d: Date, pattern: string): string {
  return formatInTimeZone(d, TZ, pattern, { locale: he });
}

export const WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "היום", "מחר", "אתמול", "יום חמישי 24.9", "לפני 3 ימים" */
export function relativeDayLabel(d: Date, now: Date = new Date()): string {
  const diff = diffDaysIL(now, d);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  if (diff === -1) return "אתמול";
  if (diff > 1 && diff < 7) return `יום ${WEEKDAY_NAMES[weekdayIL(d)]}`;
  if (diff < 0 && diff > -7) return `לפני ${-diff} ימים`;
  return formatIL(d, "d.M.yyyy");
}

/** "לפני שבועיים", "לפני חודש" — למגע אחרון */
export function agoLabel(d: Date, now: Date = new Date()): string {
  const diff = diffDaysIL(d, now);
  if (diff <= 0) return "היום";
  if (diff === 1) return "אתמול";
  if (diff < 7) return `לפני ${diff} ימים`;
  if (diff < 14) return "לפני שבוע";
  if (diff < 30) return `לפני ${Math.round(diff / 7)} שבועות`;
  if (diff < 60) return "לפני חודש";
  if (diff < 365) return `לפני ${Math.round(diff / 30)} חודשים`;
  return "לפני יותר משנה";
}

/** תאריך + שעה קצרים: "חמישי 24.9 · 10:30" */
export function shortDateTime(d: Date, allDay = true): string {
  const base = `${WEEKDAY_NAMES[weekdayIL(d)]} ${formatIL(d, "d.M")}`;
  return allDay ? base : `${base} · ${hmIL(d)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
