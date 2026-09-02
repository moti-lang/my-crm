import { env } from './env.ts';

type Db = { from: (t: string) => any };

/**
 * ערוץ ההתראה לבעלים — עצמאי מוואטסאפ, בכוונה.
 *
 * ⛔ הקובץ הזה לא מייבא את wa.ts ולא קורא ל-wa-send, לעולם.
 * ההתראה הכי חשובה במערכת היא "החיבור לוואטסאפ נפל". אם היא עוברת
 * בוואטסאפ, היא נופלת בדיוק ברגע שהיא נחוצה. יש בדיקה מבנית
 * (supabase/tests/alert-independence.test.mjs) שנכשלת אם מישהו יחבר
 * את השניים בעתיד.
 *
 * שלושה יעדים, לפי סדר אמינות:
 *   1. audit_log      — תמיד. הרישום שנשאר גם אם הכל אחר נופל.
 *   2. system_alerts  — מזין את הבאנר בדשבורד ואת מסך ההגדרות.
 *   3. OWNER_ALERT_WEBHOOK — POST גנרי ליעד חיצוני, אם הוגדר.
 */
export async function alertOwner(
  db: Db,
  alert: { kind: string; title: string; body?: string; severity?: 'info' | 'warning' | 'critical'; meta?: unknown },
): Promise<void> {
  const severity = alert.severity ?? 'warning';
  const payload = { kind: alert.kind, severity, title: alert.title, body: alert.body ?? null };

  // 1. audit_log — הרישום הבסיסי. נכתב ראשון כדי שגם אם השאר ייכשל, יש עקבות.
  try {
    await db.from('audit_log').insert({
      actor: 'system',
      action: 'alert',
      table_name: 'system_alerts',
      after: { ...payload, meta: alert.meta ?? null },
      source: 'cron',
    });
  } catch (e) {
    console.error('[alertOwner] כתיבה ל-audit_log נכשלה', e);
  }

  // 2. system_alerts — מה שמרים את הבאנר.
  try {
    await db.from('system_alerts').insert({
      kind: alert.kind,
      severity,
      title: alert.title,
      body: alert.body ?? null,
      meta: alert.meta ?? null,
    });
  } catch (e) {
    console.error('[alertOwner] כתיבת ההתראה ל-system_alerts נכשלה', e);
  }

  // 3. יעד חיצוני — POST גנרי. Telegram, Slack, Pushover, כל דבר שמקבל JSON.
  const webhook = env('OWNER_ALERT_WEBHOOK');
  if (!webhook) {
    console.warn(
      `[alertOwner] אין OWNER_ALERT_WEBHOOK — ההתראה קיימת רק בתוך המערכת: ${alert.title}`,
    );
    return;
  }

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, at: new Date().toISOString(), system: 'teichtal-crm' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[alertOwner] היעד החיצוני החזיר ${res.status}`);
  } catch (e) {
    // גם אם היעד החיצוני נפל — ההתראה כבר רשומה בשני מקומות במסד.
    console.error('[alertOwner] שליחת ההתראה ליעד החיצוני נכשלה', e);
  }
}
