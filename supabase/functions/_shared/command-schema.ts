
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
export const COMMAND_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    fields: { type: 'object', additionalProperties: true },
    missing: { type: 'array', items: { type: 'string' } },
    human_summary: { type: 'string' },
  },
  required: ['intent', 'confidence', 'fields', 'missing', 'human_summary'],
  additionalProperties: false,
} as const;

export type ParseOutcome =
  | { ok: true; command: ParsedCommand; dryRun: boolean }
  | { ok: false; reason: 'invalid_json' | 'schema_mismatch' | 'provider_error' | 'low_confidence';
      detail: string; raw?: string; dryRun: boolean };

/** סף הביטחון. מתחתיו לא מציעים כלום — שואלים מחדש. */
export const MIN_CONFIDENCE = 0.6;

/**
 * מפרסר ומאמת. **הפונקציה הזו לא נוגעת במסד ולא יכולה.**
 * כל כישלון מוחזר כערך, לא נזרק וגם לא נרשם.
 */
export function validateCommand(raw: string, dryRun: boolean): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
