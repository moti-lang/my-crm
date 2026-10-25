import { renderTemplate } from './template.ts';
import { isBlocked } from './quiet-hours.ts';
import type { MailResult, MailAttachment } from './mail.ts';
import {
  MAX_ATTACHMENT_BYTES, normEmail, isPersonal, selectRecipients, varsFor, renderSubject, buildEmail, unsubscribeUrl,
  type Recipient, type SkipReason,
} from './email-core.ts';

/**
 * מיילים להורים — הזרימה: הכנסה לתור, מייל בדיקה, שליחת התור, ואירועי מסירה.
 * db וספק המייל מוזרקים: הפונקציות (email-send, cron-email, email-webhook) מעבירות את
 * האמיתיים, והבדיקות — את המסד המקומי וספק מזויף שמתעד כל שליחה.
 */
export type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }> };
export type Send = (input: {
  to: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[];
  from?: string; replyTo?: string | null; headers?: Record<string, string>; idempotencyKey?: string;
}) => Promise<MailResult>;
export type MailConfig = { from: string | null; replyTo: string | null; base: string; senderName: string | null };
export type Attachment = { name: string; type: string; b64: string };

const RECIPIENT_COLS = 'id, full_name, parent_name, email, branch_name, balance, paid, due, mailing_consent';

function attachmentSize(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  return Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
}
function checkAttachment(a: Attachment | null | undefined): { ok: true; att: (Attachment & { size: number }) | null } | { ok: false; error: string } {
  if (!a) return { ok: true, att: null };
  const name = String(a.name ?? '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 120);
  if (!name || typeof a.b64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(a.b64)) return { ok: false, error: 'הקובץ המצורף לא תקין' };
  const size = attachmentSize(a.b64);
  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `הקובץ גדול מדי (${(size / 1048576).toFixed(1)}MB, עד ${MAX_ATTACHMENT_BYTES / 1048576}MB)` };
  return { ok: true, att: { name, type: String(a.type || 'application/octet-stream').slice(0, 100), b64: a.b64.replace(/\s/g, ''), size } };
}

/** הנמענות, בסדר שנבחר, אחרי סינון ההסכמה וההסרה — בשרת, לא לפי מה שהמסך שלח. */
export async function resolveRecipients(db: Db, studentIds: string[], subject: string, body: string) {
  const ids = [...new Set(studentIds.filter((x) => typeof x === 'string'))].slice(0, 3000);
  const { data: rows, error } = await db.from('v_student_overview').select(RECIPIENT_COLS).in('id', ids);
  if (error) throw new Error(error.message);
  const byId = new Map((rows ?? []).map((r: Recipient) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Recipient[];
  const emails = [...new Set(ordered.map((r) => normEmail(r.email)).filter(Boolean))];
  const { data: sup } = emails.length ? await db.from('email_suppressions').select('email').in('email', emails) : { data: [] };
  const suppressed = new Set((sup ?? []).map((s: { email: string }) => s.email));
  const personal = isPersonal(subject, body);
  return { personal, ...selectRecipients(ordered, suppressed, personal) };
}

const countSkipped = (s: Record<SkipReason, Recipient[]>) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length])) as Record<SkipReason, number>;

export type QueueInput = { studentIds: string[]; subject: string; body: string; attachment?: Attachment | null; createdBy: string | null };

/** יוצרת שליחה ומכניסה לתור מייל לכל נמענת. cron-email שולחת. */
export async function queueCampaign(db: Db, input: QueueInput) {
  const subject = String(input.subject ?? '').trim(), body = String(input.body ?? '').trim();
  if (!subject) return { ok: false as const, error: 'חסר נושא' };
  if (!body) return { ok: false as const, error: 'חסר תוכן' };
  if (subject.length > 200 || body.length > 20000) return { ok: false as const, error: 'הנושא או התוכן ארוכים מדי' };
  if (!Array.isArray(input.studentIds) || input.studentIds.length === 0) return { ok: false as const, error: 'לא נבחרו נמענות' };
  const att = checkAttachment(input.attachment);
  if (!att.ok) return att;

  const { personal, send, skipped } = await resolveRecipients(db, input.studentIds, subject, body);
  const skippedCounts = countSkipped(skipped);
  if (send.length === 0) return { ok: false as const, error: 'אין אף נמענת שאפשר לשלוח אליה', skipped: skippedCounts };

  const { data: camp, error: cErr } = await db.from('email_campaigns').insert({
    subject, body, per_student: personal, skipped: skippedCounts, created_by: input.createdBy,
    attachment_name: att.att?.name ?? null, attachment_type: att.att?.type ?? null, attachment_size: att.att?.size ?? null, attachment_b64: att.att?.b64 ?? null,
  }).select('id').single();
  if (cErr || !camp) return { ok: false as const, error: cErr?.message ?? 'השליחה לא נשמרה' };

  const today = new Date();
  const rows = send.map((r) => {
    const vars = varsFor(r, today);
    return { campaign_id: camp.id, student_id: r.id, to_email: r.to, to_name: r.parent_name, subject: renderSubject(subject, vars), body: renderTemplate(body, vars) };
  });
  const { error: mErr } = await db.from('email_messages').insert(rows);
  if (mErr) {
    await db.from('email_campaigns').delete().eq('id', camp.id);
    return { ok: false as const, error: mErr.message };
  }
  return { ok: true as const, campaignId: camp.id as string, queued: rows.length, personal, skipped: skippedCounts };
}

/** מייל בדיקה — רק לכתובת שהבעלים מזינה, מיד, בלי תור ובלי יומן. עם הנתונים של הנמענת הראשונה. */
export async function sendTestEmail(db: Db, send: Send, cfg: MailConfig, input: { to: string; subject: string; body: string; studentIds: string[]; attachment?: Attachment | null }) {
  if (!cfg.from) return { ok: false as const, error: 'שליחת מיילים עוד לא הוגדרה (חסרה כתובת שולח)' };
  const to = normEmail(input.to);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false as const, error: 'כתובת הבדיקה לא תקינה' };
  const att = checkAttachment(input.attachment);
  if (!att.ok) return att;
  const { send: rec } = await resolveRecipients(db, input.studentIds ?? [], input.subject, input.body);
  const sample: Recipient = rec[0] ?? { id: '', full_name: 'שם התלמידה', parent_name: 'שם ההורה', email: to, branch_name: 'סניף', balance: 0, paid: 0, due: 0, mailing_consent: true };
  const vars = varsFor(sample);
  const { text, html } = buildEmail({ body: renderTemplate(input.body, vars), unsubscribeUrl: unsubscribeUrl(cfg.base, 'test'), senderName: cfg.senderName });
  const r = await send({ to: [to], subject: `[בדיקה] ${renderSubject(input.subject, vars)}`, text, html, from: cfg.from, replyTo: cfg.replyTo,
    attachments: att.att ? [{ filename: att.att.name, content: att.att.b64 }] : undefined });
  return r.ok ? { ok: true as const, id: r.id, sample: sample.full_name } : { ok: false as const, error: r.error };
}

/**
 * שליחת התור: לא בשבת ובחג, בתוך התקרה היומית, בקצב של הספק (2 בשנייה).
 * שגיאת קצב (429) — ההודעה חוזרת לתור והריצה נעצרת; תישלח בדקה הבאה.
 */
export async function processQueue(db: Db, send: Send, cfg: MailConfig, opts: { now?: Date; batch?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  if (!cfg.from) return { ok: true as const, configured: false, sent: 0, failed: 0, claimed: 0 };
  const now = opts.now ?? new Date();
  const [{ data: quietRow }, { data: holidayRows }, { data: capRow }] = await Promise.all([
    db.from('settings').select('value').eq('key', 'quiet_hours').maybeSingle(),
    db.from('holidays').select('day'),
    db.from('settings').select('value').eq('key', 'email_daily_cap').maybeSingle(),
  ]);
  const noShabbat = (quietRow?.value as { no_shabbat?: boolean } | undefined)?.no_shabbat ?? true;
  // למייל: רק שבת וחגים. אין "שעות שקטות" — מייל בלילה לא מעיר אף אחד.
  if (isBlocked(now, { from: '00:00', to: '00:00', no_shabbat: noShabbat }, new Set((holidayRows ?? []).map((h: { day: string }) => h.day)))) {
    return { ok: true as const, configured: true, blocked: 'shabbat_or_holiday' as const, sent: 0, failed: 0, claimed: 0 };
  }
  const cap = Number(capRow?.value ?? 100);
  const { data: claimed, error } = await db.rpc('rpc_email_claim', { p_limit: opts.batch ?? 40, p_daily_cap: Number.isFinite(cap) ? cap : 100 });
  if (error) throw new Error(error.message);
  const list = (claimed ?? []) as { id: string; campaign_id: string; to_email: string; subject: string; body: string; unsubscribe_token: string }[];

  const campIds = [...new Set(list.map((m) => m.campaign_id))];
  const { data: camps } = campIds.length
    ? await db.from('email_campaigns').select('id, attachment_name, attachment_b64').in('id', campIds) : { data: [] };
  const atts = new Map((camps ?? []).map((c: { id: string; attachment_name: string | null; attachment_b64: string | null }) =>
    [c.id, c.attachment_name && c.attachment_b64 ? [{ filename: c.attachment_name, content: c.attachment_b64 }] : undefined]));

  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const url = unsubscribeUrl(cfg.base, m.unsubscribe_token);
    const { text, html } = buildEmail({ body: m.body, unsubscribeUrl: url, senderName: cfg.senderName });
    const r = await send({ to: [m.to_email], subject: m.subject, text, html, from: cfg.from, replyTo: cfg.replyTo,
      headers: { 'List-Unsubscribe': `<${url}>` }, idempotencyKey: m.id, attachments: atts.get(m.campaign_id) });
    if (r.ok) {
      sent++;
      await db.from('email_messages').update({ status: 'sent', provider_id: r.id, sent_at: new Date().toISOString(), error: null }).eq('id', m.id);
    } else if (/\b429\b/.test(r.error)) {
      // הקצב של הספק: חזרה לתור — גם ההודעה הזו וגם כל מה שעוד לא נוסה בריצה.
      const rest = list.slice(i).map((x) => x.id);
      await db.from('email_messages').update({ status: 'queued', sending_at: null }).in('id', rest);
      break;
    } else {
      failed++;
      await db.from('email_messages').update({ status: 'failed', error: r.error.slice(0, 500) }).eq('id', m.id);
    }
    if (i < list.length - 1) await sleep(600);
  }
  return { ok: true as const, configured: true, sent, failed, claimed: list.length };
}

/** אירוע מסירה מ-Resend (אחרי אימות החתימה). */
export async function handleResendEvent(db: Db, event: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } }) {
  const type = String(event?.type ?? '');
  const id = event?.data?.email_id;
  if (!id || !['email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained'].includes(type)) return { ok: true, ignored: type || 'unknown' };
  const { data, error } = await db.rpc('rpc_email_event', { p_provider_id: id, p_type: type, p_detail: event.data?.bounce?.message ?? null });
  if (error) throw new Error(error.message);
  return data;
}
