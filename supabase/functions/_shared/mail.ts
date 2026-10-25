import { env } from './env.ts';

/**
 * שליחת מייל — ערוץ הגיבוי היומי. ספק: Resend (HTTPS, צרופות ב-base64).
 * בלי RESEND_API_KEY אין שליחה, וזה מוחזר כערך — לא נבלע: cron-backup
 * מתריע ב-alertOwner על כל מייל שלא יצא.
 */
export type MailAttachment = { filename: string; content: string /* base64 */ };
export type MailResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendMail(input: {
  to: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[];
  /** מיילים להורים: מהכתובת של הלקוחה (EMAIL_FROM). ברירת המחדל — הגיבוי. */
  from?: string; replyTo?: string | null; headers?: Record<string, string>;
  /** אותו מפתח = אותו מייל: ניסיון חוזר לא שולח פעמיים (Resend שומרת 24 שעות). */
  idempotencyKey?: string;
}): Promise<MailResult> {
  const key = env('RESEND_API_KEY');
  const from = input.from ?? env('BACKUP_MAIL_FROM') ?? 'Teichtal CRM <onboarding@resend.dev>';
  if (!key) return { ok: false, error: 'אין RESEND_API_KEY — המייל לא נשלח' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json',
                 ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}) },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text, html: input.html, attachments: input.attachments,
                             ...(input.replyTo ? { reply_to: input.replyTo } : {}), ...(input.headers ? { headers: input.headers } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.message ?? body.name ?? 'שגיאה'}` };
    return { ok: true, id: body.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאת רשת' };
  }
}

/**
 * הגדרות המיילים להורים. from=null — השליחה עוד לא הוגדרה (אין מפתח או כתובת שולח):
 * ההודעות נשארות בתור ולא יוצאות, ומסך השליחה אומר זאת.
 */
export function mailConfig() {
  const from = env('RESEND_API_KEY') && env('EMAIL_FROM') ? env('EMAIL_FROM') as string : null;
  return {
    from, replyTo: env('EMAIL_REPLY_TO') ?? null, senderName: env('EMAIL_SENDER_NAME') ?? null,
    base: (env('APP_BASE_URL') ?? 'https://teichtal-crm.netlify.app').replace(/\/+$/, ''),
  };
}
