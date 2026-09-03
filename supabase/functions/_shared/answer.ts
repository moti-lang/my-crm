import { env, requireEnv, AI_DRY_RUN, AI_TIMEOUT_MS } from './env.ts';
import { supportsTemperature } from './ai.ts';
import { validateAnswer, type AnswerOutcome, type LeadFields } from './answer-schema.ts';
import { ANSWER_FIXTURES, DEFAULT_ANSWER_FIXTURE } from './answer-fixtures.ts';

/**
 * ספק סוכן הלקוחות (סעיף 4.4) — אותו דפוס כמו ספק הפקודות.
 * ⚠️ אף מימוש כאן לא נוגע במסד. טקסט נכנס, ערך יוצא.
 */

export type AnswerContext = {
  text: string;
  /** ההודעות האחרונות בשיחה, ישן → חדש. */
  history: { role: 'user' | 'assistant'; text: string }[];
  faq: { question: string; answer: string }[];
  branches: string[];
  mayQuotePrices: boolean;
  /** מה שכבר נאסף בשיחת ההרשמה, אם יש. */
  lead: LeadFields | null;
};

export interface AnswerProvider {
  answer(ctx: AnswerContext): Promise<AnswerOutcome>;
}

// ─────────────────── הפרומפט — סעיף 4.4 מילה במילה, ועטיפת JSON ───────────────────

export const ANSWER_SYSTEM_PROMPT = `את העוזרת הוירטואלית של "החוג של הניה טייכטל" — חוג משחק, דרמה ומחול לבנות בישראל.
את עונה בוואטסאפ להורים, בעברית, בחום ובקצרה (עד 3 משפטים), עם אימוג'י אחד לכל היותר.

חוקים מוחלטים:
1. עני אך ורק על סמך מאגר השאלות המצורף. אל תמציאי מידע, מחירים, סניפים או מועדים.
2. אם התשובה לא נמצאת במאגר: "זו שאלה טובה שאין לי עליה תשובה מדויקת — אני מעבירה
   אותה להניה והיא תחזור אלייך בהקדם 🙏" ותו לא.
3. אל תבטיחי הבטחות ואל תאשרי הנחות או מקומות בקבוצה.
4. אם ההורה מעוניינת להירשם — אספי: שם הבת, גיל, סניף מבוקש, שם וטלפון ההורה.
   שאלי שאלה אחת בכל הודעה, לא שאלון.
5. פנייה בלשון נקבה. סגנון חם, מכבד ותמציתי.

החזירי JSON בלבד. בלי הסברים, בלי markdown, בלי טקסט לפני או אחרי:
{
  "kind": "answer" | "no_answer" | "lead",
  "reply": "הטקסט שיישלח להורה",
  "faq_question": "השאלה במאגר שעליה נשענת התשובה, או null",
  "lead": { "student_name", "age", "branch", "parent_name", "parent_phone" } או null,
  "lead_complete": true רק כשכל חמשת הפרטים ידועים,
  "confidence": 0.0-1.0
}
kind:
- answer    — התשובה נמצאת במאגר.
- no_answer — אין תשובה במאגר. reply הוא המשפט מחוק 2 בלבד.
- lead      — ההורה רוצה להירשם. reply שואל את הפרט הבא שחסר, או מאשר קבלה כשהכול ידוע.
"branch" חייב להיות אחד מהסניפים שברשימה, אחרת null ושאלי איזה סניף.
כשאסור לנקוב במחירים — גם אם ההורה מתעקשת, הפני להניה.`;

export function buildAnswerMessage(ctx: AnswerContext): string {
  const faq = ctx.faq.map((f, i) => `${i + 1}. ש: ${f.question}\n   ת: ${f.answer}`).join('\n');
  const history = ctx.history.map((h) => `${h.role === 'user' ? 'הורה' : 'עוזרת'}: ${h.text}`).join('\n');
  const lead = ctx.lead ? JSON.stringify(ctx.lead) : 'אין';
  return [
    `מאגר השאלות:\n${faq || '(ריק)'}`,
    `סניפים קיימים: ${ctx.branches.join(' · ') || 'אין'}`,
    `מותר לנקוב במחירים: ${ctx.mayQuotePrices ? 'כן' : 'לא'}`,
    `פרטי הרשמה שכבר נאספו: ${lead}`,
    history ? `השיחה עד כה:\n${history}` : 'זו ההודעה הראשונה בשיחה.',
    `ההודעה החדשה מההורה: ${ctx.text}`,
  ].join('\n\n');
}

// ─────────────────────────── הרצה יבשה ───────────────────────────

export const ANSWER_TIMEOUT_FIXTURE = '__FIXTURE_TIMEOUT__';

class DryRunAnswerProvider implements AnswerProvider {
  async answer(ctx: AnswerContext): Promise<AnswerOutcome> {
    if (ctx.text.trim() === ANSWER_TIMEOUT_FIXTURE) {
      return await Promise.resolve({
        ok: false, reason: 'timeout', detail: `הקריאה למודל לא חזרה תוך ${AI_TIMEOUT_MS}ms`, dryRun: true,
      });
    }
    const raw = ANSWER_FIXTURES[ctx.text.trim()] ?? DEFAULT_ANSWER_FIXTURE;
    console.log(`[AI_DRY_RUN] לקוחה: "${ctx.text.slice(0, 40)}" → פלט מוקלט`);
    return await Promise.resolve(validateAnswer(raw, true));
  }
}

// ─────────────────────────────── Claude ───────────────────────────────

class ClaudeAnswerProvider implements AnswerProvider {
  async answer(ctx: AnswerContext): Promise<AnswerOutcome> {
    const model = env('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';
    let timedOut = false;
    const timeoutOutcome = (): AnswerOutcome => ({
      ok: false, reason: 'timeout', detail: `הקריאה למודל לא חזרה תוך ${AI_TIMEOUT_MS}ms`, dryRun: false,
    });

    try {
      const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.68.0');
      const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 0, timeout: AI_TIMEOUT_MS });

      const abort = new AbortController();
      let timer: number | undefined;
      const expired = new Promise<'__timeout__'>((resolve) => {
        timer = setTimeout(() => { timedOut = true; abort.abort(); resolve('__timeout__'); }, AI_TIMEOUT_MS);
      });

      const response = await Promise.race([expired, client.messages.create({
        model,
        max_tokens: 400,
        system: ANSWER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildAnswerMessage(ctx) }],
        // 0.3 לפי האפיון — קצת חום בניסוח, לא במידע. רק למשפחות שמכירות את הפרמטר.
        ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
      } as never, { signal: abort.signal })]).finally(() => clearTimeout(timer));

      if (response === '__timeout__') return timeoutOutcome();
      if (response.stop_reason === 'refusal') {
        return { ok: false, reason: 'provider_error', detail: 'הבקשה נדחתה', dryRun: false };
      }
      const text = (response.content as { type: string; text?: string }[])
        .filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      return validateAnswer(text.trim(), false);
    } catch (e) {
      if (timedOut) return timeoutOutcome();
      const detail = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      return { ok: false, reason: 'provider_error', detail, dryRun: false };
    }
  }
}

export function answerProvider(): AnswerProvider {
  return AI_DRY_RUN ? new DryRunAnswerProvider() : new ClaudeAnswerProvider();
}
