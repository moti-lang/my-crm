
/**
 * הסכימה של פלט ai-command (סעיף 4.3.1 באפיון).
 *
 * זו נקודת האמון היחידה בין מודל שפה למסד הנתונים. כל דבר שלא עובר
 * כאן נעצר, ולא נכתב שום דבר לשום מקום — כולל לוגים חלקיים.
 */

export const INTENTS = [
  'expense', 'income', 'payment', 'new_student', 'update_student',
  'reminder', 'attendance', 'query', 'unknown',
] as const;

export type ParsedCommand = {
  intent: (typeof INTENTS)[number];
  confidence: number;
  fields: Record<string, unknown>;
  missing: string[];
  human_summary: string;
};

/**
 * ולידציה ידנית ולא ספריית סכימות.
 *
 * הסיבה מעשית: הקובץ הזה נטען גם ב-Deno (Edge Function) וגם ב-Node
 * (חבילת הבדיקות). מפרט npm: לא נפתר ב-esbuild של Node, ושכבת תאימות
 * נוספת רק כדי לאמת חמישה שדות אינה משתלמת. הבדיקות מכסות כל ענף.
 */
function validateShape(value: unknown): { ok: true; command: ParsedCommand } | { ok: false; detail: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, detail: 'הפלט אינו אובייקט' };
  }
  const v = value as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof v.intent !== 'string' || !(INTENTS as readonly string[]).includes(v.intent)) {
    problems.push(`intent: ערך לא חוקי (${JSON.stringify(v.intent)})`);
  }
  if (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)
      || v.confidence < 0 || v.confidence > 1) {
    problems.push(`confidence: חייב להיות מספר בין 0 ל-1 (${JSON.stringify(v.confidence)})`);
  }
  if (v.fields !== undefined
      && (v.fields === null || typeof v.fields !== 'object' || Array.isArray(v.fields))) {
    problems.push('fields: חייב להיות אובייקט');
  }
  if (v.missing !== undefined
      && (!Array.isArray(v.missing) || v.missing.some((m) => typeof m !== 'string'))) {
    problems.push('missing: חייב להיות מערך מחרוזות');
  }
  if (v.human_summary !== undefined && typeof v.human_summary !== 'string') {
    problems.push('human_summary: חייב להיות מחרוזת');
  }

  if (problems.length > 0) return { ok: false, detail: problems.join('; ') };

  return {
    ok: true,
    command: {
      intent: v.intent as ParsedCommand['intent'],
      confidence: v.confidence as number,
      fields: (v.fields as Record<string, unknown>) ?? {},
      missing: (v.missing as string[]) ?? [],
      human_summary: (v.human_summary as string) ?? '',
    },
  };
}

/** ה-JSON Schema שנשלח ל-API כ-output_config.format — לא רק בקשה בפרומפט. */
// אין כאן COMMAND_JSON_SCHEMA. הסכימה נשלחה פעם ל-API כ-output_config
// ונדחתה בשלוש צורות: minimum/maximum על number, additionalProperties: true
// על fields, ואז "Schema is too complex" ברגע שכל השדות מנויים במפורש.
// גם בגדלים שכן התקבלו הבקשה האטה פי 4 ומעלה. החוזה מוגדר היום
// ב-COMMAND_SYSTEM_PROMPT ונאכף כאן ב-validateShape.

export type ParseOutcome =
  | { ok: true; command: ParsedCommand; dryRun: boolean }
  | { ok: false;
      reason: 'invalid_json' | 'schema_mismatch' | 'provider_error' | 'low_confidence' | 'timeout';
      detail: string; raw?: string; dryRun: boolean };

/** סף הביטחון. מתחתיו לא מציעים כלום — שואלים מחדש. */
export const MIN_CONFIDENCE = 0.6;

/**
 * מפרסר ומאמת. **הפונקציה הזו לא נוגעת במסד ולא יכולה.**
 * כל כישלון מוחזר כערך, לא נזרק וגם לא נרשם.
 */
/**
 * מחלץ את אובייקט ה-JSON מתוך תשובת המודל.
 *
 * הפרומפט מבקש JSON בלבד, אבל אין שום דבר שאוכף את זה: ה-API דוחה את
 * הסכימה שלנו כ-output_config, ו-claude-sonnet-4-6 אינו תומך ב-prefill
 * ("This model does not support assistant message prefill"). לכן החילוץ
 * הוא ההגנה: גדר markdown או משפט פתיחה לא יהפכו פקודה תקינה לכישלון.
 *
 * לוקח מהסוגר המסולסל הפותח הראשון עד הסוגר הסוגר האחרון. אין כאן ניסיון
 * לתקן JSON שבור — רק להסיר עטיפה. מה שנשאר עדיין עובר JSON.parse ואימות מלא.
 */
export function extractJson(raw: string): string {
  const text = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

export function validateCommand(raw: string, dryRun: boolean): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, reason: 'invalid_json', detail: 'המודל לא החזיר JSON תקין', raw, dryRun };
  }

  const result = validateShape(parsed);
  if (!result.ok) {
    return { ok: false, reason: 'schema_mismatch', detail: result.detail, raw, dryRun };
  }

  const command = result.command;
  if (command.intent === 'unknown' || command.confidence < MIN_CONFIDENCE) {
    return {
      ok: false,
      reason: 'low_confidence',
      detail: `intent=${command.intent} confidence=${command.confidence}`,
      dryRun,
    };
  }

  return { ok: true, command, dryRun };
}
