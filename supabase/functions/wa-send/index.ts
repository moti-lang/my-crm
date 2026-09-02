// wa-send — שער היציאה היחיד לוואטסאפ.
// כל שליחה במערכת עוברת כאן: בריאות החיבור, שעות שקטות, ניסיונות חוזרים,
// ורישום ב-wa_messages. עם WA_DRY_RUN=true (ברירת המחדל) הכל רץ ושום
// הודעה לא יוצאת.
//
// כלל שאין ממנו חריגה: אין כשל שקט. כל מסלול מסתיים ברישום מפורש —
// sent, failed עם השגיאה, או deferred עם הזמן החדש.
import { adminClient } from '../_shared/supabase.ts';
import { whatsappProvider } from '../_shared/wa.ts';
import { normalizePhone, isValidIsraeliMobile } from '../_shared/phone.ts';
import { isBlocked, nextAllowedTime } from '../_shared/quiet-hours.ts';
import { readWaHealth, maySend } from '../_shared/health.ts';
import { WA_DRY_RUN } from '../_shared/env.ts';

type Body = { to?: string; body?: string; reminder_id?: string; idempotency_key?: string };

/** מפתח יציב לדקה — ניסיון חוזר של אותה שליחה לא יוצר הודעה שנייה. */
async function fingerprint(to: string, body: string): Promise<string> {
  const minute = new Date().toISOString().slice(0, 16);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${to}|${body}|${minute}`));
  return 'crm-' + Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const RETRY_BACKOFF_MS = [1_000, 3_000];   // אחרי הניסיון הראשון והשני

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);

  let input: Body;
  try {
    input = (await req.json()) as Body;
  } catch {
    return json({ error: 'גוף הבקשה אינו JSON תקין' }, 400);
  }

  const to = normalizePhone(input.to ?? '');
  const body = (input.body ?? '').trim();
  if (!isValidIsraeliMobile(to)) return json({ error: 'מספר טלפון לא תקין' }, 400);
  if (!body) return json({ error: 'הודעה ריקה' }, 400);

  const db = adminClient();

  try {
    // ─── 1. החיבור חי? ───
    // אם לא — משאירים את התזכורת ב-'scheduled'. לא מסמנים כנשלחה
    // הודעה שלא יצאה; ה-cron יאסוף אותה כשהחיבור יחזור.
    const health = await readWaHealth(db);
    if (!maySend(health)) {
      return json({
        sent: false,
        held: true,
        reason: 'שרת הוואטסאפ אינו זמין — השליחה מוחזקת בתור',
        wa_status: health.status,
      }, 503);
    }

    // ─── 2. שעות שקטות, שבת וחגים ───
    const [{ data: quietRow }, { data: holidayRows }] = await Promise.all([
      db.from('settings').select('value').eq('key', 'quiet_hours').maybeSingle(),
      db.from('holidays').select('day'),
    ]);
    const quiet = (quietRow?.value as { from: string; to: string; no_shabbat: boolean } | undefined) ?? {
      from: '21:30', to: '08:00', no_shabbat: true,
    };
    const holidays = new Set((holidayRows ?? []).map((h: { day: string }) => h.day));

    const now = new Date();
    if (isBlocked(now, quiet, holidays)) {
      const next = nextAllowedTime(now, quiet, holidays);
      if (input.reminder_id) {
        await db.from('reminders')
          .update({ scheduled_at: next.toISOString(), status: 'scheduled' })
          .eq('id', input.reminder_id);
      }
      return json({ sent: false, deferred: true, scheduled_at: next.toISOString() });
    }

    // ─── 3. שליחה, עד שלושה ניסיונות ───
    // מפתח הייחודיות שה-Hub מכיר: ניסיון חוזר לא שולח פעמיים.
    // לתזכורת — מזהה התזכורת. אחרת — טביעת אצבע של היעד, הטקסט והדקה.
    const idempotencyKey = input.idempotency_key
      ?? (input.reminder_id ? `reminder-${input.reminder_id}` : await fingerprint(to, body));

    const wa = whatsappProvider();
    let lastError = 'שגיאה לא ידועה';

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await wa.sendText(to, body, idempotencyKey);

      if (result.ok) {
        await db.from('wa_messages').insert({
          direction: 'out',
          phone: to,
          body,
          status: result.dryRun ? 'queued' : 'sent',
          provider_msg_id: result.providerMsgId,
          reminder_id: input.reminder_id ?? null,
          meta: { dry_run: result.dryRun, attempt },
        });
        if (input.reminder_id) {
          await db.from('reminders')
            .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
            .eq('id', input.reminder_id);
        }
        return json({ sent: true, dry_run: result.dryRun, provider_msg_id: result.providerMsgId });
      }

      lastError = result.error;
      if (!result.retryable) break;                 // 4xx — אין טעם לנסות שוב
      const wait = RETRY_BACKOFF_MS[attempt - 1];
      if (wait !== undefined) await new Promise((r) => setTimeout(r, wait));
    }

    // ─── 4. כשל מפורש ───
    await db.from('wa_messages').insert({
      direction: 'out', phone: to, body, status: 'failed',
      reminder_id: input.reminder_id ?? null,
      meta: { error: lastError, dry_run: WA_DRY_RUN },
    });
    if (input.reminder_id) {
      await db.from('reminders').update({ status: 'failed', error: lastError }).eq('id', input.reminder_id);
    }
    console.error('[wa-send] כשל אחרי כל הניסיונות', { to, lastError });
    return json({ sent: false, error: 'ההודעה לא נשלחה אחרי שלושה ניסיונות' }, 502);
  } catch (e) {
    // גם כאן לא נשארים בשקט: מתעדים ומחזירים ניסוח אנושי.
    console.error('[wa-send] תקלה בלתי צפויה', e);
    if (input.reminder_id) {
      await db.from('reminders')
        .update({ status: 'failed', error: e instanceof Error ? e.message : 'תקלה בלתי צפויה' })
        .eq('id', input.reminder_id)
        .then(undefined, () => undefined);
    }
    return json({ error: 'אירעה תקלה בשליחה. נסי שוב מאוחר יותר.' }, 500);
  }
});
