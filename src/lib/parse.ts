/**
 * פירוק טקסט חופשי לליד מובנה.
 * ערוץ ראשי: Claude (structured output). גיבוי: מפרש מקומי מבוסס כללים (parse-local.ts).
 * התוצאה תמיד מוצגת למשתמש לאישור/עריכה לפני שמירה.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { formatIL, WEEKDAY_NAMES, weekdayIL, ymdIL } from "./dates";
import { hebrewDateLabel, upcomingSpecialDays } from "./hebrew-dates";
import { ParsedLeadSchema, localParse, postProcess, type ParseResult, type ParsedLead } from "./parse-local";

export { ParsedLeadSchema, localParse, postProcess } from "./parse-local";
export type { ParseResult, ParsedLead } from "./parse-local";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------- פרומפט ----------

export function buildSystemPrompt(now: Date): string {
  const today = ymdIL(now);
  const specials = upcomingSpecialDays(today, 120)
    .map((d) => `${d.ymd} (יום ${d.weekday}) — ${d.name} [${d.kind === "HOLIDAY" ? "חג, סגור" : d.kind === "EREV" ? "ערב חג, יום קצר" : d.kind === "CHOL_HAMOED" ? "חול המועד" : d.kind === "MEMORIAL" ? "יום זיכרון" : "חג קטן"}]`)
    .join("\n");
  return `אתה מנוע חילוץ נתונים למערכת ניהול לידים של סוכן מכירות שטח שהולך ברגל באזורי תעשייה ומסחר בישראל.
המשתמש מכתיב או מקליד הערה חופשית בעברית אחרי ביקור/שיחה עם עסק. עליך להחזיר JSON לפי הסכמה בלבד.

היום: יום ${WEEKDAY_NAMES[weekdayIL(now)]}, ${formatIL(now, "d.M.yyyy")} (${today}), ${hebrewDateLabel(now)}.
ימי עבודה: ראשון–חמישי. שישי יום קצר. שבת, חג וערב חג — לא קובעים.
ימים מיוחדים בתקופה הקרובה (לוח ישראל):
${specials || "(אין)"}

כללים:
1. שדה שלא ידוע → null. אל תמציא. name רק אם שם העסק נאמר במפורש; אחרת descriptor קצר ("נגריה", "חנות חלפים בקומה תחתונה").
2. area = הרחוב/האזור הראשי ("רחוב הסלע", "תלפיות"). addressNote = פרטי מיקום נוספים (בניין, קומה, ליד מה).
3. category = תחום העסק במילה-שתיים (נגרייה, הסעות, יבוא חלפים, קמעונאות, מסעדה...). bestTimeOfDay: תעשייה/בתי מלאכה/מוסכים/מחסנים → MORNING; חנויות/מסעדות/קמעונאות → AFTERNOON; לא ברור → ANY.
4. phone רק אם מופיע מספר. "אין טלפון" → null. אם אין טלפון → nextActionType חייב להיות "VISIT" (כניסה פיזית).
5. nextActionDate (YYYY-MM-DD) — תאריך המעקב שלי:
   - "ביום חמישי" → יום חמישי הקרוב שאחרי היום.
   - "בעוד שבוע" → +7 ימים. "בעוד חודש" → +30 ימים ומשוער.
   - "אחרי החג" / "אחרי סוכות" / "אחרי החגים" / "בין כיפור לסוכות" / "למחרת החג" → לפי רשימת הימים המיוחדים: יום העבודה המלא הראשון אחרי סוף החג (כולל חול המועד ושבת צמודה). nextActionIsApproximate = true.
   - "הבטיח/ה לחזור אליי" / "יחזור אליי ביום X" → המעקב שלי הוא יום-יומיים אחרי מה שהבטיחו (יום העבודה הבא אחרי X). status = "WAITING_THEM". nextActionNote בסגנון: "עדי הבטיחה לחזור ביום חמישי — לקפוץ אם לא חזרה".
   - תאריך שנופל בשבת/חג/ערב חג → הזז ליום העבודה הבא.
   - לא נאמר מועד אבל הבטיחו לחזור → 3 ימי עבודה מהיום, משוער. לא נאמר כלום → null.
   - dateExpression = ביטוי הזמן המקורי מהטקסט ("אחרי החג", "ביום חמישי"). nextActionTime רק אם נאמרה שעה מפורשת.
6. heat: "ישב איתי", "ביקש הצעה/מסמך", "קבע פגישה/תאריך", עניין ברור → HOT. שיחה אמיתית עם עניין → WARM. ביקור נימוס / לא מעוניין → COLD.
7. status: הבטיחו לחזור → WAITING_THEM. נקבע תאריך/פגישה → SCHEDULED. לא ברור מה העסק או מה הצורך → TO_CLARIFY. לא רלוונטי → LOST. "לא עכשיו, אולי בעוד כמה חודשים" → PARKED. אחרת NEW.
8. durationMin: "חצי שעה" → 30, "רבע שעה" → 15, "שעה" → 60, "X דקות" → X. אחרת null. ישב איתי חצי שעה = HOT.
9. observation = מה ראיתי בעסק (ניירת, תור, לוח מחיק, מחברת, אקסל, בלגן, כמה עובדים). painPoints = כאבים שנאמרו. currentTools = במה עובדים היום.
10. touchSummary = סיכום המגע במשפט-שניים (מה קרה בביקור). contactName = עם מי דיברתי; contactRole = תפקיד אם נאמר (בעלים/מנהל/פקידה).
11. nextActionNote = משפט קצר ומעשי: מה לעשות במעקב.
כל הטקסטים בעברית, קצרים ומעשיים.`;
}

// ---------- Claude ----------

export async function parseWithClaude(text: string, now = new Date()): Promise<ParsedLead> {
  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(now),
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(ParsedLeadSchema), effort: "medium" },
  });
  if (response.stop_reason === "refusal") throw new Error("המודל סירב לעבד את הטקסט");
  if (!response.parsed_output) throw new Error("לא התקבל JSON תקין מהמודל");
  return response.parsed_output;
}

/** נקודת הכניסה: Claude אם מוגדר, אחרת מקומי; תמיד עם עיבוד-אחרי */
export async function parseLeadText(text: string, now = new Date()): Promise<ParseResult> {
  let lead: ParsedLead | null = null;
  let source: ParseResult["source"] = "local";
  let error: string | undefined;
  if (claudeConfigured()) {
    try {
      lead = await parseWithClaude(text, now);
      source = "claude";
    } catch (e) {
      error = e instanceof Anthropic.APIError ? `Claude API ${e.status}: ${e.message}` : (e as Error).message;
      console.error("parseWithClaude failed, falling back to local:", error);
    }
  }
  if (!lead) lead = localParse(text, now);
  const processed = postProcess(lead, text, now);
  return { ...processed, source, error };
}
