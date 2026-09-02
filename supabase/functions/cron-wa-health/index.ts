// cron-wa-health — בדיקת בריאות כל 10 דקות.
//
// למה גם cron וגם webhook: connection.changed מודיע מיד כשוואטסאפ מתנתק,
// אבל כשהשרת עצמו מת — נפילת מכונה, קריסת תהליך, ניתוק רשת — שום webhook
// לא יגיע. שקט אינו סימן לבריאות. ה-cron הוא מי שמבדיל בין השניים.
import { adminClient } from '../_shared/supabase.ts';
import { whatsappProvider } from '../_shared/wa.ts';
import { alertOwner } from '../_shared/alerts.ts';
import { readWaHealth, writeWaHealth } from '../_shared/health.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** מתריעים אחרי שתי בדיקות כושלות רצופות — כדי לא להקפיץ על גמגום רגעי. */
const FAILURES_BEFORE_ALERT = 2;

Deno.serve(async () => {
  const db = adminClient();

  try {
    const previous = await readWaHealth(db);
    const result = await whatsappProvider().checkHealth();
    const now = new Date().toISOString();

    if (result.ok) {
      await writeWaHealth(db, {
        status: 'up', checked_at: now, last_ok_at: now, consecutive_failures: 0, error: null,
      });
      if (previous.status === 'down') {
        await alertOwner(db, {
          kind: 'wa_recovered',
          severity: 'info',
          title: 'החיבור לוואטסאפ חזר',
          body: 'תזכורות שהוחזקו יישלחו בסבב ה-cron הבא.',
        });
      }
      return json({ ok: true, state: result.state });
    }

    const failures = previous.consecutive_failures + 1;
    await writeWaHealth(db, {
      status: failures >= FAILURES_BEFORE_ALERT ? 'down' : previous.status,
      checked_at: now,
      last_ok_at: previous.last_ok_at,
      consecutive_failures: failures,
      error: result.error,
    });

    if (failures === FAILURES_BEFORE_ALERT) {
      const downSince = previous.last_ok_at
        ? `הפעם האחרונה שהחיבור היה תקין: ${previous.last_ok_at}`
        : 'לא נרשמה בדיקה תקינה מאז ההפעלה';
      await alertOwner(db, {
        kind: 'wa_down',
        severity: 'critical',
        title: 'שרת הוואטסאפ אינו זמין',
        body: `${result.error}\n${downSince}\nתזכורות מוחזקות בתור ולא נשלחות.`,
        meta: { state: result.state, consecutive_failures: failures },
      });
    }

    return json({ ok: false, state: result.state, consecutive_failures: failures }, 200);
  } catch (e) {
    console.error('[cron-wa-health] תקלה בבדיקה', e);
    return json({ error: 'בדיקת הבריאות נכשלה' }, 500);
  }
});
