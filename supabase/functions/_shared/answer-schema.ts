/**
 * הסכימה של פלט סוכן הלקוחות (סעיף 4.4).
 *
 * כמו command-schema: נקודת האמון היחידה בין מודל שפה לבין מה שנשלח
 * להורה ומה שנכתב למסד. מה שלא עובר כאן — לא נשלח ולא נכתב.
 * ולידציה ידנית, כי הקובץ רץ גם ב-Deno וגם ב-Node.
 */
import { extractJson } from './command-schema.ts';

export const ANSWER_KINDS = ['answer', 'no_answer', 'lead'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** פרטי ליד. כולם אופציונליים עד שהשיחה מסתיימת. */
export type LeadFields = {
  student_name: string | null;
  age: string | null;
  branch: string | null;
  parent_name: string | null;
  parent_phone: string | null;
};

export type AgentAnswer = {
  kind: AnswerKind;
  reply: string;
  /** השאלה במאגר שעליה נשענה התשובה, או null */
  faq_question: string | null;
  lead: LeadFields | null;
  lead_complete: boolean;
  confidence: number;
};

/** התשובה היחידה המותרת כשאין תשובה במאגר (סעיף 4.4, חוק 2). מילה במילה. */
export const NO_ANSWER_REPLY =
  'זו שאלה טובה שאין לי עליה תשובה מדויקת — אני מעבירה אותה להניה והיא תחזור אלייך בהקדם 🙏';

/** כשהמודל לא ענה בכלל (תלייה, שגיאת ספק) — ההורה לא נשארת בלי מילה. */
export const PROVIDER_ERROR_REPLY =
  'תודה על ההודעה! אני מעבירה אותה להניה והיא תחזור אלייך בהקדם 🙏';

/** תקרת אורך: עד 3 משפטים בוואטסאפ. מעבר לזה זה לא "בקצרה". */
export const MAX_REPLY_CHARS = 600;

export type AnswerOutcome =
  | { ok: true; answer: AgentAnswer; dryRun: boolean }
  | { ok: false;
      reason: 'invalid_json' | 'schema_mismatch' | 'provider_error' | 'timeout';
      detail: string; raw?: string; dryRun: boolean };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function validateShape(value: unknown): { ok: true; answer: AgentAnswer } | { ok: false; detail: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, detail: 'הפלט אינו אובייקט' };
  }
  const v = value as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof v.kind !== 'string' || !(ANSWER_KINDS as readonly string[]).includes(v.kind)) {
    problems.push(`kind: ערך לא חוקי (${JSON.stringify(v.kind)})`);
  }
  if (typeof v.reply !== 'string') problems.push('reply: חייב להיות מחרוזת');
  else if (v.reply.length > MAX_REPLY_CHARS) problems.push(`reply: ארוך מדי (${v.reply.length} תווים)`);
  if (v.confidence !== undefined && (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)
      || v.confidence < 0 || v.confidence > 1)) {
    problems.push('confidence: חייב להיות מספר בין 0 ל-1');
  }
  if (v.lead !== undefined && v.lead !== null && (typeof v.lead !== 'object' || Array.isArray(v.lead))) {
    problems.push('lead: חייב להיות אובייקט או null');
  }
  if (problems.length > 0) return { ok: false, detail: problems.join('; ') };

  const rawLead = (v.lead ?? null) as Record<string, unknown> | null;
  const lead: LeadFields | null = rawLead ? {
    student_name: str(rawLead.student_name),
    age: rawLead.age === null || rawLead.age === undefined ? null : String(rawLead.age).trim() || null,
    branch: str(rawLead.branch),
    parent_name: str(rawLead.parent_name),
    parent_phone: str(rawLead.parent_phone),
  } : null;

  return {
    ok: true,
    answer: {
      kind: v.kind as AnswerKind,
      reply: (v.reply as string).trim(),
      faq_question: str(v.faq_question),
      lead,
      lead_complete: v.lead_complete === true,
      confidence: typeof v.confidence === 'number' ? v.confidence : 0.5,
    },
  };
}

/** ליד "שלם" = כל חמשת הפרטים. המודל טוען, אנחנו בודקים. */
export function isLeadComplete(lead: LeadFields | null): lead is LeadFields & Record<keyof LeadFields, string> {
  return Boolean(lead && lead.student_name && lead.age && lead.branch && lead.parent_name && lead.parent_phone);
}

/** מפרסר ומאמת. לא נוגע במסד. כישלון מוחזר כערך. */
export function validateAnswer(raw: string, dryRun: boolean): AnswerOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, reason: 'invalid_json', detail: 'המודל לא החזיר JSON תקין', raw, dryRun };
  }
  const result = validateShape(parsed);
  if (!result.ok) return { ok: false, reason: 'schema_mismatch', detail: result.detail, raw, dryRun };

  const answer = result.answer;
  // חוק 2 נאכף כאן ולא מוסכם: "אין תשובה" מקבל תמיד את אותו משפט.
  if (answer.kind === 'no_answer') answer.reply = NO_ANSWER_REPLY;
  // ליד "שלם" לפי המודל אבל חסר שדה — לא שלם.
  if (answer.kind === 'lead' && answer.lead_complete && !isLeadComplete(answer.lead)) answer.lead_complete = false;
  return { ok: true, answer, dryRun };
}

/** מחרוזת שנוקבת מחיר: מספר צמוד לסימן שקל, או "שקל/ש״ח" ליד מספר. */
export function quotesPrice(text: string): boolean {
  return /(₪\s*\d|\d\s*₪|\d[\d,\.]*\s*(ש"ח|ש״ח|שקל|שקלים|ש''ח)|(ש"ח|ש״ח|שקל|שקלים)\s*\d)/.test(text);
}
