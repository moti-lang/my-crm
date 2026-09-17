/**
 * מנוע התאריכים העברי.
 * - זיהוי חגים/ערבי חג/חול המועד/שבת לפי לוח השנה העברי (לוח ישראל, @hebcal/core)
 * - תרגום ביטויים ("אחרי החג", "בעוד שבוע", "ביום חמישי") לתאריך קונקרטי
 * - התרעה על התנגשות והצעת תאריך חלופי
 *
 * הפונקציות עובדות על מחרוזות 'yyyy-MM-dd' בשעון ישראל, ומחזירות רגעים (Date) דרך dateAtIL.
 */
import { HebrewCalendar, HDate, flags } from "@hebcal/core";
import { dateAtIL, ymdIL, WEEKDAY_NAMES } from "./dates";

export type DayKind =
  | "WORKDAY"
  | "FRIDAY"
  | "SHABBAT"
  | "HOLIDAY"
  | "EREV"
  | "CHOL_HAMOED"
  | "MEMORIAL"
  | "MINOR";

export interface DayInfo {
  ymd: string;
  weekday: number; // 0=ראשון ... 6=שבת
  kind: DayKind;
  /** שם החג בעברית (ללא ניקוד) */
  holidayName?: string;
  holidayDesc?: string;
  /** block = לא לקבוע, warn = אפשר אבל כדאי לדעת */
  severity: "block" | "warn" | null;
  message?: string;
}

export interface ResolvedDate {
  ymd: string;
  date: Date;
  isApproximate: boolean;
  /** הביטוי שזוהה בטקסט */
  phrase: string;
  /** שעה HH:mm אם זוהתה */
  time?: string;
  /** הסבר (למשל: הוזז משבת ליום ראשון) */
  note?: string;
}

const NIKUD = /[֑-ׇ]/g;
export function stripNikud(s: string): string {
  return s.replace(NIKUD, "");
}

/** שמות חגים בכתיב מלא (hebcal מנוקד: "סֻכּוֹת" → "סכות" → "סוכות") */
export function prettyHolidayName(s: string): string {
  return stripNikud(s).replace(/סכות/g, "סוכות").replace(/כפור/g, "כיפור").replace(/חנכה/g, "חנוכה").replace(/שבעות/g, "שבועות");
}

// ---------- עזרי תאריכים "שטוחים" (ללא אזור זמן) ----------

function plainDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
function toYmd(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDaysYmd(ymd: string, n: number): string {
  const d = plainDate(ymd);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}
export function weekdayOfYmd(ymd: string): number {
  return plainDate(ymd).getDay();
}
export function isValidYmd(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(plainDate(ymd).getTime());
}

// ---------- מידע על יום ----------

const DAY_OFF_MODERN = ["Yom HaAtzmaut"];
const MEMORIAL_MODERN = ["Yom HaZikaron"];
const WARN_MINOR = ["Purim", "Shushan Purim", "Tish'a B'Av"];

const dayCache = new Map<string, DayInfo>();

/** מידע על יום נתון (מפתח: yyyy-MM-dd) */
export function getDayInfoYmd(ymd: string): DayInfo {
  const cached = dayCache.get(ymd);
  if (cached) return cached;

  const weekday = weekdayOfYmd(ymd);
  const evs = HebrewCalendar.getHolidaysOnDate(plainDate(ymd), true) ?? [];

  let kind: DayKind = weekday === 6 ? "SHABBAT" : weekday === 5 ? "FRIDAY" : "WORKDAY";
  let holidayName: string | undefined;
  let holidayDesc: string | undefined;
  let severity: DayInfo["severity"] = weekday === 6 ? "block" : weekday === 5 ? "warn" : null;
  let message: string | undefined = weekday === 6 ? "התאריך נופל בשבת" : weekday === 5 ? "יום שישי — יום עבודה קצר" : undefined;

  // עדיפות: חג > ערב חג > חול המועד > זיכרון > מינורי
  const rank = (k: DayKind) =>
    ({ HOLIDAY: 6, EREV: 5, CHOL_HAMOED: 4, MEMORIAL: 3, MINOR: 2, SHABBAT: 1, FRIDAY: 0, WORKDAY: -1 })[k];
  let best: { kind: DayKind; name: string; desc: string } | null = null;
  for (const ev of evs) {
    const f = ev.getFlags();
    const desc = ev.getDesc();
    const name = prettyHolidayName(ev.render("he"));
    let k: DayKind | null = null;
    if (f & flags.CHAG) k = "HOLIDAY";
    else if (f & flags.EREV) k = "EREV";
    else if (f & flags.CHOL_HAMOED) k = "CHOL_HAMOED";
    else if (f & flags.MODERN_HOLIDAY) {
      if (DAY_OFF_MODERN.some((n) => desc.startsWith(n))) k = "HOLIDAY";
      else if (MEMORIAL_MODERN.some((n) => desc.startsWith(n))) k = "MEMORIAL";
    } else if ((f & flags.MINOR_HOLIDAY || f & flags.MAJOR_FAST) && WARN_MINOR.some((n) => desc.startsWith(n))) k = "MINOR";
    if (k && (!best || rank(k) > rank(best.kind))) best = { kind: k, name, desc };
  }

  if (best) {
    holidayName = best.name;
    holidayDesc = best.desc;
    if (best.kind === "HOLIDAY") {
      kind = "HOLIDAY";
      severity = "block";
      message = `התאריך נופל ב${best.name}`;
    } else if (best.kind === "EREV" && weekday !== 6) {
      kind = "EREV";
      severity = "block";
      message = `ערב חג (${best.name}) — יום קצר, רוב העסקים סגורים מוקדם`;
    } else if (best.kind === "CHOL_HAMOED" && weekday !== 6) {
      kind = "CHOL_HAMOED";
      severity = "warn";
      message = `חול המועד (${best.name}) — עסקים רבים סגורים או עובדים חלקית`;
    } else if (best.kind === "MEMORIAL" && weekday !== 6) {
      kind = "MEMORIAL";
      severity = "warn";
      message = `${best.name} — יום עבודה חלקי`;
    } else if (best.kind === "MINOR" && weekday !== 6) {
      kind = "MINOR";
      severity = "warn";
      message = `${best.name} — עסקים רבים סגורים`;
    }
  }

  const info: DayInfo = { ymd, weekday, kind, holidayName, holidayDesc, severity, message };
  dayCache.set(ymd, info);
  return info;
}

export function getDayInfo(d: Date): DayInfo {
  return getDayInfoYmd(ymdIL(d));
}

/** יום עבודה מלא (א׳–ה׳, בלי חג/ערב חג/חול המועד/זיכרון) */
export function isFullWorkdayYmd(ymd: string): boolean {
  return getDayInfoYmd(ymd).kind === "WORKDAY";
}

/** יום העבודה המלא הראשון שהוא >= התאריך הנתון */
export function nextFullWorkdayYmd(ymd: string, includeSelf = true): string {
  let cur = includeSelf ? ymd : addDaysYmd(ymd, 1);
  for (let i = 0; i < 60; i++) {
    if (isFullWorkdayYmd(cur)) return cur;
    cur = addDaysYmd(cur, 1);
  }
  return cur;
}

/** יום העבודה המלא האחרון שהוא <= התאריך הנתון */
export function prevFullWorkdayYmd(ymd: string, includeSelf = true): string {
  let cur = includeSelf ? ymd : addDaysYmd(ymd, -1);
  for (let i = 0; i < 60; i++) {
    if (isFullWorkdayYmd(cur)) return cur;
    cur = addDaysYmd(cur, -1);
  }
  return cur;
}

export interface DateConflict {
  level: "block" | "warn";
  message: string;
  suggestion: Date;
  suggestionYmd: string;
}

/** התרעה על התנגשות (שבת/חג/ערב חג/חול המועד) + הצעת תאריך חלופי */
export function checkDateConflict(d: Date): DateConflict | null {
  const info = getDayInfo(d);
  if (!info.severity) return null;
  const suggestionYmd = nextFullWorkdayYmd(info.ymd, false);
  return {
    level: info.severity,
    message: info.message ?? "",
    suggestion: dateAtIL(suggestionYmd),
    suggestionYmd,
  };
}

// ---------- חגים קרובים (לפרומפט ולתצוגה) ----------

export interface UpcomingHoliday {
  ymd: string;
  weekday: string;
  name: string;
  kind: DayKind;
}

/** רשימת ימים מיוחדים בטווח (ללא שבתות/שישי רגילים) */
export function upcomingSpecialDays(fromYmd: string, days = 90): UpcomingHoliday[] {
  const out: UpcomingHoliday[] = [];
  let cur = fromYmd;
  for (let i = 0; i < days; i++) {
    const info = getDayInfoYmd(cur);
    if (info.holidayName && info.kind !== "WORKDAY" && info.kind !== "FRIDAY" && info.kind !== "SHABBAT") {
      out.push({ ymd: cur, weekday: WEEKDAY_NAMES[info.weekday], name: info.holidayName, kind: info.kind });
    }
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

// ---------- גושי חגים ----------

const CLOSED_KINDS: DayKind[] = ["HOLIDAY", "EREV", "CHOL_HAMOED", "SHABBAT"];

function isClosedKind(ymd: string): boolean {
  return CLOSED_KINDS.includes(getDayInfoYmd(ymd).kind);
}

/** סוף גוש החג (כולל חול המועד/שבת צמודים) שמתחיל ב-ymd — מחזיר את היום האחרון הסגור */
function endOfClosedBlock(ymd: string): string {
  let cur = ymd;
  for (let i = 0; i < 15; i++) {
    const next = addDaysYmd(cur, 1);
    if (!isClosedKind(next)) return cur;
    cur = next;
  }
  return cur;
}

/** החג (יום טוב) הבא החל מתאריך, כולל ערב החג שלפניו אם קיים */
export function nextHolidayBlock(fromYmd: string): { start: string; end: string; name: string } | null {
  let cur = fromYmd;
  for (let i = 0; i < 400; i++) {
    const info = getDayInfoYmd(cur);
    if (info.kind === "HOLIDAY" || info.kind === "EREV" || info.kind === "CHOL_HAMOED") {
      // ודא שהגוש מכיל יום טוב אמיתי
      const end = endOfClosedBlock(cur);
      let name = info.holidayName ?? "חג";
      let probe = cur;
      let hasChag = false;
      while (probe <= end) {
        const pi = getDayInfoYmd(probe);
        if (pi.kind === "HOLIDAY") {
          hasChag = true;
          name = pi.holidayName ?? name;
          break;
        }
        probe = addDaysYmd(probe, 1);
      }
      if (hasChag) return { start: cur, end, name };
      cur = addDaysYmd(end, 1);
      continue;
    }
    cur = addDaysYmd(cur, 1);
  }
  return null;
}

const NAMED_HOLIDAYS: Array<{ re: RegExp; descs: string[]; label: string }> = [
  { re: /ראש השנה/, descs: ["Rosh Hashana"], label: "ראש השנה" },
  { re: /(יום )?(ה)?כיפור(ים)?/, descs: ["Yom Kippur"], label: "יום כיפור" },
  { re: /סוכות|שמחת תורה|שמיני עצרת/, descs: ["Sukkot", "Shmini Atzeret"], label: "סוכות" },
  { re: /חנוכה/, descs: ["Chanukah"], label: "חנוכה" },
  { re: /פורים/, descs: ["Purim"], label: "פורים" },
  { re: /פסח/, descs: ["Pesach"], label: "פסח" },
  { re: /יום העצמאות/, descs: ["Yom HaAtzmaut"], label: "יום העצמאות" },
  { re: /שבועות/, descs: ["Shavuot"], label: "שבועות" },
];

/** מציאת ההופעה הבאה של חג לפי שם (מזהה hebcal), מחזיר את היום הראשון והאחרון של הגוש */
export function findNamedHoliday(fromYmd: string, descs: string[]): { start: string; end: string } | null {
  let cur = fromYmd;
  for (let i = 0; i < 400; i++) {
    const info = getDayInfoYmd(cur);
    const desc = info.holidayDesc ?? "";
    if (desc && descs.some((d) => desc.startsWith(d)) && info.kind !== "FRIDAY" && info.kind !== "WORKDAY") {
      // התחלה: היום הזה; סוף: כל הימים הרצופים עם אותו שם (כולל חול המועד/שמיני עצרת)
      let end = cur;
      let probe = addDaysYmd(cur, 1);
      for (let j = 0; j < 12; j++) {
        const pi = getDayInfoYmd(probe);
        const pd = pi.holidayDesc ?? "";
        if (pd && descs.some((d) => pd.startsWith(d))) end = probe;
        else if (pi.kind === "SHABBAT" && j < 9) {
          // שבת באמצע הגוש — ממשיכים לבדוק
        } else break;
        probe = addDaysYmd(probe, 1);
      }
      return { start: cur, end };
    }
    cur = addDaysYmd(cur, 1);
  }
  return null;
}

// ---------- פירוש ביטויים ----------

const NUM_WORDS: Record<string, number> = {
  "יום אחד": 1,
  יומיים: 2,
  שני: 2,
  שניים: 2,
  שלושה: 3,
  שלוש: 3,
  ארבעה: 4,
  ארבע: 4,
  חמישה: 5,
  חמש: 5,
  שישה: 6,
  שש: 6,
  שבעה: 7,
  שבע: 7,
  שמונה: 8,
  תשעה: 9,
  תשע: 9,
  עשרה: 10,
  עשר: 10,
  כמה: 3,
};

const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/ב?יום ראשון|ביום א['׳]|יום א['׳]|(?<![א-ת])בראשון(?![א-ת])/, 0],
  [/ב?יום שני|ביום ב['׳]|יום ב['׳]/, 1],
  [/ב?יום שלישי|ביום ג['׳]|יום ג['׳]|(?<![א-ת])בשלישי(?![א-ת])/, 2],
  [/ב?יום רביעי|ביום ד['׳]|יום ד['׳]|(?<![א-ת])ברביעי(?![א-ת])/, 3],
  [/ב?יום חמישי|ביום ה['׳]|יום ה['׳]|(?<![א-ת])בחמישי(?![א-ת])/, 4],
  [/ב?יום שישי|ביום ו['׳]|יום ו['׳]|(?<![א-ת])בשישי(?![א-ת])/, 5],
  [/בשבת|ב?יום שבת/, 6],
];

export function normalizeHebrewText(s: string): string {
  return stripNikud(s)
    .replace(/[’'`]/g, "'")
    .replace(/[״"]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function num(word: string): number {
  if (/^\d+$/.test(word)) return Number(word);
  return NUM_WORDS[word] ?? 0;
}

function extractTime(text: string): string | undefined {
  const m = text.match(/(?:בשעה|ב-|ב)\s?(\d{1,2})(?::(\d{2}))?(?!\d|[./-])/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mm = m[2] ?? "00";
  if (h > 23 || Number(mm) > 59) return undefined;
  // "ב-24 לחודש" → לא שעה
  if (/לחודש/.test(text.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 8))) return undefined;
  if (!m[2] && !/בשעה/.test(m[0]) && h > 21) return undefined;
  if (!m[2] && !/בשעה/.test(m[0])) return undefined; // בלי דקות דורשים "בשעה"
  return `${h < 10 ? "0" : ""}${h}:${mm}`;
}

/** התוצאה כרגע (Date) של יום מסוים בשעון ישראל */
function finalize(
  ymd: string,
  phrase: string,
  isApproximate: boolean,
  time?: string,
  extraNote?: string,
): ResolvedDate {
  let target = ymd;
  let note = extraNote;
  const info = getDayInfoYmd(target);
  if (info.severity === "block") {
    const shifted = nextFullWorkdayYmd(target, false);
    note = `${note ? note + ". " : ""}הוזז מ-${WEEKDAY_NAMES[info.weekday]} (${info.message}) ליום ${WEEKDAY_NAMES[weekdayOfYmd(shifted)]}`;
    target = shifted;
  }
  return { ymd: target, date: dateAtIL(target, time ?? "00:00"), isApproximate, phrase, time, note };
}

/**
 * תרגום ביטוי זמן בעברית לתאריך. מחזיר null אם לא זוהה ביטוי.
 * @param text הטקסט החופשי
 * @param now רגע הייחוס (ברירת מחדל: עכשיו)
 */
export function resolveDateExpression(text: string, now: Date = new Date()): ResolvedDate | null {
  const t = normalizeHebrewText(text);
  const today = ymdIL(now);
  const time = extractTime(t);
  let m: RegExpMatchArray | null;

  // אחרי החגים (תשרי)
  if ((m = t.match(/אחרי החגים/))) {
    const st = findNamedHoliday(today, ["Shmini Atzeret", "Simchat Torah"]);
    if (st) return finalize(nextFullWorkdayYmd(st.end, false), m[0], true);
  }

  // בין כיפור לסוכות
  if ((m = t.match(/בין (יום )?כיפור לסוכות/))) {
    const yk = findNamedHoliday(today, ["Yom Kippur"]);
    if (yk) return finalize(nextFullWorkdayYmd(yk.end, false), m[0], true);
  }

  // אחרי <חג בשם>
  for (const h of NAMED_HOLIDAYS) {
    const re = new RegExp(`(אחרי|לאחר|למחרת) (ה)?(${h.re.source})`);
    if ((m = t.match(re))) {
      const block = findNamedHoliday(today, h.descs);
      if (block) {
        const end = endOfClosedBlock(block.end);
        return finalize(nextFullWorkdayYmd(end, false), m[0], true);
      }
    }
  }

  // לפני החג
  if ((m = t.match(/לפני (ה)?חג/))) {
    const block = nextHolidayBlock(today);
    if (block) return finalize(prevFullWorkdayYmd(block.start, false), m[0], true);
  }

  // אחרי החג / למחרת החג
  if ((m = t.match(/(אחרי|לאחר|למחרת) (ה)?חג(?![א-ת])/))) {
    const block = nextHolidayBlock(today);
    if (block) return finalize(nextFullWorkdayYmd(block.end, false), m[0], true);
  }

  // אחרי שבת / מוצ"ש
  if ((m = t.match(/אחרי (ה)?שבת|מוצ"ש|מוצאי שבת/))) {
    const wd = weekdayOfYmd(today);
    const daysToSunday = ((7 - wd) % 7) || 7;
    return finalize(addDaysYmd(today, daysToSunday), m[0], false, time);
  }

  // מחרתיים / מחר
  if ((m = t.match(/מחרתיים/))) return finalize(addDaysYmd(today, 2), m[0], false, time);
  if ((m = t.match(/(?<![א-ת])מחר(?![א-ת])/))) return finalize(addDaysYmd(today, 1), m[0], false, time);

  // בעוד X ימים / יומיים / שבוע / שבועיים / חודש / חודשיים / חצי שנה / שנה
  if ((m = t.match(/בעוד (\d+|[א-ת]+) ימים/))) {
    const n = num(m[1]);
    if (n > 0) return finalize(addDaysYmd(today, n), m[0], m[1] === "כמה", time);
  }
  if ((m = t.match(/בעוד יומיים|עוד יומיים/))) return finalize(addDaysYmd(today, 2), m[0], false, time);
  if ((m = t.match(/בעוד שבועיים|עוד שבועיים|שבועיים/))) return finalize(addDaysYmd(today, 14), m[0], false, time);
  if ((m = t.match(/בעוד (\d+|[א-ת]+) שבועות/))) {
    const n = num(m[1]);
    if (n > 0) return finalize(addDaysYmd(today, n * 7), m[0], m[1] === "כמה", time);
  }
  if ((m = t.match(/בעוד שבוע|עוד שבוע|בשבוע הבא|שבוע הבא/))) return finalize(addDaysYmd(today, 7), m[0], false, time);
  if ((m = t.match(/בעוד חודשיים|עוד חודשיים/))) return finalize(addDaysYmd(today, 60), m[0], true);
  if ((m = t.match(/בעוד (\d+|[א-ת]+) חודשים/))) {
    const n = num(m[1]);
    if (n > 0) return finalize(addDaysYmd(today, n * 30), m[0], true);
  }
  if ((m = t.match(/בעוד חצי שנה/))) return finalize(addDaysYmd(today, 182), m[0], true);
  if ((m = t.match(/בעוד שנה/))) return finalize(addDaysYmd(today, 365), m[0], true);
  if ((m = t.match(/בתחילת החודש הבא|תחילת החודש הבא/))) {
    const d = plainDate(today);
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
    return finalize(toYmd(first), m[0], true);
  }
  if ((m = t.match(/בסוף החודש|סוף החודש/))) {
    const d = plainDate(today);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    return finalize(prevFullWorkdayYmd(toYmd(last)), m[0], true);
  }
  if ((m = t.match(/בעוד חודש|עוד חודש|בחודש הבא|חודש הבא/))) return finalize(addDaysYmd(today, 30), m[0], true);
  if ((m = t.match(/בסוף השבוע|סוף השבוע|בסופ"ש|סופ"ש/))) {
    // סוף שבוע העבודה = יום חמישי
    const wd = weekdayOfYmd(today);
    const n = wd <= 4 ? 4 - wd || 7 : 4 + (7 - wd);
    return finalize(addDaysYmd(today, n), m[0], true);
  }

  // יום בשבוע
  for (const [re, wd] of WEEKDAY_WORDS) {
    if ((m = t.match(re))) {
      const cur = weekdayOfYmd(today);
      let n = (wd - cur + 7) % 7;
      if (n === 0) n = 7;
      if (/הבא|הבאה/.test(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 8)) && n < 7) {
        // "ביום חמישי הבא" — אם זה השבוע הנוכחי, קפוץ לשבוע הבא
        const daysLeftThisWeek = 6 - cur;
        if (n <= daysLeftThisWeek) n += 7;
      }
      return finalize(addDaysYmd(today, n), m[0], false, time);
    }
  }

  // תאריך מפורש: 24.9 / 24/9 / 24.9.26 / 24.9.2026
  if ((m = t.match(/(?<![\d./])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d./])/))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let y = m[3] ? Number(m[3]) : plainDate(today).getFullYear();
      if (y < 100) y += 2000;
      let cand = new Date(y, mo - 1, d, 12);
      if (!m[3] && toYmd(cand) < today) cand = new Date(y + 1, mo - 1, d, 12);
      return finalize(toYmd(cand), m[0], false, time);
    }
  }

  // ב-24 לחודש
  if ((m = t.match(/ב-?(\d{1,2}) לחודש/))) {
    const d = Number(m[1]);
    const base = plainDate(today);
    let cand = new Date(base.getFullYear(), base.getMonth(), d, 12);
    if (toYmd(cand) < today) cand = new Date(base.getFullYear(), base.getMonth() + 1, d, 12);
    return finalize(toYmd(cand), m[0], false, time);
  }

  return null;
}

/** היום הראשון שאפשר לעבוד בו (לא שבת/חג/ערב חג; שישי וחול המועד מותרים) */
export function nextOpenDayYmd(ymd: string, includeSelf = true): string {
  let cur = includeSelf ? ymd : addDaysYmd(ymd, 1);
  for (let i = 0; i < 60; i++) {
    if (getDayInfoYmd(cur).severity !== "block") return cur;
    cur = addDaysYmd(cur, 1);
  }
  return cur;
}

/** "הבטיח לחזור אליי" → יום-יומיים אחרי מה שהבטיחו (מדלג רק על שבת/חג/ערב חג) */
export function afterPromiseBuffer(ymd: string): string {
  return nextOpenDayYmd(addDaysYmd(ymd, 1));
}

export const PROMISE_RE = /(יחזור|תחזור|יחזרו|אחזור|מבטיח|מבטיחה|הבטיח|הבטיחה|יתקשר|תתקשר|יתקשרו|ידבר איתי|יעדכן|תעדכן|יחזרו אליי|יחזור אליי)/;

/** תאריך עברי לתצוגה: "ו׳ בתשרי תשפ״ז" */
export function hebrewDateLabel(d: Date): string {
  const hd = new HDate(plainDate(ymdIL(d)));
  return stripNikud(hd.renderGematriya(true));
}
