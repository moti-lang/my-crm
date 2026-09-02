import type { WhatsAppProvider } from './wa.ts';
import { alertOwner } from './alerts.ts';

/**
 * שליחת התשובה לשולחת.
 *
 * חי כאן ולא בתוך wa-webhook כדי שיהיה אפשר להריץ אותו בבדיקה מול ספק
 * מזויף ולהוכיח שכל החלטה שנושאת reply באמת מגיעה לשליחה.
 *
 * ★ למה זה קיים בכלל: עד סבב האימות ה-webhook חישב החלטה, רשם לוג, ולא
 *   שלח דבר. מנגנון הפקודות היה מת — כרטיסי אישור לא יצאו, שאלות על
 *   שדה חסר לא יצאו, ואף בדיקה לא תפסה את זה כי כולן נעצרו בהחלטה.
 *   סוכן ששותק אחרי פקודה כספית משאיר את הבעלים בלי לדעת אם ההוצאה
 *   נרשמה, והיא שולחת שוב.
 */

/** כל החלטה של הנתב. מה שיש לו reply לא ריק — נשלח. */
export type Deliverable = { route: string; reply?: string };

export function replyOf(decision: Deliverable): string | undefined {
  const r = decision.reply;
  return typeof r === 'string' && r.trim() !== '' ? r : undefined;
}

export type DeliveryResult =
  | { delivered: true; reply: string }
  | { delivered: false; reason: 'no_reply' }
  | { delivered: false; reason: 'send_failed'; error: string };

/**
 * @param idempotencyKey נגזר ממזהה ההודעה הנכנסת, כדי שמסירה חוזרת של
 *        אותו אירוע לא תייצר שתי תשובות.
 */
export async function deliverReply(
  db: { from: (t: string) => unknown },
  wa: WhatsAppProvider,
  phone: string,
  decision: Deliverable,
  idempotencyKey: string,
): Promise<DeliveryResult> {
  const reply = replyOf(decision);
  if (reply === undefined) return { delivered: false, reason: 'no_reply' };

  const sent = await wa.sendText(phone, reply, idempotencyKey);
  if (sent.ok) return { delivered: true, reply };

  const error = sent.error ?? 'שגיאה לא ידועה';
  // כישלון שליחה אינו נבלע: הבעלים צריכה לדעת שמישהי נשארה בלי תשובה.
  await alertOwner(db as never, {
    kind: 'wa_reply_failed',
    severity: 'warning',
    title: 'תשובה לא יצאה בוואטסאפ',
    body: `מסלול ${decision.route} למספר ${phone}. השולחת נשארה בלי תשובה.`,
    meta: { route: decision.route, error },
  });
  return { delivered: false, reason: 'send_failed', error };
}
