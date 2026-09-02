import { env, requireEnv, AI_DRY_RUN, AI_TIMEOUT_MS } from './env.ts';
import { validateCommand, type ParseOutcome } from './command-schema.ts';
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

/** הטקסט שמדמה תלייה של המודל, לבדיקת מסלול התקרה בלי לחכות 8 שניות. */
export const TIMEOUT_FIXTURE = '__FIXTURE_TIMEOUT__';

class DryRunAiProvider implements AiProvider {
  async parseCommand(ctx: CommandContext): Promise<ParseOutcome> {
    if (ctx.text.trim() === TIMEOUT_FIXTURE) {
      return await Promise.resolve({
        ok: false, reason: 'timeout',
        detail: `הקריאה למודל לא חזרה תוך ${AI_TIMEOUT_MS}ms`,
        dryRun: true,
      });
    }
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

    // מחוץ ל-try בכוונה: ביטול הבקשה עלול להגיע כשגיאה ולא כערך,
    // וה-catch למטה חייב לדעת להבדיל בין תלייה לבין כשל אמיתי.
    let timedOut = false;
    const timeoutOutcome = (): ParseOutcome => ({
      ok: false, reason: 'timeout',
      detail: `הקריאה למודל לא חזרה תוך ${AI_TIMEOUT_MS}ms`,
      dryRun: false,
    });

    try {
      // טעינה דינמית: מסלול ההרצה היבשה לעולם לא מגיע לכאן ולכן גם
      // לא טוען את ה-SDK. זה מה שמאפשר לחבילת הבדיקות לרוץ בלי המפתח
      // ובלי החבילה בכלל.
      const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.68.0');
      const client = new Anthropic({
        apiKey: requireEnv('ANTHROPIC_API_KEY'),
        // ה-SDK מנסה שוב לבד. ניסיון חוזר בתוך תקרת זמן קשיחה פירושו
        // שהתקרה נשרפת על הניסיון הראשון — לכן אין ניסיונות חוזרים כאן.
        maxRetries: 0,
        timeout: AI_TIMEOUT_MS,
      });

      // ★ תקרת זמן קשיחה. שני מנגנונים, בכוונה:
      //   AbortController מבטל את הבקשה בפועל כדי שלא תמשיך לרוץ ברקע,
      //   ו-Promise.race מבטיח שנחזור גם אם הביטול עצמו לא נתמך.
      //   בלי השני, תלייה בשכבה שמתחת ל-SDK הייתה משאירה את הפונקציה
      //   תקועה עד ה-timeout של הפלטפורמה, והשולחת בלי שום תשובה.
      const abort = new AbortController();
      let timer: number | undefined;
      const expired = new Promise<'__timeout__'>((resolve) => {
        timer = setTimeout(() => { timedOut = true; abort.abort(); resolve('__timeout__'); }, AI_TIMEOUT_MS);
      });

      const response = await Promise.race([expired, client.messages.create({
        model,
        max_tokens: 800,
        system: COMMAND_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(ctx) }],
        // אין כאן output_config, ואין prefill. שניהם נוסו מול ה-API ונדחו:
        //   output_config — הסכימה שלנו נדחית שלוש פעמים (minimum/maximum
        //   על number, additionalProperties: true על fields, ואז
        //   "Schema is too complex" כשכל 21 השדות מנויים), ובגדלים שכן
        //   התקבלו הבקשה מאטה פי 4 ומעלה — לא שמיש לוואטסאפ בזמן אמת.
        //   prefill — "This model does not support assistant message prefill".
        // מה שנשאר, ומספיק: הפרומפט מגדיר את החוזה, extractJson מסיר עטיפה,
        // ו-validateCommand מאמת כל תשובה ומחזיר כישלון כערך.
        // דגימה דטרמיניסטית. נתמך ב-sonnet-4-6; במודלים חדשים יותר
        // הפרמטר הוסר, ולכן הוא נשלח רק כשהמודל מכיר אותו.
        ...(model.includes('4-6') ? { temperature: 0 } : {}),
      } as never, { signal: abort.signal })]).finally(() => clearTimeout(timer));

      if (response === '__timeout__') return timeoutOutcome();

      if (response.stop_reason === 'refusal') {
        return { ok: false, reason: 'provider_error', detail: 'הבקשה נדחתה', dryRun: false };
      }

      const text = (response.content as { type: string; text?: string }[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');

      return validateCommand(text.trim(), false);
    } catch (e) {
      // ביטול שהגיע כזריקה הוא עדיין תלייה, לא כשל ספק. ההבחנה חשובה:
      // רק timeout גורר את התשובה "רגע, בודקת" בוואטסאפ.
      if (timedOut) return timeoutOutcome();
      // גם שגיאת ספק מוחזרת כערך. שום דבר לא נזרק החוצה ושום דבר לא נרשם.
      const detail = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      return { ok: false, reason: 'provider_error', detail, dryRun: false };
    }
  }
}

export function aiProvider(): AiProvider {
  return AI_DRY_RUN ? new DryRunAiProvider() : new ClaudeAiProvider();
}
