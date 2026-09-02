import { env, requireEnv, AI_DRY_RUN } from './env.ts';
import { COMMAND_JSON_SCHEMA, validateCommand, type ParseOutcome } from './command-schema.ts';
import { COMMAND_FIXTURES, DEFAULT_FIXTURE } from './ai-fixtures.ts';

/**
 * ספק ה-AI — אותו דפוס כמו ספק הוואטסאפ.
 * שני מימושים, והמעבר ביניהם הוא משתנה סביבה בלבד.
 *
 * ⚠️ אף מימוש כאן לא נוגע במסד. הספק מקבל טקסט ומחזיר ערך, וזהו.
 */

/** ההקשר שנשלח למודל. שמות בלבד — אין כאן טלפונים או סכומים של אחרים. */
export type CommandContext = {
  text: string;
  today: string;
  branches: string[];
  students: { full_name: string; branch: string }[];
  categories: string[];
};

export interface AiProvider {
  parseCommand(ctx: CommandContext): Promise<ParseOutcome>;
}

// ─────────────────────── הפרומפט (סעיף 4.3.1) ───────────────────────

export const COMMAND_SYSTEM_PROMPT = `אתה מנוע פקודות של מערכת ניהול לחוג דרמה בישראל.
הקלט הוא הודעת וואטסאפ בעברית מבעלת העסק או מהצוות.
החזר JSON בלבד. בלי הסברים, בלי markdown, בלי טקסט לפני או אחרי.

סכימה:
{
  "intent": "expense" | "income" | "payment" | "new_student" | "update_student" |
            "reminder" | "attendance" | "query" | "unknown",
  "confidence": 0.0-1.0,
  "fields": { ... },
  "missing": ["שם השדה שחסר"],
  "human_summary": "משפט אחד בעברית שמתאר מה הבנת"
}

שדות לפי intent:
expense  → amount (מספר), branch (שם סניף או null), category, vendor, date (YYYY-MM-DD או null), production (שם סרט או null)
income   → amount, branch או null (null = כללי), category, description
payment  → student_name, amount, method (cash|transfer|bit|credit|check), date
new_student → full_name, branch, grade, parent_name, parent_phone, tuition
update_student → student_name, field, value
reminder → target (student_name או phone או "owner"), when_text, offset_days, body
attendance → branch, date, absent_students[]
query    → question_type: "debtors"|"income"|"profit"|"student_count"|"attendance"|"balance", branch או null

כללים:
- סכומים: מספרים בלבד, בלי ₪ ובלי פסיקים.
- "היום"/"אתמול"/"אמש" → תרגם לתאריך לפי התאריך שסופק בהקשר.
- שמות סניפים אפשריים מסופקים בהקשר. התאם לשם הקרוב ביותר; אין התאמה → null.
- אם חסר שדה קריטי (סכום לפעולה כספית, שם תלמידה לתשלום) — רשום אותו ב-missing.
- אם אינך בטוח מה נדרש — intent "unknown" עם confidence נמוך. לעולם אל תנחש סכום.
- לעולם אל תמציא שמות של תלמידות או סניפים שלא הופיעו בהקשר.`;

export function buildUserMessage(ctx: CommandContext): string {
  return [
    `הודעה: ${ctx.text}`,
    `התאריך היום: ${ctx.today}`,
    `סניפים: ${ctx.branches.join(' · ') || 'אין'}`,
    `תלמידות פעילות: ${ctx.students.map((s) => `${s.full_name} (${s.branch})`).join(' · ') || 'אין'}`,
    `קטגוריות: ${ctx.categories.join(' · ') || 'אין'}`,
  ].join('\n');
}

// ─────────────────────────── הרצה יבשה ───────────────────────────

class DryRunAiProvider implements AiProvider {
  async parseCommand(ctx: CommandContext): Promise<ParseOutcome> {
    const raw = COMMAND_FIXTURES[ctx.text.trim()] ?? DEFAULT_FIXTURE;
    console.log(`[AI_DRY_RUN] "${ctx.text.slice(0, 40)}" → פלט מוקלט`);
    return await Promise.resolve(validateCommand(raw, true));
  }
}

// ─────────────────────────────── Claude ───────────────────────────────

class ClaudeAiProvider implements AiProvider {
  async parseCommand(ctx: CommandContext): Promise<ParseOutcome> {
    // ברירת המחדל מהאפיון. ניתן להחליף בלי נגיעה בקוד.
    const model = env('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

    try {
      // טעינה דינמית: מסלול ההרצה היבשה לעולם לא מגיע לכאן ולכן גם
      // לא טוען את ה-SDK. זה מה שמאפשר לחבילת הבדיקות לרוץ בלי המפתח
      // ובלי החבילה בכלל.
      const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.68.0');
      const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

      const response = await client.messages.create({
        model,
        max_tokens: 800,
        system: COMMAND_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(ctx) }],
        // הסכימה נאכפת בצד ה-API ולא רק מתבקשת בפרומפט. זה מה שהופך
        // "JSON פגום" למקרה נדיר, ולא לדבר שאנחנו סופגים בכל בקשה.
        output_config: { format: { type: 'json_schema', schema: COMMAND_JSON_SCHEMA } },
        // דגימה דטרמיניסטית. נתמך ב-sonnet-4-6; במודלים חדשים יותר
        // הפרמטר הוסר, ולכן הוא נשלח רק כשהמודל מכיר אותו.
        ...(model.includes('4-6') ? { temperature: 0 } : {}),
      } as never);

      if (response.stop_reason === 'refusal') {
        return { ok: false, reason: 'provider_error', detail: 'הבקשה נדחתה', dryRun: false };
      }

      const text = (response.content as { type: string; text?: string }[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');

      return validateCommand(text.trim(), false);
    } catch (e) {
      // גם שגיאת ספק מוחזרת כערך. שום דבר לא נזרק החוצה ושום דבר לא נרשם.
      const detail = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      return { ok: false, reason: 'provider_error', detail, dryRun: false };
    }
  }
}

export function aiProvider(): AiProvider {
  return AI_DRY_RUN ? new DryRunAiProvider() : new ClaudeAiProvider();
}
