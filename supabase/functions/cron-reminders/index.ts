// cron-reminders — מעבד התור. רץ כל 15 דקות.
//
// זו הפונקציה היחידה שמוציאה תזכורות החוצה. היא לא מרכיבה הודעות
// ולא מחליטה למי לשלוח — היא רק לוקחת מה שהגיע זמנו ומעבירה ל-wa-send.
//
// כשהחיבור נפול: לא שולחים ולא מסמנים. התזכורות נשארות scheduled
// ויוצאות כשהחיבור יחזור. הודעה שלא יצאה לא תיספר כאילו יצאה.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';
import { readWaHealth, maySend } from '../_shared/health.ts';
import { requireEnv } from '../_shared/env.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** תקרה לסבב אחד — כדי שתור שהצטבר לא ייצור פרץ שליחות. */
const BATCH = 40;

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const db = adminClient();

  try {
    const health = await readWaHealth(db);
    if (!maySend(health)) {
      const { count } = await db.from('reminders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString());
      console.warn(`[cron-reminders] החיבור נפול — ${count ?? 0} תזכורות מוחזקות`);
      return json({ sent: 0, held: count ?? 0, reason: 'שרת הוואטסאפ אינו זמין' });
    }

    const { data: due, error } = await db
      .from('reminders')
      .select('id, to_phone, body')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(BATCH);
    if (error) throw new Error(error.message);
    if (!due || due.length === 0) return json({ sent: 0, due: 0 });

    const base = requireEnv('SUPABASE_URL');
    // wa-send מוגנת ב-CRON_SECRET, לא במפתח service_role.
    const key = requireEnv('CRON_SECRET');

    let sent = 0, deferred = 0, failed = 0;

    // סדרתי בכוונה: פרץ מקבילי מול חיבור וואטסאפ אחד מזמין חסימה.
    for (const r of due as { id: string; to_phone: string; body: string }[]) {
      try {
        const res = await fetch(`${base}/functions/v1/wa-send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ to: r.to_phone, body: r.body, reminder_id: r.id }),
        });
        const result = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (result.sent) sent++;
        else if (result.deferred || result.held) deferred++;
        else failed++;
      } catch (e) {
        failed++;
        console.error(`[cron-reminders] תזכורת ${r.id} נכשלה`, e);
        await db.from('reminders')
          .update({ status: 'failed', error: e instanceof Error ? e.message : 'שגיאת רשת' })
          .eq('id', r.id);
      }
    }

    console.log(`[cron-reminders] נשלחו ${sent}, נדחו ${deferred}, נכשלו ${failed}`);
    return json({ sent, deferred, failed, due: due.length });
  } catch (e) {
    console.error('[cron-reminders] נכשל', e);
    return json({ error: 'עיבוד התור נכשל' }, 500);
  }
});
