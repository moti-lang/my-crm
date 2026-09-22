/**
 * פירוק מקומי של טקסט חופשי (ללא Claude) + עיבוד-אחרי משותף.
 * קובץ זה נקי מתלויות שרת כדי שיוכל לרוץ גם בדפדפן במצב אופליין.
 */
import { z } from "zod";
import { ACTION_TYPES, HEATS, KNOWN_CATEGORIES, LEAD_STATUSES, TIMES_OF_DAY, defaultTimeOfDay, type ActionType } from "./categories";
import { dateAtIL, ymdIL } from "./dates";
import {
  DEFAULT_CALENDAR_SETTINGS,
  PROMISE_RE,
  addDaysYmd,
  afterPromiseBuffer,
  checkDateConflict,
  getDayInfoYmd,
  isValidYmd,
  nextFullWorkdayYmd,
  normalizeHebrewText,
  resolveDateExpression,
  type CalendarSettings,
} from "./hebrew-dates";
import { normalizePhone } from "./phone";

export const ParsedLeadSchema = z.object({
  name: z.string().nullable().describe("שם העסק, רק אם נאמר במפורש"),
  descriptor: z.string().nullable().describe("תיאור מזהה קצר: 'נגריה', 'משרד עו\"ד בקומה 2'"),
  area: z.string().nullable().describe("רחוב/אזור ראשי"),
  addressNote: z.string().nullable().describe("פרטי מיקום נוספים: בניין, קומה, ליד מה"),
  category: z.string().nullable().describe("תחום העסק במילה-שתיים"),
  bestTimeOfDay: z.enum(TIMES_OF_DAY).describe("MORNING לתעשייה/בתי מלאכה, AFTERNOON לקמעונאות, אחרת ANY"),
  contactName: z.string().nullable(),
  contactRole: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  observation: z.string().nullable().describe("מה ראיתי בעסק"),
  painPoints: z.string().nullable(),
  currentTools: z.string().nullable().describe("במה הם עובדים היום"),
  heat: z.enum(HEATS),
  status: z.enum(LEAD_STATUSES),
  nextActionType: z.enum(ACTION_TYPES).nullable(),
  nextActionDate: z.string().nullable().describe("YYYY-MM-DD"),
  nextActionTime: z.string().nullable().describe("HH:mm רק אם נאמרה שעה"),
  nextActionIsApproximate: z.boolean(),
  nextActionNote: z.string().nullable(),
  dateExpression: z.string().nullable().describe("ביטוי הזמן המקורי מהטקסט"),
  touchSummary: z.string().nullable().describe("סיכום המגע במשפט-שניים"),
  durationMin: z.number().nullable(),
});
export type ParsedLead = z.infer<typeof ParsedLeadSchema>;

export interface ParseResult {
  lead: ParsedLead;
  source: "claude" | "local";
  warnings: string[];
  dateConflict: { level: "block" | "warn"; message: string; suggestionYmd: string } | null;
  error?: string;
}

// ---------- מפרש מקומי ----------

const CATEGORY_STEMS: Array<[RegExp, string]> = [
  [/נגר/, "נגרייה"],
  [/מסגר/, "מסגרייה"],
  [/מוסך|מכונא/, "מוסך"],
  [/פחח/, "פחחות וצבע"],
  [/הסע/, "הסעות"],
  [/הובל/, "הובלות"],
  [/חלפים/, "יבוא חלפים"],
  [/דפוס/, "דפוס"],
  [/אלומיניום/, "אלומיניום"],
  [/חשמל/, "חשמל"],
  [/מזגנ|מיזוג/, "מיזוג אוויר"],
  [/אינסטל/, "אינסטלציה"],
  [/שיפוצ/, "שיפוצים"],
  [/קבלן/, "קבלן בניין"],
  [/מטבח/, "מטבחים"],
  [/רהיט/, "רהיטים"],
  [/שיש/, "שיש"],
  [/זכוכית/, "זכוכית"],
  [/צמיג/, "צמיגים"],
  [/מחסן|לוגיסט/, "מחסן / לוגיסטיקה"],
  [/סיטונא/, "סיטונאות"],
  [/מסעד/, "מסעדה"],
  [/בית קפה|קפה/, "בית קפה"],
  [/מספר/, "מספרה"],
  [/קוסמט/, "קוסמטיקה"],
  [/אופנ|בגדים|בוטיק/, "אופנה"],
  [/מכולת|סופר/, "מכולת / סופר"],
  [/חנות/, "חנות"],
  [/עו"ד|עורך דין|עורכי דין/, "עורכי דין"],
  [/רו"ח|רואה חשבון|רואי חשבון/, "רואי חשבון"],
  [/קליניק|רופא|מרפאה/, "קליניקה"],
  [/משרד/, "משרד"],
  [/מפעל|ייצור|יצור/, "ייצור"],
];

const STOP_WORDS = new Set(["דיברתי", "שוחחתי", "פגשתי", "יש", "אין", "הבטיח", "הבטיחה", "מבטיח", "מבטיחה", "ישב", "ישבה", "ראיתי", "אמר", "אמרה", "רוצה", "רוצים", "ביקש", "ביקשה", "קבענו", "נדבר", "לחזור", "יחזור", "תחזור"]);

function extractArea(t: string): { area: string | null; addressNote: string | null; descriptor: string | null } {
  const m = t.match(/(רחוב|רח'|שדרות|שד'|אזור|איזור|מתחם|קניון|צומת|דרך|ככר|כיכר) ([א-ת'"]+)( [א-ת'"]+)?/);
  let area: string | null = null;
  if (m) {
    const prefix = m[1].replace("רח'", "רחוב").replace("שד'", "שדרות").replace("איזור", "אזור");
    const w1 = m[2];
    const w2 = m[3]?.trim();
    const words = [w1];
    if (w2 && !STOP_WORDS.has(w2) && !/^(ב|ל|ש|ו)[א-ת]{3,}$/.test(w2) && !/^ליד$/.test(w2) && !/^עם$/.test(w2)) words.push(w2);
    area = ["אזור", "מתחם", "קניון", "צומת", "ככר", "כיכר"].includes(prefix) ? `${prefix} ${words.join(" ")}` : `${prefix} ${words.join(" ")}`;
  }
  // הערת מיקום: "בניין X", "קומה N", "ליד X"
  const addr: string[] = [];
  const b = t.match(/(בניין [א-ת'"]+( [א-ת'"]+)?|קומה [א-ת0-9-]+|קומת [א-ת]+|מול [א-ת'"]+|ליד ה?[א-ת'"]+(?! רחוב))/g);
  if (b) for (const x of b) if (!x.includes("רחוב") && !STOP_WORDS.has(x.split(" ")[1] ?? "")) addr.push(x);
  // תיאור: המילים לפני סימן המיקום הראשון
  const cut = t.search(/ (ליד|ברחוב|ברח'|באזור|באיזור|בשדרות|במתחם|בקניון|רחוב|דיברתי|שוחחתי|פגשתי|,|\.|-|–)/);
  let descriptor = (cut > 0 ? t.slice(0, cut) : t).trim();
  descriptor = descriptor.split(" ").slice(0, 6).join(" ").replace(/[,.]$/, "");
  if (!descriptor) descriptor = t.split(" ").slice(0, 4).join(" ");
  return { area, addressNote: addr.length ? addr.join(", ") : null, descriptor: descriptor || null };
}

function extractContact(t: string): { contactName: string | null; contactRole: string | null } {
  const roleRe = /(בעל הבית|בעלת הבית|הבעלים|בעלים|בעל העסק|בעלת העסק|מנהלת|מנהל|פקידה|מזכירה|שותף|שותפה|אחראי|אחראית)/;
  const m = t.match(/(?:דיברתי|שוחחתי|ישבתי|נפגשתי) עם ([א-ת]{2,})( ([א-ת]{2,}))?/) || t.match(/פגשתי את ([א-ת]{2,})( ([א-ת]{2,}))?/);
  let contactName: string | null = null;
  let contactRole: string | null = null;
  if (m) {
    const first = m[1];
    const second = m[3];
    if (roleRe.test(first)) contactRole = first;
    else contactName = first.replace(/^ה/, (x) => x);
    if (second) {
      if (roleRe.test(second)) contactRole = second;
      else if (contactName && !STOP_WORDS.has(second) && !/^(ש|ו|כש|מ)[א-ת]+/.test(second)) contactName = `${contactName} ${second}`;
    }
  }
  if (!contactRole) {
    const r = t.match(roleRe);
    if (r) contactRole = r[1];
  }
  if (contactName && STOP_WORDS.has(contactName)) contactName = null;
  return { contactName, contactRole };
}

function extractDuration(t: string): number | null {
  let m: RegExpMatchArray | null;
  if (/שעה וחצי/.test(t)) return 90;
  if (/חצי שעה/.test(t)) return 30;
  if (/רבע שעה/.test(t)) return 15;
  if ((m = t.match(/(\d+) דקות/))) return Number(m[1]);
  if ((m = t.match(/(שתי|שני|שלוש|ארבע) שעות/))) return { שתי: 2, שני: 2, שלוש: 3, ארבע: 4 }[m[1]]! * 60;
  if (/(?<![א-ת])שעה(?![א-ת])/.test(t) && !/בשעה/.test(t)) return 60;
  return null;
}

function sentencesMatching(t: string, re: RegExp): string | null {
  const parts = t.split(/[.,;\n]| ו(?=ראיתי)/).map((s) => s.trim()).filter(Boolean);
  const hits = parts.filter((p) => re.test(p));
  return hits.length ? hits.join(". ") : null;
}

export function localParse(raw: string, now = new Date(), settings: CalendarSettings = DEFAULT_CALENDAR_SETTINGS): ParsedLead {
  const t = normalizeHebrewText(raw);
  const today = ymdIL(now);

  const noPhone = /(אין|בלי|ללא) (טלפון|מספר|נייד)/.test(t);
  const phoneMatch = noPhone ? null : t.match(/(?:\+972|972|0)(?:[-\s]?\d){8,9}/);
  const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : null;
  const emailMatch = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);

  const { area, addressNote, descriptor } = extractArea(t);
  const { contactName, contactRole } = extractContact(t);
  const feminine = /מבטיחה|הבטיחה|תחזור|תתקשר|אמרה|תעדכן|ישבה|ביקשה/.test(t);

  let category: string | null = null;
  for (const [re, label] of CATEGORY_STEMS) {
    if (re.test(t)) {
      category = label;
      break;
    }
  }
  if (!category) {
    const known = KNOWN_CATEGORIES.find((c) => t.includes(c.split(" ")[0]));
    if (known) category = known;
  }

  const durationMin = extractDuration(t);
  const hot = /ישב איתי|ישבה איתי|ביקש (הצעה|מסמך|חומר|מחיר)|ביקשה (הצעה|מסמך|חומר|מחיר)|קבע(נו|תי)? (פגישה|תאריך)|מעוניין מאוד|מעוניינת מאוד|רוצה להתקדם|רוצים להתקדם|רוצה הצעה/.test(t) || (durationMin ?? 0) >= 20;
  const cold = /ביקור נימוס|לא מעוניין|לא מעוניינת|לא רלוונטי|לא היה זמן|לא פנוי|רק הצצתי|לא נכנסתי/.test(t);
  const heat = hot ? "HOT" : cold ? "COLD" : "WARM";

  const promise = PROMISE_RE.test(t);
  const scheduled = /קבע(נו|תי)? (פגישה|תאריך|ל)|נקבע(ה)? (פגישה|ל)/.test(t);
  const lost = /לא רלוונטי|לא מעוניין בכלל|לא מעוניינת בכלל|סגרו את העסק|נסגר/.test(t);
  const parked = /לא עכשיו|בעוד כמה חודשים|אולי בעתיד|אחרי החגים/.test(t) && !promise && !scheduled;
  const toClarify = /לא ברור|לא הבנתי|צריך לברר|לברר מה/.test(t);
  const status = lost ? "LOST" : scheduled ? "SCHEDULED" : promise ? "WAITING_THEM" : parked ? "PARKED" : toClarify ? "TO_CLARIFY" : "NEW";

  let nextActionType: ActionType = phone ? "CALL" : "VISIT";
  if (!phone) nextActionType = "VISIT";
  else if (/וואטסאפ|ווצאפ|הודעה/.test(t)) nextActionType = "WHATSAPP";
  else if (/פגישה/.test(t)) nextActionType = "MEETING";
  else if (/לקפוץ|להיכנס|לעבור|לחזור אליהם|לבקר/.test(t)) nextActionType = "VISIT";

  const resolved = resolveDateExpression(t, now, settings);
  let nextActionDate: string | null = null;
  let nextActionIsApproximate = false;
  let nextActionNote: string | null = null;
  let dateExpression: string | null = resolved?.phrase ?? null;
  const verbGo = nextActionType === "VISIT" ? "לקפוץ" : nextActionType === "MEETING" ? "להיפגש" : "להתקשר";
  const who = contactName ?? (feminine ? "היא" : "הוא");
  if (resolved) {
    if (promise) {
      nextActionDate = afterPromiseBuffer(resolved.ymd, settings);
      nextActionIsApproximate = resolved.isApproximate;
      nextActionNote = `${who} ${feminine ? "הבטיחה" : "הבטיח"} לחזור ${resolved.phrase} — ${verbGo} אם לא ${feminine ? "חזרה" : "חזר"}`;
    } else {
      nextActionDate = resolved.ymd;
      nextActionIsApproximate = resolved.isApproximate;
      nextActionNote = scheduled ? `נקבע ${resolved.phrase}` : `${verbGo} ${resolved.phrase}`;
    }
  } else if (promise) {
    nextActionDate = nextFullWorkdayYmd(addDaysYmd(today, 3));
    nextActionIsApproximate = true;
    nextActionNote = `${who} ${feminine ? "הבטיחה" : "הבטיח"} לחזור אליי — ${verbGo} אם לא ${feminine ? "חזרה" : "חזר"}`;
    dateExpression = null;
  } else if (status === "NEW" || status === "TO_CLARIFY") {
    nextActionDate = nextFullWorkdayYmd(addDaysYmd(today, 7));
    nextActionIsApproximate = true;
    nextActionNote = "מעקב ברירת מחדל — לקפוץ שוב";
  }

  const seen = t.match(/ראיתי (.+?)(?=[.,;\n]| דיברתי| שוחחתי| פגשתי| הבטיח| מבטיח| אין טלפון| יש טלפון| ישב| ישבה|$)/);
  const observation = seen
    ? `ראיתי ${seen[1].trim()}`
    : sentencesMatching(t, /יש להם|יש שם|עובדים עם|עובדים ב|משתמשים ב|ניירת|לוח מחיק|תור|בלגן|מחברת|אקסל|פנקס|כמה אנשים/);
  const painPoints = sentencesMatching(t, /כאב|בעיה|מתקש|לא מצליח|מבזבז|קשה ל|סובל|מפספס|שוכח|מאבד|לא מספיק|מעצבן/);
  const toolsMatch = t.match(/(?:עובדים (?:עם|ב)|משתמשים ב|מנהלים (?:עם|ב))([^,.]+)/);

  return {
    name: null,
    descriptor,
    area,
    addressNote,
    category,
    bestTimeOfDay: defaultTimeOfDay(category),
    contactName,
    contactRole,
    phone,
    email: emailMatch ? emailMatch[0] : null,
    observation,
    painPoints,
    currentTools: toolsMatch ? toolsMatch[1].trim() : null,
    heat,
    status,
    nextActionType,
    nextActionDate,
    nextActionTime: resolved?.time ?? null,
    nextActionIsApproximate,
    nextActionNote,
    dateExpression,
    touchSummary: raw.trim(),
    durationMin,
  };
}

// ---------- עיבוד אחרי ----------

export function postProcess(lead: ParsedLead, text: string, now: Date, settings: CalendarSettings = DEFAULT_CALENDAR_SETTINGS): { lead: ParsedLead; warnings: string[]; dateConflict: ParseResult["dateConflict"] } {
  const warnings: string[] = [];
  const out: ParsedLead = { ...lead };
  const today = ymdIL(now);

  out.phone = normalizePhone(out.phone);
  if (/(אין|בלי|ללא) (טלפון|מספר|נייד)/.test(text)) out.phone = null;
  if (!out.phone) out.nextActionType = "VISIT";
  if (!out.name?.trim() && !out.descriptor?.trim()) out.descriptor = text.trim().split(" ").slice(0, 5).join(" ");
  if (!out.bestTimeOfDay || out.bestTimeOfDay === "ANY") out.bestTimeOfDay = defaultTimeOfDay(out.category);

  // תאריך
  if (out.nextActionDate && !isValidYmd(out.nextActionDate)) {
    warnings.push(`תאריך לא תקין מהמפרש (${out.nextActionDate}) — נדרש אישור`);
    out.nextActionDate = null;
  }
  if (out.nextActionDate && out.nextActionDate < today) {
    warnings.push("התאריך שחושב כבר עבר — נא לבדוק");
  }
  if (!out.nextActionDate && out.dateExpression) {
    const r = resolveDateExpression(out.dateExpression, now, settings);
    if (r) {
      out.nextActionDate = r.ymd;
      out.nextActionIsApproximate = out.nextActionIsApproximate || r.isApproximate;
      if (r.time && !out.nextActionTime) out.nextActionTime = r.time;
    }
  }
  if (out.nextActionTime && !/^\d{2}:\d{2}$/.test(out.nextActionTime)) out.nextActionTime = null;

  let dateConflict: ParseResult["dateConflict"] = null;
  if (out.nextActionDate) {
    const info = getDayInfoYmd(out.nextActionDate, settings);
    if (info.severity === "block") {
      const shifted = nextFullWorkdayYmd(out.nextActionDate, false);
      warnings.push(`${info.message} — הוזז ל-${shifted}`);
      out.nextActionDate = shifted;
    }
    const c = checkDateConflict(dateAtIL(out.nextActionDate), settings);
    if (c) dateConflict = { level: c.level, message: c.message, suggestionYmd: c.suggestionYmd };
  }
  return { lead: out, warnings, dateConflict };
}

