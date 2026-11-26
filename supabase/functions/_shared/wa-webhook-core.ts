/**
 * wa-webhook — הלוגיקה. ה-Edge Function (wa-webhook/index.ts) רק מחברת אותה ללקוח המסד האמיתי.
 * היא כאן כדי שבדיקה תריץ אותה מול מסד מזויף ותוכיח מה נוגע במסד ומתי.
 *
 * ★ verify_jwt = false (GOWA לא שולחת JWT). ההגנה היחידה היא חתימת ה-HMAC, ולכן הסדר קבוע:
 *   1. אימות החתימה (X-Hub-Signature-256) על הגוף הגולמי. לא תקינה / חסרה / אין סוד → 401.
 *      ★ עד כאן אין לקוח מסד בכלל — db() נקרא רק אחרי האימות (wa-webhook.test.mjs מוכיח).
 *   2. מניעת כפילויות לפי מזהה ההודעה (מפתח ייחודי במסד). כפילות → מסיימים בשקט.
 *   3. רק אז עיבוד.
 * GOWA מנסה שוב כשלא מקבלת 2xx — ולכן אירוע שלא מטופל מאושר ב-200.
 */
import { parseWebhookEvent, verifyWebhookSignature, type WhatsAppProvider } from './wa.ts';
import { alertOwner } from './alerts.ts';
import { readWaHealth, writeWaHealth } from './health.ts';
import { routeIncoming } from './router.ts';
import { deliverReply } from './reply.ts';
import { answerCustomer } from './customer.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
export type WebhookDeps = { db: () => Db; provider: () => WhatsAppProvider };

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

export async function handleWaWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);

  // ─── 1. אימות. לפני כל נגיעה במסד. ───
  const rawBody = await req.text();
  if (!(await verifyWebhookSignature(rawBody, req.headers.get('x-hub-signature-256')))) {
    console.warn('[wa-webhook] חתימה חסרה או לא תקינה — נדחה');
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const event = parseWebhookEvent(payload);
  if (event.kind === 'ignore') return json({ ok: true, ignored: event.reason });

  const db = deps.db();
  try {
    if (event.kind === 'device') return await handleDevice(db, event.state, event.event);
    if (event.kind === 'unparsable') {
      // בלי מזהה / בלי מספר אין מניעת כפילויות ואין למי לענות. לא מעבדים, אבל מתריעים.
      await alertOwner(db, {
        kind: 'wa_unparsable', severity: 'warning', title: 'התקבלה הודעת וואטסאפ שלא ניתן לזהות',
        body: event.reason === 'lid_only'
          ? 'ההודעה הגיעה בלי מספר טלפון (מזהה פרטי של וואטסאפ בלבד), ולכן לא עובדה.'
          : 'ההודעה לא עובדה כדי למנוע כפילות. יש לבדוק את פורמט ה-webhook.',
        meta: { reason: event.reason },
      });
      return json({ ok: true, skipped: event.reason });
    }
    // ★ "הבוט כבוי": הבעלים מתכתבת ישירות מהטלפון — הודעות נכנסות לא נשמרות ולא נענות.
    const { data: paused } = await db.from('settings').select('value').eq('key', 'wa_bot_paused').maybeSingle();
    if (paused?.value === true) return json({ ok: true, ignored: 'bot_paused' });
    return await handleIncoming(db, deps.provider(), event.message);
  } catch (e) {
    console.error('[wa-webhook] תקלה בעיבוד', e);
    // 500 → GOWA תנסה שוב, ומניעת הכפילויות תגן מעיבוד כפול.
    return json({ error: 'שגיאה בעיבוד האירוע' }, 500);
  }
}

type Incoming = { providerMsgId: string; from: string; body: string; contactName: string | null; receivedAt: string };

async function handleIncoming(db: Db, wa: WhatsAppProvider, message: Incoming): Promise<Response> {
  const phone = message.from;   // כבר מנורמל (parseWebhookEvent)

  // ─── 2. מניעת כפילויות. האכיפה במסד (מפתח ייחודי על provider_msg_id), לא בקוד. ───
  const { error } = await db.from('wa_messages').insert({
    direction: 'in', phone, body: message.body, status: 'sent', provider_msg_id: message.providerMsgId,
    meta: { event: 'message', contact_name: message.contactName, received_at: message.receivedAt },
  });
  if (error) {
    if (error.code === '23505') return json({ ok: true, duplicate: true });
    throw new Error(error.message);
  }
  await db.from('conversations').upsert(
    { phone, contact_name: message.contactName, last_message_at: message.receivedAt }, { onConflict: 'phone' });

  // ─── 3. ניתוב (_shared/router.ts), ולקוחות (_shared/customer.ts). ───
  const decision = await routeIncoming(db, { alert: (a) => alertOwner(db, a) }, { phone, body: message.body });
  const deliverable = decision.route === 'customer'
    ? await answerCustomer(db, { alert: (a) => alertOwner(db, a) }, { phone, body: message.body })
    : decision;

  const delivery = await deliverReply(db, wa, phone, deliverable, `reply:${message.providerMsgId}`);
  if (delivery.delivered) {
    // התשובה נרשמת — זו ההיסטוריה שמסך השיחות והסוכן רואים. בהרצה יבשה: "בתור" (טיוטה).
    await db.from('wa_messages').insert({
      direction: 'out', phone, body: delivery.reply, status: delivery.dryRun ? 'queued' : 'sent',
      provider_msg_id: delivery.providerMsgId,
      meta: { route: deliverable.route, reply_to: message.providerMsgId, dry_run: delivery.dryRun },
    });
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('phone', phone);
  }
  return json({ ok: true, stored: message.providerMsgId, route: deliverable.route });
}

/** המכשיר נותק / נחסם — מיד, בלי לחכות לבדיקת הבריאות. התור נעצר עד שיחזור. */
async function handleDevice(db: Db, state: 'logged_out' | 'banned' | 'timelock', event: string): Promise<Response> {
  const previous = await readWaHealth(db);
  const now = new Date().toISOString();
  const error = state === 'logged_out' ? 'המספר נותק מהטלפון — צריך לסרוק QR מחדש'
    : state === 'banned' ? 'וואטסאפ חסמה את המספר זמנית' : 'וואטסאפ הגבילה זמנית פנייה למספרים חדשים';
  await writeWaHealth(db, { status: 'down', checked_at: now, last_ok_at: previous.last_ok_at,
                            consecutive_failures: previous.consecutive_failures + 1, error });
  await alertOwner(db, {
    kind: state === 'logged_out' ? 'wa_logged_out' : 'wa_restricted', severity: 'critical',
    title: state === 'logged_out' ? 'הוואטסאפ התנתק' : 'וואטסאפ הגבילה את המספר',
    body: `${error}. תזכורות מוחזקות בתור ולא נשלחות.`, meta: { event },
  });
  return json({ ok: true, device: state });
}
