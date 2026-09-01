// wa-send — שער היציאה היחיד לוואטסאפ.
// כל שליחה במערכת עוברת כאן: שעות שקטות, ניסיונות חוזרים, רישום ב-wa_messages.
// עם WA_DRY_RUN=true (ברירת המחדל) כל הלוגיקה רצה ושום הודעה לא יוצאת.
import { adminClient } from '../_shared/supabase.ts';
import { waClient } from '../_shared/wa.ts';
import { normalizePhone, isValidIsraeliMobile } from '../_shared/phone.ts';
import { isBlocked, nextAllowedTime } from '../_shared/quiet-hours.ts';
import { WA_DRY_RUN } from '../_shared/env.ts';

type Body = { to?: string; body?: string; reminder_id?: string };

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

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
    const [{ data: quietRow }, { data: holidayRows }] = await Promise.all([
      db.from('settings').select('value').eq('key', 'quiet_hours').maybeSingle(),
      db.from('holidays').select('day'),
    ]);

    const quiet = (quietRow?.value as { from: string; to: string; no_shabbat: boolean } | undefined) ?? {
      from: '21:30', to: '08:00', no_shabbat: true,
    };
    const holidays = new Set((holidayRows ?? []).map((h: { day: string }) => h.day));

    // שעה חסומה → לא שולחים עכשיו, דוחים לחלון המותר הבא.
    const now = new Date();
    if (isBlocked(now, quiet, holidays)) {
      const next = nextAllowedTime(now, quiet, holidays);
      if (input.reminder_id) {
        await db
          .from('reminders')
          .update({ scheduled_at: next.toISOString(), status: 'scheduled' })
          .eq('id', input.reminder_id);
      }
      return json({ deferred: true, scheduled_at: next.toISOString() });
    }

    // שלושה ניסיונות עם השהיה מדורגת.
    const wa = waClient();
    let last = 'שגיאה לא ידועה';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await wa.sendMessage(to, body);
      if (result.ok) {
        await db.from('wa_messages').insert({
          direction: 'out',
          phone: to,
          body,
          status: result.dryRun ? 'queued' : 'sent',
          green_id: result.greenId,
          reminder_id: input.reminder_id ?? null,
          meta: { dry_run: result.dryRun, attempt },
        });
        if (input.reminder_id) {
          await db
            .from('reminders')
            .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
            .eq('id', input.reminder_id);
        }
        return json({ sent: true, dry_run: result.dryRun, green_id: result.greenId });
      }
      last = result.error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }

    await db.from('wa_messages').insert({
      direction: 'out', phone: to, body, status: 'failed',
      reminder_id: input.reminder_id ?? null, meta: { error: last, dry_run: WA_DRY_RUN },
    });
    if (input.reminder_id) {
      await db.from('reminders').update({ status: 'failed', error: last }).eq('id', input.reminder_id);
    }
    return json({ sent: false, error: 'ההודעה לא נשלחה אחרי שלושה ניסיונות' }, 502);
  } catch (e) {
    // לעולם לא מחזירים שגיאה גולמית החוצה.
    console.error('wa-send failed', e);
    return json({ error: 'אירעה תקלה בשליחה. נסי שוב מאוחר יותר.' }, 500);
  }
});
