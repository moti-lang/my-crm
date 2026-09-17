/**
 * תוויות, צבעים וברירות מחדל לכל ה-enums. ללא ייבוא runtime מ-@prisma/client כדי שיעבוד גם בדפדפן.
 */
export const LEAD_STATUSES = [
  "NEW",
  "TO_CLARIFY",
  "WAITING_THEM",
  "SCHEDULED",
  "DIAGNOSED",
  "PROPOSED",
  "CONTRACT",
  "WON",
  "PARKED",
  "LOST",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const HEATS = ["HOT", "WARM", "COLD"] as const;
export type Heat = (typeof HEATS)[number];

export const ACTION_TYPES = ["VISIT", "CALL", "WHATSAPP", "MEETING", "EMAIL"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const TIMES_OF_DAY = ["MORNING", "AFTERNOON", "ANY"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const STATUS_META: Record<LeadStatus, { label: string; hint: string; cls: string; active: boolean }> = {
  NEW: { label: "חדש", hint: "נרשם בשטח, לא בורר", cls: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100", active: true },
  TO_CLARIFY: { label: "לברר", hint: "לא ברור מה העסק / מה הצורך", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200", active: true },
  WAITING_THEM: { label: "מחכה להם", hint: "הבטיחו לחזור אליי", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200", active: true },
  SCHEDULED: { label: "נקבע תאריך", hint: "יש תאריך קבוע", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200", active: true },
  DIAGNOSED: { label: "אחרי אבחון", hint: "נעשתה פגישת אבחון", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200", active: true },
  PROPOSED: { label: "הצעה נשלחה", hint: "נשלחה הצעת מחיר", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200", active: true },
  CONTRACT: { label: "חוזה נשלח", hint: "ממתין לחתימה", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200", active: true },
  WON: { label: "נסגר", hint: "לקוח", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200", active: false },
  PARKED: { label: "מושהה", hint: "לא עכשיו — לחזור בעוד תקופה", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300", active: false },
  LOST: { label: "לא רלוונטי", hint: "ירד מהפרק", cls: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200", active: false },
};

export const HEAT_META: Record<Heat, { label: string; emoji: string; cls: string; hint: string }> = {
  HOT: { label: "חם", emoji: "🔥", cls: "bg-red-500 text-white", hint: "ישב איתי / ביקש מסמך / קבע תאריך" },
  WARM: { label: "פושר", emoji: "🌤", cls: "bg-orange-400 text-white", hint: "שיחה אמיתית, עניין" },
  COLD: { label: "קר", emoji: "❄️", cls: "bg-blue-400 text-white", hint: "ביקור נימוס" },
};

export const ACTION_META: Record<ActionType, { label: string; verb: string; emoji: string; order: number }> = {
  MEETING: { label: "פגישה", verb: "להיפגש", emoji: "🤝", order: 0 },
  CALL: { label: "טלפון", verb: "להתקשר", emoji: "📞", order: 1 },
  WHATSAPP: { label: "וואטסאפ", verb: "לשלוח וואטסאפ", emoji: "💬", order: 2 },
  EMAIL: { label: "מייל", verb: "לשלוח מייל", emoji: "✉️", order: 3 },
  VISIT: { label: "כניסה", verb: "לקפוץ", emoji: "🚶", order: 4 },
};

export const TIME_OF_DAY_META: Record<TimeOfDay, { label: string; short: string; hint: string }> = {
  MORNING: { label: "בוקר (8:00–13:00)", short: "בוקר", hint: "תעשייה ובתי מלאכה" },
  AFTERNOON: { label: "אחר הצהריים (16:00–20:00)", short: "אחה״צ", hint: "קמעונאות ומסחר" },
  ANY: { label: "כל שעה", short: "כל שעה", hint: "" },
};

/** שמות מקובלים לתחומים — להשלמה אוטומטית */
export const KNOWN_CATEGORIES = [
  "נגרייה",
  "מסגרייה",
  "מוסך",
  "פחחות וצבע",
  "הסעות",
  "הובלות",
  "יבוא חלפים",
  "סיטונאות",
  "ייצור",
  "דפוס",
  "אלומיניום",
  "חשמל",
  "מיזוג אוויר",
  "אינסטלציה",
  "שיפוצים",
  "קבלן בניין",
  "מטבחים",
  "רהיטים",
  "שיש",
  "זכוכית",
  "צמיגים",
  "מחסן / לוגיסטיקה",
  "קמעונאות",
  "חנות",
  "מסעדה",
  "בית קפה",
  "מספרה",
  "קוסמטיקה",
  "אופנה",
  "מכולת / סופר",
  "משרד",
  "עורכי דין",
  "רואי חשבון",
  "קליניקה",
  "אחר",
];

const MORNING_KEYWORDS = [
  "נגר", "מסגר", "מוסך", "פחח", "מכונא", "מלאכה", "ייצור", "יצור", "תעשי", "יבוא", "מחסן", "לוגיסט",
  "הסע", "הובל", "מפעל", "דפוס", "אלומיניום", "זכוכית", "שיש", "חשמל", "אינסטל", "מזגנ", "מיזוג",
  "קבלן", "בניין", "בניה", "בנייה", "חלפים", "צמיג", "מתכת", "ריתוך", "שיפוצ", "עץ", "רהיט", "מטבח",
  "סיטונא", "ציוד", "מכונות", "משאיות", "טרקטור", "חקלא", "מסחר", "אריזה", "פלסטיק", "כימי",
];
const AFTERNOON_KEYWORDS = [
  "חנות", "קמעונ", "מסעד", "קפה", "מספר", "קוסמט", "בוטיק", "אופנ", "מכולת", "סופר", "פיצ", "פאב",
  "מזון", "טבק", "פרחים", "צעצוע", "מתנות", "ביגוד", "נעל", "תכשיט", "אופטיק", "מרקחת", "חיות", "ספרים",
  "סלולר", "מחשבים", "מאפ", "קונדיטור", "גלידה", "יופי", "ציפורניים", "ספא", "חדר כושר",
];

/** ברירת מחדל לזמן הביקור המועדף לפי הקטגוריה (כלל עסקי: תעשייה בבוקר, קמעונאות אחה״צ) */
export function defaultTimeOfDay(category?: string | null): TimeOfDay {
  if (!category) return "ANY";
  const c = category.toLowerCase();
  if (MORNING_KEYWORDS.some((k) => c.includes(k))) return "MORNING";
  if (AFTERNOON_KEYWORDS.some((k) => c.includes(k))) return "AFTERNOON";
  return "ANY";
}

export function statusLabel(s: string): string {
  return STATUS_META[s as LeadStatus]?.label ?? s;
}
export function actionLabel(a?: string | null): string {
  return a ? (ACTION_META[a as ActionType]?.label ?? a) : "";
}
export function actionEmoji(a?: string | null): string {
  return a ? (ACTION_META[a as ActionType]?.emoji ?? "") : "";
}
