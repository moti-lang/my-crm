// email-send — מיילים להורים מהמסך (בעלים בלבד).
//   action 'queue' (ברירת מחדל): יוצרת שליחה ומכניסה לתור מייל לכל נמענת — cron-email שולחת.
//   action 'test': מייל בדיקה מיד, רק לכתובת שהבעלים מזינה.
// מי מקבלת נקבע כאן, בשרת: רק עם הסכמה לתפוצה, עם כתובת, ושלא הוסרה (_shared/email-flow.ts).
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { sendMail, mailConfig } from '../_shared/mail.ts';
import { queueCampaign, sendTestEmail, type Attachment } from '../_shared/email-flow.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  return withCors(req, await handle(req));
});

async function handle(req: Request): Promise<Response> {
  const denied = requireUserJwt(req);
  if (denied) return denied;
  const auth = req.headers.get('authorization') ?? '';
  // ★ בעלים בלבד — נבדק במסד, בהרשאות המשתמשת עצמה.
  const { data: role } = await userClient(auth).rpc('auth_role');
  if (role !== 'owner') return json({ ok: false, error: 'רק הבעלים' }, 403);
  if (req.method !== 'POST') return json({ ok: false, error: 'שיטה לא נתמכת' }, 405);

  let body: { action?: string; studentIds?: string[]; subject?: string; body?: string; attachment?: Attachment | null; to?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const db = adminClient();
  const cfg = mailConfig();
  if (body.action === 'status') {
    const { data: cap } = await db.from('settings').select('value').eq('key', 'email_daily_cap').maybeSingle();
    return json({ ok: true, configured: Boolean(cfg.from), from: cfg.from, replyTo: cfg.replyTo, dailyCap: Number(cap?.value ?? 100) });
  }
  // ★ בלי ספק מוגדר — לא מכניסים לתור: אחרת מיילים של היום היו יוצאים בהפתעה, ביום שיוגדר מפתח.
  if (!cfg.from) return json({ ok: false, configured: false, error: 'שליחת המיילים עוד לא הוגדרה (חשבון Resend ודומיין). שום מייל לא נשלח.' }, 503);
  if (body.action === 'test') {
    const r = await sendTestEmail(db, sendMail, cfg, { to: body.to ?? '', subject: body.subject ?? '', body: body.body ?? '', studentIds: body.studentIds ?? [], attachment: body.attachment });
    return json(r, r.ok ? 200 : 400);
  }
  const createdBy = String(decodeJwtPayload(auth.replace(/^Bearer\s+/i, ''))?.sub ?? '') || null;
  const r = await queueCampaign(db, { studentIds: body.studentIds ?? [], subject: body.subject ?? '', body: body.body ?? '', attachment: body.attachment, createdBy });
  return json({ ...r, configured: Boolean(cfg.from) }, r.ok ? 200 : 400);
}
