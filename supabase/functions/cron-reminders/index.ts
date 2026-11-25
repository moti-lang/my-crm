// cron-reminders — מעבד התור.
//
// ★ קצב: מרווח אקראי בין הודעות ותקרה לדקה — מההגדרות (wa_pacing), דרך _shared/send-queue.ts.
//   סבב אחד מוגבל בזמן; מה שלא הספיק נשאר בתור לסבב הבא. (כשמפעילים את התור: כל 2–5 דקות.)
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
import { drainQueue, PACING_DEFAULT, type Pacing, type SendOutcome } from '../_shared/send-queue.ts';

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
    const { data: pacingRow } = await db.rpc('rpc_wa_pacing');
    const pacing = { ...PACING_DEFAULT, ...((pacingRow ?? {}) as Partial<Pacing>) };

    // ★ סדרתי, עם מרווח אקראי: פרץ מול חיבור וואטסאפ אחד מזמין חסימה.
    const stats = await drainQueue(due as { id: string; to_phone: string; body: string }[], {
      pacing,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      random: Math.random,
      send: async (r) => {
        try {
          const res = await fetch(`${base}/functions/v1/wa-send`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ to: r.to_phone, body: r.body, reminder_id: r.id }),
          });
          return (await res.json().catch(() => ({ error: `wa-send החזירה ${res.status}` }))) as SendOutcome;
        } catch (e) {
          console.error(`[cron-reminders] תזכורת ${r.id} נכשלה`, e);
          await db.from('reminders').update({ status: 'failed', error: e instanceof Error ? e.message : 'שגיאת רשת' }).eq('id', r.id);
          return { error: 'network' };
        }
      },
    });

    console.log(`[cron-reminders] ${JSON.stringify(stats)}`);
    return json({ ...stats, due: due.length });
  } catch (e) {
    console.error('[cron-reminders] נכשל', e);
    return json({ error: 'עיבוד התור נכשל' }, 500);
  }
});
