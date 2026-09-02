import { env } from './env.ts';

type Db = { from: (t: string) => any };

/**
 * ערוץ התראה חלופי לבעלים.
 *
 * כשהוואטסאפ נופל אי אפשר להתריע בוואטסאפ. לכן כל התראה נכתבת קודם
 * ל-system_alerts — הערוץ שתמיד עובד ומזין את הבאנר במסך — ורק אחר כך
 * נשלחת החוצה, אם הוגדר יעד.
 */
export async function alertOwner(
  db: Db,
  alert: { kind: string; title: string; body?: string; severity?: 'info' | 'warning' | 'critical'; meta?: unknown },
): Promise<void> {
  const severity = alert.severity ?? 'warning';

  try {
    await db.from('system_alerts').insert({
      kind: alert.kind,
      severity,
      title: alert.title,
      body: alert.body ?? null,
      meta: alert.meta ?? null,
    });
  } catch (e) {
    console.error('[alertOwner] כתיבת ההתראה למסד נכשלה', e);
  }

  // יעד חיצוני אופציונלי (Telegram, Slack, Pushover, מה שיוגדר).
  const webhook = env('OWNER_ALERT_WEBHOOK');
  if (!webhook) {
    console.warn(`[alertOwner] אין OWNER_ALERT_WEBHOOK — ההתראה נשמרה במערכת בלבד: ${alert.title}`);
    return;
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ severity, title: alert.title, body: alert.body ?? '', kind: alert.kind }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error('[alertOwner] שליחת ההתראה ליעד החיצוני נכשלה', e);
  }
}
