import { renderTemplate, HEBREW_VARIABLES, type TemplateVars } from './template.ts';
import { formatILS } from './reminders.ts';

/**
 * מיילים להורים — הלוגיקה הטהורה (בלי מסד ובלי רשת), כדי שבדיקה ב-Node תריץ בדיוק אותה:
 *   · מי מקבלת: רק עם כתובת תקינה, עם הסכמה לתפוצה, ושלא הוסרה. השאר — עם סיבה.
 *   · מייל לכל תלמידה כשיש משתנים אישיים; אחרת אחד לכל כתובת (שתי אחיות — מייל אחד).
 *   · המייל עצמו: עברית מימין לשמאל, וקישור הסרה בתחתית — תמיד.
 *   · אימות החתימה של Resend על אירועי מסירה (Svix).
 */

export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normEmail = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export type Recipient = {
  id: string; full_name: string | null; parent_name: string | null; email: string | null; branch_name: string | null;
  balance: number | string | null; paid: number | string | null; due: number | string | null; mailing_consent: boolean | null;
};
export type SkipReason = 'no_email' | 'no_consent' | 'unsubscribed' | 'duplicate';
export const SKIP_LABEL: Record<SkipReason, string> = {
  no_email: 'אין כתובת מייל',
  no_consent: 'לא אישרה תפוצה במייל',
  unsubscribed: 'הוסרה מהתפוצה',
  duplicate: 'אותה כתובת כבר ברשימה',
};

const PERSONAL = ['student_name', 'balance', 'paid', 'total'];
/** האם הנוסח תלוי בתלמידה ({שם התלמידה}, {יתרה}…) — ואז כל תלמידה מקבלת מייל משלה. */
export function isPersonal(...texts: string[]): boolean {
  const all = texts.join('\n');
  const he = Object.entries(HEBREW_VARIABLES).filter(([, en]) => PERSONAL.includes(en)).map(([h]) => `{${h}}`);
  return PERSONAL.some((v) => all.includes(`{${v}}`)) || he.some((v) => all.includes(v));
}

/** מסננת את הנמענות. סדר הקלט נשמר. */
export function selectRecipients(rows: Recipient[], suppressed: Set<string>, personal: boolean) {
  const send: (Recipient & { to: string })[] = [];
  const skipped: Record<SkipReason, Recipient[]> = { no_email: [], no_consent: [], unsubscribed: [], duplicate: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const to = normEmail(r.email);
    if (!to || !EMAIL_RE.test(to)) skipped.no_email.push(r);
    else if (r.mailing_consent !== true) skipped.no_consent.push(r);
    else if (suppressed.has(to)) skipped.unsubscribed.push(r);
    else if (!personal && seen.has(to)) skipped.duplicate.push(r);
    else { seen.add(to); send.push({ ...r, to }); }
  }
  return { send, skipped };
}

export function varsFor(r: Recipient, today = new Date()): TemplateVars {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(today);
  return {
    parent_name: r.parent_name ?? '', student_name: r.full_name ?? '', branch: r.branch_name ?? '',
    balance: formatILS(r.balance), paid: formatILS(r.paid), total: formatILS(r.due), date,
  };
}

/** נושא בשורה אחת (שבירת שורה בנושא היא דרך להזריק כותרות). */
export function renderSubject(subject: string, vars: TemplateVars): string {
  return renderTemplate(subject, vars).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** טקסט → HTML: מנוטרל, קישורים לחיצים, שורות כמו שנכתבו. */
function textToHtml(text: string): string {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" style="color:#7a3e8e">${u}</a>`)
    .replace(/\r?\n/g, '<br>');
}

export const UNSUBSCRIBE_NOTE = 'קיבלת את המייל כי אישרת בהרשמה הצטרפות לרשימת התפוצה.';

/** המייל שיוצא: גוף שכבר הורכב (נשמר כך ביומן) + תחתית עם קישור הסרה. */
export function buildEmail(input: { body: string; unsubscribeUrl: string; senderName?: string | null }): { text: string; html: string } {
  const text = `${input.body}\n\n—\n${UNSUBSCRIBE_NOTE}\nלהסרה מרשימת התפוצה: ${input.unsubscribeUrl}`;
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f3f8">
<div dir="rtl" style="max-width:600px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#241a2e;text-align:right">
<div>${textToHtml(input.body)}</div>
<hr style="border:none;border-top:1px solid #e1d9e6;margin:28px 0 12px">
<p style="margin:0;font-size:12px;color:#6b5d78">${esc(UNSUBSCRIBE_NOTE)}${input.senderName ? ` ${esc(input.senderName)}` : ''}<br>
<a href="${esc(input.unsubscribeUrl)}" style="color:#6b5d78">להסרה מרשימת התפוצה</a></p>
</div></body></html>`;
  return { text, html };
}

export const unsubscribeUrl = (base: string, token: string) => `${base.replace(/\/+$/, '')}/unsubscribe/${token}`;

// ─────────── Resend → אירועי מסירה (חתימת Svix) ───────────
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * Resend חותמת כל אירוע (Svix): HMAC-SHA256 על "id.timestamp.body", במפתח שאחרי whsec_.
 * נדחה: חתימה שגויה, חסרה, או חותמת זמן ישנה מ-5 דקות (שידור חוזר של אירוע ישן).
 */
export async function verifyResendSignature(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null },
                                            rawBody: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h.id}.${h.timestamp}.${rawBody}`)));
  const expected = bytesToB64(mac);
  const given = h.signature.split(' ').map((s) => s.split(',')[1] ?? '').filter(Boolean);
  let ok = false;
  for (const g of given) {
    if (g.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < g.length; i++) diff |= g.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}
