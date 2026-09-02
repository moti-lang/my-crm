// wa-webhook — נקודת הכניסה היחידה לאירועים מ-whatsapp-hub.
//
// סדר קריטי, ואין לשנות אותו:
//   1. אימות חתימת HMAC על הגוף הגולמי. לא תקין → 401 בלי לגעת במסד.
//   2. מניעת כפילויות לפי מזהה ההודעה. כפילות → מסיימים בשקט.
//   3. רק אז עיבוד.
//
// הסדר הזה הוא ההגנה מפני התרחיש שהשרת העצמאי מייצר: ריסטארט ואז
// מסירה חוזרת של אותו אירוע. בפקודה כספית, כפילות = הוצאה כפולה.
import { adminClient } from '../_shared/supabase.ts';
import { whatsappProvider, verifyHubSignature } from '../_shared/wa.ts';
import { alertOwner } from '../_shared/alerts.ts';
import { readWaHealth, writeWaHealth } from '../_shared/health.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { routeIncoming } from '../_shared/router.ts';
import { deliverReply } from '../_shared/reply.ts';

type Db = ReturnType<typeof adminClient>;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);

  // ─── 1. אימות. לפני כל נגיעה במסד. ───
  // חייב להיות הגוף הגולמי: JSON שעבר פרסור וסריאליזציה מחדש הוא בתים אחרים.
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature');

  if (!(await verifyHubSignature(rawBody, signature))) {
    console.warn('[wa-webhook] חתימה לא תקינה — נדחה', {
      event: req.headers.get('x-hub-event'),
      delivery: req.headers.get('x-hub-delivery'),
    });
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'גוף הבקשה אינו JSON תקין' }, 400);
  }

  const event = req.headers.get('x-hub-event')
    ?? (payload as { event?: string })?.event
    ?? 'unknown';
  const db = adminClient();

  try {
    switch (event) {
      case 'message.received':
        return await handleIncoming(db, payload);
      case 'connection.changed':
        return await handleConnectionChanged(db, payload);
      case 'message.sent':
      case 'message.failed':
        return await handleSendOutcome(db, event, payload);
      default:
        // אירוע שלא מטופל אינו שגיאה — מאשרים כדי שה-Hub לא ינסה שוב.
        console.log(`[wa-webhook] אירוע לא מטופל: ${event}`);
        return json({ ok: true, ignored: event });
    }
  } catch (e) {
    console.error('[wa-webhook] תקלה בעיבוד', { event, error: e });
    // 500 גורם ל-Hub לנסות שוב לפי לוח הניסיונות שלו — וזה מה שרצוי.
    return json({ error: 'שגיאה בעיבוד האירוע' }, 500);
  }
});

// ─────────────────────────── הודעה נכנסת ───────────────────────────

async function handleIncoming(db: Db, payload: unknown): Promise<Response> {
  const message = whatsappProvider().parseIncoming(payload);

  // בלי מזהה אין מניעת כפילויות. לא מעבדים, אבל כן מתריעים —
  // כשל שקט הוא בדיוק מה שאסור כאן.
  if (!message) {
    console.error('[wa-webhook] אירוע ללא מזהה או ללא מספר — לא עובד', payload);
    await alertOwner(db, {
      kind: 'wa_unparsable',
      severity: 'warning',
      title: 'התקבלה הודעת וואטסאפ שלא ניתן לזהות',
      body: 'ההודעה לא עובדה כדי למנוע כפילות. יש לבדוק את פורמט ה-webhook.',
      meta: payload,
    });
    return json({ ok: true, skipped: 'unparsable' });
  }

  const phone = normalizePhone(message.from);

  // ─── 2. מניעת כפילויות. האכיפה במסד, לא בקוד. ───
  const { error } = await db.from('wa_messages').insert({
    direction: 'in',
    phone,
    body: message.body,
    status: 'sent',
    provider_msg_id: message.providerMsgId,
    meta: { event: 'message.received', contact_name: message.contactName, received_at: message.receivedAt },
  });

  if (error) {
    // 23505 = הפרת מפתח ייחודי. זו בדיוק המסירה החוזרת שאנחנו מגנים מפניה.
    if (error.code === '23505') {
      console.log(`[wa-webhook] הודעה כפולה ${message.providerMsgId} — מתעלם`);
      return json({ ok: true, duplicate: true });
    }
    throw new Error(error.message);
  }

  await db.from('conversations').upsert(
    { phone, contact_name: message.contactName, last_message_at: message.receivedAt },
    { onConflict: 'phone' },
  );

  // ─── 3. ניתוב. הלוגיקה עצמה ב-_shared/router.ts כדי שתהיה בדיקה
  //        שמריצה אותה מול מסד מזויף ומתעדת כל כתיבה. ───
  const decision = await routeIncoming(
    db,
    { alert: (a) => alertOwner(db, a) },
    { phone, body: message.body },
  );

  if (decision.route === 'command_parse_failed') {
    // לא נכתב דבר, ואין תשובה: פרסור שנכשל אינו מצדיק הודעה חוזרת
    // על כל טקסט אקראי שמגיע למספר.
    console.log(`[wa-webhook] פרסור נכשל (${decision.parse.reason}) — לא נשמר דבר`);
  }

  // ★ תשובה לשולחת. הלוגיקה ב-_shared/reply.ts כדי שבדיקה תוכל להריץ
  //   אותה מול ספק מזויף ולהוכיח שכל reply באמת יוצא.
  const delivery = await deliverReply(
    db, whatsappProvider(), phone, decision, `reply:${message.providerMsgId}`,
  );
  if (delivery.delivered === false && delivery.reason === 'send_failed') {
    console.error(`[wa-webhook] התשובה לא יצאה: ${delivery.error}`);
  }

  return json({ ok: true, stored: message.providerMsgId, route: decision.route });
}

// ─────────────────────── שינוי מצב החיבור ───────────────────────

/**
 * ה-Hub מודיע מיד כשהחיבור נופל — מהר בהרבה מ-cron של 10 דקות.
 * ה-cron נשאר, כי כשהשרת עצמו מת אף webhook לא יגיע.
 */
async function handleConnectionChanged(db: Db, payload: unknown): Promise<Response> {
  const data = ((payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  const state = String(data.state ?? 'unknown');
  const connected = /connected|ready|open/i.test(state);
  const now = new Date().toISOString();

  const previous = await readWaHealth(db);
  await writeWaHealth(db, {
    status: connected ? 'up' : 'down',
    checked_at: now,
    last_ok_at: connected ? now : previous.last_ok_at,
    consecutive_failures: connected ? 0 : previous.consecutive_failures + 1,
    error: connected ? null : (typeof data.error === 'string' ? data.error : `מצב "${state}"`),
  });

  if (!connected && previous.status !== 'down') {
    await alertOwner(db, {
      kind: 'wa_down',
      severity: 'critical',
      title: 'החיבור לוואטסאפ נפל',
      body: `השרת מדווח מצב "${state}". תזכורות מוחזקות בתור ולא נשלחות עד שהחיבור יחזור.`,
      meta: data,
    });
  }
  if (connected && previous.status === 'down') {
    await alertOwner(db, {
      kind: 'wa_recovered',
      severity: 'info',
      title: 'החיבור לוואטסאפ חזר',
      body: 'תזכורות שהוחזקו יישלחו בסבב ה-cron הבא.',
    });
  }

  return json({ ok: true, state });
}

// ─────────────────── תוצאת שליחה יוצאת ───────────────────

async function handleSendOutcome(db: Db, event: string, payload: unknown): Promise<Response> {
  const data = ((payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  const waId = data.waId ?? data.id;
  if (waId === null || waId === undefined) return json({ ok: true, skipped: 'no id' });

  const failed = event === 'message.failed';
  await db.from('wa_messages')
    .update({
      status: failed ? 'failed' : 'sent',
      meta: { event, error: failed ? String(data.error ?? '') : null },
    })
    .eq('provider_msg_id', String(waId));

  return json({ ok: true, event });
}
